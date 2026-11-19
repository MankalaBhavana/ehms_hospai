/**
 * Feeds the dictation engines the hospital own term lists: the pharmacy medicine master (brand + generic names) and
 * the laboratory catalogue. Loaded on first use of the microphone, not at start-up (both lists are large).
 */
import { registerVocabulary } from "../utils/dictationText"

let loaded = false

export async function loadHospitalVocabulary(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const [{ PharmacyDatabase }, { ALL_LAB_TESTS }] = await Promise.all([import("./pharmacyDb"), import("../components/laboratory/labCatalogueSchema")])
    const terms: string[] = []
    for (const m of PharmacyDatabase.getMedicines()) terms.push(m.medicineName, m.genericName, m.brandName, m.name || "")
    for (const t of ALL_LAB_TESTS) terms.push(t.name)
    registerVocabulary(terms.filter(Boolean))
  } catch {
    loaded = false // try again next time; dictation works without the lists
  }
}
