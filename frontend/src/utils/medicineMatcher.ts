/**
 * Clinical Medicine Matcher & Formulary Resolution Engine
 *
 * Resolves doctor prescription shorthands, abbreviations, missing strengths,
 * dosage forms, and minor typos to real hospital inventory medicines.
 *
 * Examples handled:
 * - "PCM" or "Dolo" or "Paraceramol" -> "Paracetamol 650mg" (with active batch FEFO)
 * - "Amox 500" -> "Amoxicillin 500mg Capsule"
 * - "Pan 40" -> "Pantoprazole 40mg Tablet"
 * - Missing strength: picks candidate with active, non-expired batch stock.
 */

import { PharmacyDatabase, type AppMedicine, type AppBatch } from "../services/pharmacyDb"

// ── Known clinical abbreviation & brand/generic synonyms ─────────────────────
const CLINICAL_SYNONYMS: Record<string, string[]> = {
  paracetamol: [
    "par",
    "para",
    "parac",
    "pcm",
    "apap",
    "dolo",
    "calpol",
    "crocin",
    "metacin",
    "pacim",
    "panadol",
    "tylenol",
    "fevridol",
    "paraceramol",
    "paracetemol",
    "paracip",
    "sumo",
  ],
  amoxicillin: [
    "amox",
    "amx",
    "amoxi",
    "mox",
    "novamox",
    "amoxil",
    "amoxcillin",
    "almox",
  ],
  "amoxicillin and clavulanate": [
    "augmentin",
    "moxclav",
    "clamox",
    "aug",
    "amoxyclav",
    "augment",
    "clavum",
    "mega-cv",
    "advent",
  ],
  pantoprazole: [
    "pan",
    "pant",
    "panto",
    "pantocid",
    "pantodac",
    "pantop",
    "protonix",
    "pantosec",
    "pan-40",
    "pan40",
  ],
  omeprazole: ["omep", "omez", "prilosec", "omizac", "ocid"],
  rabeprazole: ["rabe", "rabep", "rabicip", "razo", "aciphex", "happi", "rabium"],
  esomeprazole: ["esop", "esomac", "nexium", "esoz", "sompraz"],
  azithromycin: [
    "az",
    "azi",
    "azith",
    "azithro",
    "azee",
    "zithromax",
    "aziwok",
    "azithral",
    "zady",
    "azithromicin",
  ],
  ciprofloxacin: ["cip", "cipro", "ciptox", "cifran", "ciproglen", "ciolox"],
  levofloxacin: ["levo", "levoflox", "levomac", "levaquin", "glevo"],
  ofloxacin: ["oflox", "oflin", "zenflox", "zanocin", "oflacina"],
  metformin: ["met", "metf", "metfor", "glycomet", "glucophage", "glyciphage", "obimet"],
  glimepiride: ["glim", "amaryl", "zoryl", "gp", "glimy"],
  telmisartan: ["tel", "telmi", "telma", "micardis", "telsartan", "telpres"],
  atorvastatin: [
    "ator",
    "atorva",
    "atorvas",
    "atrovas",
    "atrova",
    "atorv",
    "atorlip",
    "lipitor",
    "storvas",
    "atorfit",
    "atocor",
  ],
  rosuvastatin: ["rosu", "rosuvas", "crestor", "rosave", "razel"],
  amlodipine: ["amlo", "amlodac", "norvasc", "amlopres", "stamlo", "amlong"],
  cetirizine: [
    "cet",
    "cetz",
    "citrizine",
    "cetrizine",
    "zyrtec",
    "cetcip",
    "alercet",
    "okacet",
    "incid-l",
  ],
  levocetirizine: ["levocet", "levocetrizine", "levocetirizine", "xyzal", "1-al", "teczine"],
  montelukast: ["mont", "monte", "montek", "montair", "singulair", "monticope"],
  ibuprofen: ["ibu", "brufen", "advil", "motrin", "ibugesic", "combiflam"],
  diclofenac: ["diclo", "voveran", "voltaren", "diclogesic", "dynapar"],
  aceclofenac: ["aceclo", "hifenac", "zerodol", "acemiz"],
  tramadol: ["tram", "ultram", "tramazac", "contramal", "domadol"],
  ondansetron: ["ondal", "ondem", "zofran", "emeset", "vomikind"],
  domperidone: ["dom", "domstal", "motilium", "vomistop"],
  multivitamin: ["multivit", "becosules", "supradyn", "zincovit", "cobadex"],
  ranitidine: ["rantac", "aciloc", "zantac", "histac"],
  cefixime: ["cefix", "taxim-o", "zifi", "mahacef", "ceftas"],
  ceftriaxone: ["monocep", "monocef", "rocephin", "oframax"],
  metronidazole: ["flagyl", "metrogyl", "aldazole"],
  doxycycline: ["doxy", "doxicip", "vibramycin", "doxt"],
  alprazolam: ["alprax", "restyl", "xanax", "trika"],
  clonazepam: ["clona", "clonapax", "rivotril", "zapiz", "lonazep"],
  salbutamol: ["asthalin", "ventolin", "aerocort"],
  budesonide: ["budecort", "pulmicort", "foracort"],
  prednisolone: ["omnacortil", "wysolone", "deltacortril"],
  dicyclomine: ["meftal-spas", "cyclopam", "spasmo-proxyvon", "baralgan"],
}

// Inverted lookup map for O(1) synonym resolution: abbreviation/brand -> standard generic
const REVERSE_SYNONYM_MAP = new Map<string, string>()
for (const [generic, synonyms] of Object.entries(CLINICAL_SYNONYMS)) {
  REVERSE_SYNONYM_MAP.set(generic.toLowerCase(), generic)
  for (const syn of synonyms) {
    REVERSE_SYNONYM_MAP.set(syn.toLowerCase(), generic)
  }
}

// ── String & clinical normalization helpers ──────────────────────────────────

const DOSAGE_FORM_REGEX =
  /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syr|syrup|inj|injection|susp|suspension|oint|ointment|crm|cream|drp|drops|drop|sol|solution|gel|inh|inhaler|respule|respules|lotion|spray|patch|iv|im|sc|po|od|bd|tds|qid|sos|hs|stat|prn)\b/gi

const STRENGTH_REGEX = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|gm|g|ml|iu|%)\b/i
const NUMBER_ONLY_STRENGTH = /\b(\d{2,4})\b/

/**
 * Strips dosage forms, extra punctuation, and excessive whitespace.
 */
export function cleanMedicineString(input: string): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .replace(DOSAGE_FORM_REGEX, " ")
    .replace(/[^\w\s.%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Extracts strength representation from string, e.g. "650mg", "40 mg", "500"
 */
export function extractStrength(input: string): { raw: string; normalized: string; num: number | null } | null {
  if (!input) return null
  const m = input.match(STRENGTH_REGEX)
  if (m) {
    const num = parseFloat(m[1])
    let unit = m[2].toLowerCase()
    if (unit === "gm") unit = "g"
    if (unit === "ug") unit = "mcg"
    return {
      raw: m[0],
      normalized: `${num}${unit}`,
      num,
    }
  }
  const numMatch = input.match(NUMBER_ONLY_STRENGTH)
  if (numMatch) {
    const num = parseFloat(numMatch[1])
    return {
      raw: numMatch[0],
      normalized: `${num}mg`,
      num,
    }
  }
  return null
}

/**
 * Extracts the core drug name stripped of both dosage forms and strengths.
 */
export function extractCoreDrugName(input: string): string {
  if (!input) return ""
  let cleaned = cleanMedicineString(input)
  // Remove strength tokens
  cleaned = cleaned.replace(STRENGTH_REGEX, " ").replace(NUMBER_ONLY_STRENGTH, " ")
  return cleaned.replace(/\s+/g, " ").trim()
}

/**
 * Levenshtein Distance for typo tolerance (e.g. Paraceramol -> Paracetamol)
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d: number[][] = []
  for (let i = 0; i <= m; i++) {
    d[i] = [i]
  }
  for (let j = 0; j <= n; j++) {
    d[0][j] = j
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      )
    }
  }
  return d[m][n]
}

/**
 * Similarity ratio between 0.0 and 1.0
 */
export function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1.0
  if (!a || !b) return 0.0
  if (a === b) return 1.0
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1.0
  const dist = levenshteinDistance(a, b)
  return Math.max(0, 1.0 - dist / maxLen)
}

// ── Match Output Interface ───────────────────────────────────────────────────

export interface MedicineMatchCandidate {
  medicine: AppMedicine
  score: number
  hasStock: boolean
  stock: number
  activeBatches: AppBatch[]
  matchType: "id" | "exact" | "synonym" | "fuzzy" | "fallback"
}

export interface MedicineMatchResult {
  matchedMedicine: AppMedicine | null
  confidence: "exact" | "high" | "synonym" | "fuzzy" | "fallback" | "none"
  matchReason: string
  hasStock: boolean
  totalStock: number
  activeBatches: AppBatch[]
  prescribedName: string
  prescribedStrength?: string
  candidates: MedicineMatchCandidate[]
}

/**
 * Finds the best matching hospital inventory medicine for a doctor prescription item.
 *
 * Considers:
 * 1. Explicit ID matches
 * 2. Exact or substring name/generic matches
 * 3. Clinical abbreviations & brand synonyms (PCM -> Paracetamol, Dolo -> Paracetamol)
 * 4. Typo tolerance / Levenshtein distance (Paraceramol -> Paracetamol)
 * 5. Strength affinity (if prescribed strength matches catalog strength)
 * 6. Active non-expired stock availability (smartly chooses strength with real stock)
 */
export function findMatchingMedicine(
  prescribedItem: {
    medicineId?: string
    medicineName?: string
    genericName?: string
    strength?: string
    name?: string
  } | null | undefined,
  medicinesList: AppMedicine[] = [],
  batchesList: AppBatch[] = []
): MedicineMatchResult {
  if (!prescribedItem || !Array.isArray(medicinesList) || medicinesList.length === 0) {
    return {
      matchedMedicine: null,
      confidence: "none",
      matchReason: "No item or empty medicine catalog",
      hasStock: false,
      totalStock: 0,
      activeBatches: [],
      prescribedName: "",
      candidates: [],
    }
  }

  const rawPrescribedName = (
    prescribedItem.medicineName ||
    prescribedItem.name ||
    ""
  ).trim()
  const rawPrescribedGeneric = (prescribedItem.genericName || "").trim()

  // 1. Direct ID match if present
  if (prescribedItem.medicineId) {
    const directMed = medicinesList.find((m) => m && m.id === prescribedItem.medicineId)
    if (directMed) {
      const { hasStock, stock, batches } = checkMedicineStock(directMed.id, directMed, batchesList)
      return {
        matchedMedicine: directMed,
        confidence: "exact",
        matchReason: "Direct ID matched",
        hasStock,
        totalStock: stock,
        activeBatches: batches,
        prescribedName: rawPrescribedName,
        candidates: [{ medicine: directMed, score: 1000, hasStock, stock, activeBatches: batches, matchType: "id" }],
      }
    }
  }

  const cleanPrescribed = cleanMedicineString(rawPrescribedName)
  const corePrescribed = extractCoreDrugName(rawPrescribedName)
  const prescribedStrengthObj =
    extractStrength(prescribedItem.strength || "") ||
    extractStrength(rawPrescribedName) ||
    (rawPrescribedGeneric ? extractStrength(rawPrescribedGeneric) : null)

  // Standardize core prescribed through synonym map if recognized
  const synonymTarget =
    REVERSE_SYNONYM_MAP.get(corePrescribed) ||
    REVERSE_SYNONYM_MAP.get(cleanPrescribed) ||
    corePrescribed

  const candidates: MedicineMatchCandidate[] = []

  const todayTime = new Date().setHours(0, 0, 0, 0)

  for (const med of medicinesList) {
    if (!med) continue

    const medName = (med.medicineName || "").trim()
    const medBrand = (med.brandName || "").trim()
    const medGeneric = (med.genericName || "").trim()
    const medLegacy = ((med as any).name || "").trim()

    const cleanMedName = cleanMedicineString(medName)
    const cleanMedBrand = cleanMedicineString(medBrand)
    const cleanMedGeneric = cleanMedicineString(medGeneric)
    const cleanMedLegacy = cleanMedicineString(medLegacy)

    const coreMedName = extractCoreDrugName(medName)
    const coreMedBrand = extractCoreDrugName(medBrand)
    const coreMedGeneric = extractCoreDrugName(medGeneric)

    const medStrengthObj =
      extractStrength(med.strength || "") ||
      extractStrength(medName) ||
      extractStrength(medBrand)

    // Stock & Batches for this med
    const medBatches = (batchesList || []).filter(
      (b) =>
        b &&
        b.medicineId === med.id &&
        (b.availableQuantity ?? b.quantity ?? 0) > 0 &&
        (!b.expiryDate || new Date(b.expiryDate).getTime() >= todayTime)
    )
    const activeBatchStock = medBatches.reduce(
      (sum, b) => sum + (b.availableQuantity ?? b.quantity ?? 0),
      0
    )
    const baseStock = Number(med.stock ?? (med as any).currentStock ?? 0)
    const totalAvailableStock = Math.max(activeBatchStock, baseStock)
    const isAvailable = totalAvailableStock > 0

    let score = 0
    let matchType: MedicineMatchCandidate["matchType"] = "fallback"

    // A. Exact Name Matches (Highest Priority)
    const targets = [cleanMedName, cleanMedBrand, cleanMedGeneric, cleanMedLegacy].filter(Boolean)
    const cores = [coreMedName, coreMedBrand, coreMedGeneric].filter(Boolean)

    if (targets.some((t) => t === cleanPrescribed || t === rawPrescribedName.toLowerCase())) {
      score += 500
      matchType = "exact"
    } else if (cores.some((c) => c === corePrescribed && c.length > 0)) {
      score += 350
      matchType = "exact"
    } else {
      // B. Clinical Synonym Match (e.g. PCM -> Paracetamol, Dolo -> Paracetamol)
      const matchesSynonym =
        (synonymTarget &&
          cores.some((c) => {
            const medSyn = REVERSE_SYNONYM_MAP.get(c) || c
            return medSyn === synonymTarget
          })) ||
        (cleanPrescribed &&
          targets.some((t) => {
            const medSyn = REVERSE_SYNONYM_MAP.get(t) || t
            return medSyn === synonymTarget
          }))

      if (matchesSynonym) {
        score += 300
        matchType = "synonym"
      } else {
        // C. Dynamic Prefix Matching on any word in the candidate medicine
        // Works dynamically for ALL existing and newly added items in inventory
        // (e.g. "par" -> Paracetamol, "amox" -> Amoxicillin, "cefu" -> Cefuroxime, "gati" -> Gatifloxacin)
        const tokenMinLen = Math.min(3, corePrescribed.length)
        const matchesWordPrefix =
          corePrescribed.length >= tokenMinLen &&
          (cores.some((c) =>
            c.startsWith(corePrescribed) ||
            c.split(/\s+/).some((w) => w.startsWith(corePrescribed)),
          ) ||
            targets.some((t) =>
              t.startsWith(corePrescribed) ||
              t.split(/\s+/).some((w) => w.startsWith(corePrescribed)),
            ))

        if (matchesWordPrefix) {
          score += 280
          matchType = "exact"
        } else {
          // D. Substring Containment (e.g. "Paracetamol" in "Paracetamol 650mg")
          const hasSubstring =
            (corePrescribed.length >= 3 &&
              cores.some((c) => c.includes(corePrescribed) || corePrescribed.includes(c))) ||
            (cleanPrescribed.length >= 3 &&
              targets.some((t) => t.includes(cleanPrescribed) || cleanPrescribed.includes(t)))

          if (hasSubstring) {
            score += 200
            matchType = "exact"
          } else {
            // E. Fuzzy Typo Match & Prefix Stem Match (e.g. "atrovas" vs "atorvastatin", "Paraceramol" vs "Paracetamol")
            let bestSim = 0
            for (const c of cores) {
              if (c.length >= 3 && corePrescribed.length >= 3) {
                const fullSim = stringSimilarity(c, corePrescribed)
                // Compare against prefix stem if doctor wrote a shorthand or stem with typo
                const stem = c.substring(0, Math.min(c.length, corePrescribed.length))
                const stemSim = stringSimilarity(stem, corePrescribed)
                const sim = Math.max(fullSim, stemSim)
                if (sim > bestSim) bestSim = sim
              }
            }
            for (const t of targets) {
              if (t.length >= 3 && cleanPrescribed.length >= 3) {
                const fullSim = stringSimilarity(t, cleanPrescribed)
                const stem = t.substring(0, Math.min(t.length, cleanPrescribed.length))
                const stemSim = stringSimilarity(stem, cleanPrescribed)
                const sim = Math.max(fullSim, stemSim)
                if (sim > bestSim) bestSim = sim
              }
            }

            if (bestSim >= 0.65) {
              score += Math.round(bestSim * 240)
              matchType = "fuzzy"
            }
          }
        }
      }
    }

    // Only proceed if there was a meaningful drug name correlation
    if (score === 0) continue

    // F. Strength Matching Factor (Strong decisive weighting when doctor specifies strength)
    if (prescribedStrengthObj && medStrengthObj) {
      if (
        prescribedStrengthObj.normalized === medStrengthObj.normalized ||
        (prescribedStrengthObj.num && prescribedStrengthObj.num === medStrengthObj.num)
      ) {
        // Strength matches prescribed!
        score += 260
      } else {
        // Doctor specified strength but this med has a different strength
        score -= 60
      }
    } else if (!prescribedStrengthObj) {
      // Doctor didn't specify strength: neutral
      score += 20
    }

    // G. Stock Availability Bonus (Ensures in-stock strength wins when unspecified)
    if (isAvailable) {
      score += 100 // Huge bonus for having physical batches ready
    } else {
      score -= 20
    }

    candidates.push({
      medicine: med,
      score,
      hasStock: isAvailable,
      stock: totalAvailableStock,
      activeBatches: medBatches,
      matchType,
    })
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score)

  if (candidates.length === 0) {
    return {
      matchedMedicine: null,
      confidence: "none",
      matchReason: `No matching drug found in catalog for "${rawPrescribedName}"`,
      hasStock: false,
      totalStock: 0,
      activeBatches: [],
      prescribedName: rawPrescribedName,
      prescribedStrength: prescribedStrengthObj?.raw,
      candidates: [],
    }
  }

  const top = candidates[0]
  let confidence: MedicineMatchResult["confidence"] = "high"
  if (top.score >= 500) confidence = "exact"
  else if (top.matchType === "synonym") confidence = "synonym"
  else if (top.matchType === "fuzzy") confidence = "fuzzy"
  else confidence = "fallback"

  let matchReason = `Matched with ${top.medicine.medicineName || top.medicine.brandName}`
  if (top.hasStock) {
    matchReason += ` (${top.stock} in stock, FEFO ready)`
  } else {
    matchReason += ` (0 in stock)`
  }

  return {
    matchedMedicine: top.medicine,
    confidence,
    matchReason,
    hasStock: top.hasStock,
    totalStock: top.stock,
    activeBatches: top.activeBatches,
    prescribedName: rawPrescribedName,
    prescribedStrength: prescribedStrengthObj?.raw,
    candidates,
  }
}

/**
 * Helper to check medicine stock from batches list.
 */
function checkMedicineStock(
  medicineId: string,
  med: AppMedicine,
  batchesList: AppBatch[]
): { hasStock: boolean; stock: number; batches: AppBatch[] } {
  const todayTime = new Date().setHours(0, 0, 0, 0)
  const activeBatches = (batchesList || []).filter(
    (b) =>
      b &&
      b.medicineId === medicineId &&
      (b.availableQuantity ?? b.quantity ?? 0) > 0 &&
      (!b.expiryDate || new Date(b.expiryDate).getTime() >= todayTime)
  )
  const batchStock = activeBatches.reduce(
    (acc, b) => acc + (b.availableQuantity ?? b.quantity ?? 0),
    0
  )
  const directStock = Number(med.stock ?? (med as any).currentStock ?? 0)
  const total = Math.max(batchStock, directStock)
  return {
    hasStock: total > 0,
    stock: total,
    batches: activeBatches,
  }
}

/**
 * Resolves doctor prescription query (e.g. "par 650", "amox 500", "pan 40", "gati 400")
 * directly against all active medicines in hospital pharmacy inventory.
 */
export function matchPrescriptionToInventory(
  query: string,
  medicinesList?: AppMedicine[],
  batchesList?: AppBatch[],
): MedicineMatchResult {
  const cleanQ = (query || "").trim()
  const meds =
    medicinesList && medicinesList.length > 0
      ? medicinesList
      : typeof window !== "undefined"
      ? PharmacyDatabase.getMedicines()
      : []
  const batches =
    batchesList && batchesList.length > 0
      ? batchesList
      : typeof window !== "undefined"
      ? PharmacyDatabase.getBatches()
      : []
  return findMatchingMedicine({ medicineName: cleanQ }, meds, batches)
}

/**
 * Autocomplete search for doctor prescription inputs.
 * Returns up to `limit` inventory medicines matching typed text/stem.
 */
export function searchInventoryAutocomplete(
  query: string,
  medicinesList?: AppMedicine[],
  limit = 8,
): AppMedicine[] {
  const cleanQ = (query || "").trim().toLowerCase()
  if (!cleanQ || cleanQ.length < 2) return []

  const meds =
    medicinesList && medicinesList.length > 0
      ? medicinesList
      : typeof window !== "undefined"
      ? PharmacyDatabase.getMedicines()
      : []

  const batches =
    typeof window !== "undefined" ? PharmacyDatabase.getBatches() : []

  const scored = meds
    .map((med) => {
      const res = findMatchingMedicine(
        { medicineName: cleanQ },
        [med],
        batches,
      )
      return { med, score: res.candidates[0]?.score || 0 }
    })
    .filter((x) => x.score >= 180)

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.med)
}
