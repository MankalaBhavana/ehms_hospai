/**
 * Dictation: turning what a doctor or nurse SAYS into what they would have WRITTEN.
 *
 * Speech engines (the hospital server's Whisper, or the browser's speech service) give plain words. Clinicians
 * speak in a particular way -- "one twenty over eighty", "paracetamol five hundred milligram t d s", "spo two
 * ninety eight percent", "full stop" -- and a transcript that keeps those words is useless in a chart. This module
 * cleans a transcript into clinical shorthand, and corrects drug / test names against the hospital's own
 * lists (pharmacy medicine master, lab catalogue) so a near-miss spelling becomes the real name.
 *
 * The cleaned text always goes into an editable box: the author reads and fixes it before saving. Nothing here
 * decides anything clinical, and an uncertain word is left exactly as heard.
 */
// ── spoken numbers ───────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const isNumWord = (w: string) => w in UNITS || w in TENS || w === "hundred" || w === "thousand" || w === "and"

/** "one twenty" (blood pressure style: a leading 1 then a tens word) -> 120. */
function spokenToNumber(words: string[]): number | null {
  const w = words.filter((x, i) => !(x === "and" && i > 0 && i < words.length - 1))
  if (!w.length || w.some((x) => x === "and")) return null
  // 1xx said as "one twenty five" / "one ten"
  if (w.length >= 2 && w[0] === "one" && (w[1] in TENS || ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"].includes(w[1])) && !w.includes("hundred")) {
    const rest = spokenToNumber(w.slice(1))
    return rest === null ? null : 100 + rest
  }
  let total = 0
  let current = 0
  let seen = false
  for (let i = 0; i < w.length; i++) {
    const x = w[i]
    if (x in UNITS) {
      // "two five" (digits read one by one) is not a quantity we can add: bail out to digit-by-digit below
      if (seen && current % 10 !== 0 && current < 20 && current > 0) return null
      current += UNITS[x]
      seen = true
    } else if (x in TENS) {
      if (current % 100 !== 0 && current % 10 !== 0) return null
      current += TENS[x]
      seen = true
    } else if (x === "hundred") {
      current = (current || 1) * 100
      seen = true
    } else if (x === "thousand") {
      total += (current || 1) * 1000
      current = 0
      seen = true
    } else return null
  }
  return seen ? total + current : null
}

/** Digits read one by one ("nine eight point six" is handled by the caller; "two five zero" -> 250). */
function digitByDigit(words: string[]): string | null {
  if (words.length < 2 || !words.every((x) => x in UNITS && UNITS[x] <= 9)) return null
  return words.map((x) => String(UNITS[x])).join("")
}

const CLINICAL_AFTER = /^(mg|mcg|ml|g|kg|cm|mm|mmhg|bpm|percent|%|degrees?|units?|iu|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|times|tablets?|tabs?|capsules?|caps?|litres?|liters?|beats|breaths|drops?|puffs?|doses?|sachets?|ampoules?|vials?)$/
const CLINICAL_BEFORE = /^(pulse|hr|rr|spo2|temp|temperature|bp|sugar|glucose|weight|dose|day|bed|grade|gcs|score|pain|room|age|aged|stage|level|rate|saturation)$/

function convertNumbers(text: string): string {
  const tokens = text.split(/(\s+)/)
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    const bare = tok.toLowerCase().replace(/[.,;:!?]+$/, "")
    if (!tok.trim() || !isNumWord(bare) || bare === "and") {
      out.push(tok)
      i++
      continue
    }
    // collect a run of number words (and the "and" inside "one hundred and twenty")
    let j = i
    let end = i + 1 // index just after the last number word (the whitespace after it is kept)
    const run: string[] = []
    let trailing = ""
    while (j < tokens.length) {
      const t = tokens[j]
      if (!t.trim()) {
        j++
        continue
      }
      const b = t.toLowerCase().replace(/[.,;:!?]+$/, "")
      if (!isNumWord(b)) break
      if (b === "and") {
        // "and" belongs to the number only between "hundred/thousand" and a smaller number word
        const nxt = tokens.slice(j + 1).find((x) => x.trim())
        const nb = (nxt || "").toLowerCase().replace(/[.,;:!?]+$/, "")
        if (!(run[run.length - 1] === "hundred" || run[run.length - 1] === "thousand") || !(nb in UNITS || nb in TENS)) break
      }
      run.push(b)
      trailing = t.slice(b.length) // punctuation the engine attached
      j++
      end = j
      if (/[.,;:!?]$/.test(t)) break
    }
    j = end
    while (run.length && run[run.length - 1] === "and") run.pop()
    const prevWord = (() => {
      for (let k = out.length - 1; k >= 0; k--) if (out[k].trim()) return out[k].toLowerCase().replace(/[^a-z0-9]/g, "")
      return ""
    })()
    const nextTok = tokens.slice(j).find((x) => x.trim())
    const nextWord = (nextTok || "").toLowerCase().replace(/[^a-z0-9%]/g, "")

    let value: string | null = null
    const n = spokenToNumber(run)
    if (n !== null) value = String(n)
    else value = digitByDigit(run)

    // the "point" decimal part
    if (value !== null && nextWord === "point") {
      let k = j
      while (k < tokens.length && !tokens[k].trim()) k++
      k++ // the word "point"
      const digits: string[] = []
      let after = ""
      while (k < tokens.length) {
        if (!tokens[k].trim()) {
          k++
          continue
        }
        const b = tokens[k].toLowerCase().replace(/[.,;:!?]+$/, "")
        if (b in UNITS && UNITS[b] <= 9) {
          digits.push(String(UNITS[b]))
          after = tokens[k].slice(b.length)
          k++
          if (/[.,;:!?]$/.test(tokens[k - 1])) break
        } else break
      }
      if (digits.length) {
        out.push(`${value}.${digits.join("")}${after}`)
        i = k
        continue
      }
    }

    const single = run.length === 1
    const clinicalContext = CLINICAL_AFTER.test(nextWord) || CLINICAL_BEFORE.test(prevWord)
    if (value !== null && (!single || clinicalContext || run[0] in TENS || (UNITS[run[0]] ?? 0) >= 10)) {
      out.push(value + trailing)
      i = j
      continue
    }
    // a lone small number word ("one of the ..."): leave as written
    out.push(...tokens.slice(i, j))
    i = j
  }
  return out.join("")
}

// ── spoken punctuation, units, abbreviations ─────────────────────────────────

/** Spelled-out letters and shorthand -> the written form. Whole-word matches only. */
/** Rules that swallow a spoken digit: they run before the numbers are converted. */
const SPELLED_EARLY: [RegExp, string][] = [
  [/\bs\s?p\s?o\s?(?:2|two)\b/gi, "SpO2"],
  [/\bh\s?b\s?a\s?(?:1|one)\s?c\b/gi, "HbA1c"],
]

const SPELLED: [RegExp, string][] = [
  [/\bb\.?\s?p\.?\b(?=\s+\d|\s*(?:is|was|of|:|-|\/|elevated|high|low|stable|\d))/gi, "BP"],
  [/\bg\s?c\s?s\b/gi, "GCS"],
  [/\be\s?c\s?g\b/gi, "ECG"],
  [/\be\s?e\s?g\b/gi, "EEG"],
  [/\bc\s?b\s?c\b/gi, "CBC"],
  [/\bl\s?f\s?t\b/gi, "LFT"],
  [/\bk\s?f\s?t\b/gi, "KFT"],
  [/\br\s?f\s?t\b/gi, "RFT"],
  [/\be\s?s\s?r\b/gi, "ESR"],
  [/\bc\s?r\s?p\b/gi, "CRP"],
  [/\bt\s?s\s?h\b/gi, "TSH"],
  [/\bm\s?r\s?i\b/gi, "MRI"],
  [/\bc\s?t\s+scan\b/gi, "CT scan"],
  [/\bu\s?s\s?g\b/gi, "USG"],
  [/\bx[\s-]?ray\b/gi, "X-ray"],
  [/\bi\s?c\s?u\b/gi, "ICU"],
  [/\bi\.?\s?v\.?\b(?=\s+(?:fluids?|line|cannula|antibiotics?|paracetamol|drip|infusion|access|push|bolus|\d))/gi, "IV"],
  [/\bi\s?m\b(?=\s+(?:injection|inj|\d))/gi, "IM"],
  [/\bt\s?d\s?s\b/gi, "TDS"],
  [/\bq\s?i\s?d\b/gi, "QID"],
  [/\bb\s?d\b/gi, "BD"],
  [/\bs\s?o\s?s\b/gi, "SOS"],
  [/\bp\s?r\s?n\b/gi, "PRN"],
  [/\bn\s?b\s?m\b/gi, "NBM"],
  [/\bn\s?p\s?o\b/gi, "NPO"],
  [/\bo\s?p\s?d\b/gi, "OPD"],
  [/\bi\s?p\s?d\b/gi, "IPD"],
  [/\bh\s?s\b(?=\s+(?:dose|at|night))/gi, "HS"],
  [/\bo\.?\s?d\.?\b(?=\s+(?:dose|daily|for|at|morning|night|\d)|[.,;]|$)/gi, "OD"],
  [/(?<=\b(?:mg|mcg|ml|g|iu|units?|tablets?|tabs?|caps?|capsules?)\s)o\s?d\b/gi, "OD"],
  [/\bj\s?v\s?p\b/gi, "JVP"],
  [/\bc\s?v\s?s\b/gi, "CVS"],
  [/\bc\s?n\s?s\b/gi, "CNS"],
  [/\bu\s?t\s?i\b/gi, "UTI"],
  [/\bc\s?o\s?p\s?d\b/gi, "COPD"],
  [/\bd\s?v\s?t\b/gi, "DVT"],
  [/\bm\s?i\b(?=\s+(?:patient|with|in|ward|\.|,|$))/gi, "MI"],
]

const UNIT_WORDS: [RegExp, string][] = [
  [/\b(\d+(?:\.\d+)?)\s*milli\s?grams?\b/gi, "$1 mg"],
  [/\b(\d+(?:\.\d+)?)\s*micro\s?grams?\b/gi, "$1 mcg"],
  [/\b(\d+(?:\.\d+)?)\s*kilo\s?grams?\b/gi, "$1 kg"],
  [/\b(\d+(?:\.\d+)?)\s*grams?\b/gi, "$1 g"],
  [/\b(\d+(?:\.\d+)?)\s*milli\s?li(?:tre|ter)s?\b/gi, "$1 ml"],
  [/\b(\d+(?:\.\d+)?)\s*li(?:tre|ter)s?\b/gi, "$1 L"],
  [/\b(\d+(?:\.\d+)?)\s*(?:centi\s?metres?|centi\s?meters?)\b/gi, "$1 cm"],
  [/\b(\d+(?:\.\d+)?)\s*milli\s?(?:metres?|meters?)\b/gi, "$1 mm"],
  [/\b(\d+(?:\.\d+)?)\s*(?:per\s?cent|percent)\b/gi, "$1%"],
  [/\b(\d+(?:\.\d+)?)\s*degrees?\s*(?:fahrenheit|f)\b/gi, "$1 °F"],
  [/\b(\d+(?:\.\d+)?)\s*degrees?\s*(?:celsius|centigrade|c)\b/gi, "$1 °C"],
  [/\bmilli\s?metres? of mercury\b|\bmm of mercury\b|\bmm hg\b/gi, "mmHg"],
  [/\b(\d+)\s*(?:per minute|a minute|beats per minute|bpm)\b/gi, "$1/min"],
  [/\b(\d+)\s*(?:breaths per minute)\b/gi, "$1/min"],
]

const SPOKEN_PUNCT: [RegExp, string][] = [
  [/\s*\b(?:full stop)\b\s*/gi, ". "],
  [/\s*\b(?:comma)\b\s*/gi, ", "],
  [/\s*\b(?:question mark)\b\s*/gi, "? "],
  [/\s*\b(?:new paragraph)\b\s*/gi, "\n\n"],
  [/\s*\b(?:new line|next line)\b\s*/gi, "\n"],
]

// ── vocabulary (the hospital's own lists) ────────────────────────────────────

let vocabCache: { at: number; map: Map<string, string> } | null = null
const VOCAB_TTL = 60_000

/** Lower-case word -> the spelling the hospital uses (a medicine's first word, a lab test's words). */
export function vocabulary(): Map<string, string> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL) return vocabCache.map
  const map = new Map<string, string>()
  const add = (term: string) => {
    for (const w of String(term || "").split(/[\s/,()+-]+/)) {
      const clean = w.replace(/[^A-Za-z0-9]/g, "")
      if (clean.length >= 6 && /[A-Za-z]{5}/.test(clean) && !map.has(clean.toLowerCase())) map.set(clean.toLowerCase(), clean)
    }
  }
  for (const t of extraVocabulary) add(t)
  vocabCache = { at: Date.now(), map }
  return map
}

const extraVocabulary: string[] = []
/** Screens register the hospital's term lists (medicine names, test names ...) once; they feed correction + the server prompt. */
export function registerVocabulary(terms: string[]) {
  let added = false
  for (const t of terms) {
    if (t && !extraVocabulary.includes(t)) {
      extraVocabulary.push(t)
      added = true
    }
  }
  if (added) vocabCache = null
}

function jaro(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (!la || !lb) return 0
  const dist = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const ma = new Array(la).fill(false)
  const mb = new Array(lb).fill(false)
  let m = 0
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - dist); j < Math.min(lb, i + dist + 1); j++) {
      if (!mb[j] && a[i] === b[j]) {
        ma[i] = mb[j] = true
        m++
        break
      }
    }
  }
  if (!m) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < la; i++) {
    if (ma[i]) {
      while (!mb[k]) k++
      if (a[i] !== b[k]) t++
      k++
    }
  }
  return (m / la + m / lb + (m - t / 2) / m) / 3
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  let p = 0
  while (p < 4 && a[p] && a[p] === b[p]) p++
  return j + p * 0.1 * (1 - j)
}

/** A near-miss of a hospital term becomes the term; anything not clearly close is left as heard. */
export function correctTerms(text: string, vocab: Map<string, string> = vocabulary()): string {
  if (!vocab.size) return text
  return text.replace(/[A-Za-z][A-Za-z0-9]{5,}/g, (word) => {
    const lw = word.toLowerCase()
    if (vocab.has(lw)) return vocab.get(lw)!
    let best = ""
    let score = 0
    for (const [k, v] of vocab) {
      if (Math.abs(k.length - lw.length) > 2 || k[0] !== lw[0]) continue
      const s = jaroWinkler(lw, k)
      if (s > score) {
        score = s
        best = v
      }
    }
    return score >= 0.94 ? best : word
  })
}

// ── the whole clean-up ───────────────────────────────────────────────────────

/** Capitalise the start of each sentence / line, tidy spacing around punctuation. */
function tidy(text: string): string {
  let t = text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:?!])/g, "$1")
    .replace(/([.,;:?!])(?=[A-Za-z])/g, "$1 ")
    .replace(/ *\n */g, "\n")
    .trim()
  t = t.replace(/(^|[.?!]\s+|\n)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
  return t
}

/** What was heard -> what would have been written. Safe to run on an already-clean text. */
export function cleanDictation(raw: string, vocab?: Map<string, string>): string {
  let t = String(raw || "").replace(/\s+/g, " ").trim()
  if (!t) return ""
  for (const [re, to] of SPOKEN_PUNCT) t = t.replace(re, to)
  // "<n> over <n>" blood pressure, before numbers become digits
  t = t.replace(/\b((?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)\s+)*(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))\s+over\s+((?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)\s+)*(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))\b/gi, (m, a: string, b: string) => {
    const x = spokenToNumber(a.toLowerCase().split(/\s+/))
    const y = spokenToNumber(b.toLowerCase().split(/\s+/))
    return x !== null && y !== null ? `${x}/${y}` : m
  })
  for (const [re, to] of SPELLED_EARLY) t = t.replace(re, to)
  t = convertNumbers(t)
  for (const [re, to] of UNIT_WORDS) t = t.replace(re, to)
  for (const [re, to] of SPELLED) t = t.replace(re, to)
  t = correctTerms(t, vocab)
  return tidy(t)
}

/** Join a new dictated chunk onto what is already in the box without gluing words or doubling spaces. */
export function appendDictation(existing: string, chunk: string): string {
  const add = chunk.trim()
  if (!add) return existing
  if (!existing.trim()) return add
  const base = existing.replace(/\s+$/, "")
  return existing.endsWith("\n") ? base + "\n" + add : base + " " + add
}
