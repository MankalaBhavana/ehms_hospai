// Micro-benchmark: how long the claim/case lookups take as data grows (run: npm run bench).
import "./shim"
import { BillingDatabase } from "../src/services/billingDb"
import { InsuranceEngineService as E } from "../src/services/insuranceDb"
import { db } from "../src/services/db"

const t = <T,>(label: string, fn: () => T, runs = 5) => {
  fn() // warm
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) fn()
  const ms = (performance.now() - t0) / runs
  console.log(label.padEnd(44), ms.toFixed(1).padStart(8), "ms")
  return ms
}

const N = Number(process.env.N || 300)
for (let i = 0; i < N; i++) {
  BillingDatabase.createClaim({
    patientId: "UMR" + (10000 + i), patientName: "Patient " + i, mrn: String(i), age: 40, gender: "Male", phone: "9",
    department: i % 3 === 0 ? "Inpatient" : i % 3 === 1 ? "Outpatient" : "Emergency", carePathway: "x", dateOfService: "2026-11-12",
    insuranceProvider: i % 3 === 0 ? "Star Health" : "Self-Pay", status: "Draft", encounterId: "ENC-" + i,
    items: Array.from({ length: 6 }, (_, k) => ({ id: `i${i}-${k}`, description: "Item " + k, category: "Consultation", cptCode: "", quantity: 1, unitPrice: 500, total: 500, insuranceCovered: 0, patientPayable: 500 })),
  } as any)
}
for (let i = 0; i < N; i++) {
  const { encounter } = db.registerNewPatient({ firstName: "Op" + i, lastName: "Patient", age: 30 + (i % 40), sex: "Male", phone: "98" + String(10000000 + i), dept: "General Medicine" } as any)
  db.updateEncounter(encounter.id, { assignedDoctor: "Dr A", status: i % 2 ? "Consultation Completed" : "In Queue" } as any)
}
console.log(`data: ${N} bills + ${N} OP encounters`)
const a = t("BillingDatabase.getClaims()", () => BillingDatabase.getClaims())
const b = t("InsuranceEngineService.getClaims()", () => E.getClaims())
console.log("encounters:", db.getEncounters().length, "patients:", db.getPatients().length)
console.log(`a screen that calls both on every render pays ~${(a + b).toFixed(0)} ms each time`)
