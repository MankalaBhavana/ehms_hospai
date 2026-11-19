import "./shim"
import { compileCardRecord, serverInsurance, serverLists } from "../src/components/patientRecord/patientRecord"

let failed = 0
const results: string[] = []
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + detail))
}

const payload = {
  patient: { patient_id: "PAT-777", name: "Asha", last_name: "Rao", age: 41, gender: "Female", blood_group: "B+", phone: "9848011122", address: "12 Lake View Road", allergies: "Penicillin", created_at: "2026-11-10T08:00:00" },
  hospital: { name: "Test Hospital" },
  events: [
    { stage: "er", label: "ER visit registered (ER-1)", timestamp: "2026-11-12T10:00:00" },
    { stage: "ot", label: "OT: Appendectomy — Completed", timestamp: "2026-11-13T09:00:00" },
    { stage: "documents", label: "Discharge summary uploaded: ds.pdf", timestamp: "2026-11-14T09:00:00" },
  ],
  summary: { total_billed: 1000, total_paid: 400, total_due: 600 },
  visits: [],
  bed: null,
  icu_days: [],
  prescriptions: [{ medicine_name: "Amoxicillin", dosage: "500 mg", status: "Dispensed", created_at: "2026-11-12T12:00:00", doctor_username: "drmehta" }],
  lab_orders: [{ test_name: "CBC", order_status: "completed", created_at: "2026-11-12T11:00:00" }],
  invoices: [{ invoice_no: "INV-1", module: "IP", total_amount: 1000, paid_amount: 400, due_amount: 600, payment_status: "partial", created_at: "2026-11-14T10:00:00" }],
  appointments: [],
  clinical_notes: [{ doctor_name: "Dr Mehta", note: "Stable, afebrile", treatment_plan: "Continue antibiotics", created_at: "2026-11-13T18:00:00" }],
  insurance: {
    policies: [{ insurer: "Star Health", tpa: "Medi Assist", policy_number: "••••7881", member_id: "••••5501", relationship: "Self", valid_until: "2027-12-31", sum_insured: 500000, balance_available: 500000, room_rent_per_day: 5000, icu_rent_per_day: 10000, copay_percentage: 10, status: "Active" }],
    cases: [{ case_id: "CLM-2026-1", status: "PREAUTH_APPROVED", encounter_type: "IP", department: "Inpatient", insurer: "Star Health", approved_pre_auth: 360000, approval_code: "AUTH-1", claimed: 0, approved_claim: 0, updated_at: "2026-11-13T00:00:00Z" }],
  },
}

;(async () => {
  let calls = 0
  ;(globalThis as any).fetch = async (url: string) => {
    calls++
    if (String(url).includes("/api/public/patient-card/GOODTOKEN0000000000000000")) return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })
    return new Response("{}", { status: 404 })
  }
  const res = await compileCardRecord("GOODTOKEN0000000000000000")
  const r = res.record!
  check("a card scan with no login opens the record", res.status === "ok" && !!r && r.found)
  check("allergies are shown", r.allergies === "Penicillin", String(r.allergies))
  check("prescriptions from the server are kept (not dropped)", r.server.prescriptions.length === 1 && r.server.prescriptions[0].medicine_name === "Amoxicillin")
  check("lab orders from the server are kept", r.server.labOrders.length === 1 && r.server.labOrders[0].test_name === "CBC")
  check("invoices from the server are kept", r.server.invoices.length === 1 && Number(r.server.invoices[0].due_amount) === 600)
  check("doctor notes and treatment plan from the server are kept", r.server.notes.length === 1 && r.server.notes[0].treatment_plan === "Continue antibiotics")
  check("insurance: the policy with its bed / ICU limits and co-pay", r.insurance.policies[0]?.room_rent_per_day === 5000 && r.insurance.policies[0].icu_rent_per_day === 10000 && r.insurance.policies[0].copay_percentage === 10)
  check("insurance: the policy number is partly hidden on a card scan", r.insurance.policies[0].policy_number.startsWith("•") && r.insurance.policies[0].policy_number.endsWith("7881"))
  check("insurance: approval and code", r.insurance.cases[0]?.approved_pre_auth === 360000 && r.insurance.cases[0].approval_code === "AUTH-1")
  check("ER, surgery and document events are on the timeline", ["er", "ot", "documents"].every((s) => r.timeline.some((t) => t.stage === s)))
  check("billing summary comes from the server", r.billing.billed === 1000 && r.billing.paid === 400 && r.billing.due === 600)
  check("the record is compiled fresh on every call (no stale copy)", (await compileCardRecord("GOODTOKEN0000000000000000")).record!.compiledAt >= r.compiledAt && calls === 2)

  const unknown = await compileCardRecord("WRONGTOKEN00000000000000000")
  check("an unknown card is refused without leaking anything", unknown.status === "unknown" && unknown.record === null)
  check("missing lists and insurance come back empty, not invented", serverLists(undefined).prescriptions.length === 0 && serverInsurance(null).policies.length === 0)

  console.log(results.join("\n"))
  console.log(failed ? `${failed} FAILED` : "ALL RECORD CHECKS PASSED")
  process.exit(failed ? 1 : 0)
})()
