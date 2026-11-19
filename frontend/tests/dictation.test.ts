import { cleanDictation, appendDictation, correctTerms, registerVocabulary, vocabulary } from "../src/utils/dictationText"

let failed = 0
const results: string[] = []
function eq(name: string, got: string, want: string) {
  const ok = got === want
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`))
}

registerVocabulary(["Paracetamol 500mg", "Amoxicillin", "Metformin", "Pantoprazole", "Atorvastatin", "Ceftriaxone", "Troponin", "Creatinine", "Hemoglobin"])
vocabulary()

// blood pressure and vitals
eq("blood pressure said as 'one twenty over eighty'", cleanDictation("bp one twenty over eighty"), "BP 120/80")
eq("bp with 'one thirty five over eighty five'", cleanDictation("blood pressure one thirty five over eighty five mm hg"), "Blood pressure 135/85 mmHg")
eq("pulse seventy two", cleanDictation("pulse seventy two per minute"), "Pulse 72/min")
eq("temperature ninety eight point six degrees fahrenheit", cleanDictation("temperature ninety eight point six degrees fahrenheit"), "Temperature 98.6 °F")
eq("spo2 ninety six percent", cleanDictation("s p o two ninety six percent on room air"), "SpO2 96% on room air")
eq("digits one by one: nine eight point six", cleanDictation("temp nine eight point six"), "Temp 98.6")
eq("one hundred and twenty", cleanDictation("sugar one hundred and twenty"), "Sugar 120")
// doses
eq("dose with milligram and schedule", cleanDictation("tab paracetamol five hundred milligram t d s for three days"), "Tab Paracetamol 500 mg TDS for 3 days")
eq("zero point five", cleanDictation("give zero point five milligram"), "Give 0.5 mg")
eq("abbreviations: o d, b d, s o s", cleanDictation("pantoprazole forty milligram o d and paracetamol s o s"), "Pantoprazole 40 mg OD and Paracetamol SOS")
eq("iv fluids", cleanDictation("start i v fluids"), "Start IV fluids")
// words that must stay words
eq("'one' as a pronoun is not a digit", cleanDictation("no one came and one of them left"), "No one came and one of them left")
eq("'period' and 'colon' (organs / history) are not punctuation", cleanDictation("colon cancer and last menstrual period"), "Colon cancer and last menstrual period")
// punctuation commands
eq("full stop, comma, new line", cleanDictation("patient is stable full stop plan comma continue antibiotics new line review tomorrow"), "Patient is stable. Plan, continue antibiotics\nReview tomorrow")
// hospital terms
eq("near-miss drug name is corrected to the hospital's spelling", cleanDictation("start amoxicilin and metformine"), "Start Amoxicillin and Metformin")
eq("an exact term gets the hospital's case", correctTerms("pantoprazole"), "Pantoprazole")
eq("an unrelated word is left alone", correctTerms("patient comfortable overnight"), "patient comfortable overnight")
// idempotent
const once = cleanDictation("bp one twenty over eighty pulse seventy two")
eq("cleaning clean text changes nothing", cleanDictation(once), once)
// appending
eq("append joins with one space", appendDictation("Patient stable.", "BP 120/80"), "Patient stable. BP 120/80")
eq("append after a new line", appendDictation("Plan:\n", "continue"), "Plan:\ncontinue")
eq("append into an empty box", appendDictation("", "  hello  "), "hello")

console.log(results.join("\n"))
console.log(failed ? `${failed} FAILED` : "ALL DICTATION CHECKS PASSED")
process.exit(failed ? 1 : 0)
