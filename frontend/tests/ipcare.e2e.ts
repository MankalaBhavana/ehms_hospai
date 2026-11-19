import "./shim"
import { BedDatabase, type BedRecord } from "../src/services/bedDb"
import { IpCare, vitalsTimeline, dayOfStay, attentionFlags, isSameDoctor } from "../src/services/ipCare"
import { getAllDoctorAccounts } from "../src/services/doctorPortalDb"
import type { HandOff } from "../src/services/handoffs"
import { placeInvestigations, placePrescription } from "../src/services/ipOrders"
import { PharmacyDatabase } from "../src/services/pharmacyDb"

const results: string[] = []
let failed = 0
function step(name: string, fn: () => void) {
  try {
    fn()
    results.push("PASS  " + name)
  } catch (e) {
    failed++
    results.push("FAIL  " + name + " -> " + ((e as Error)?.message || e))
  }
}
const need = (c: unknown, m: string) => {
  if (!c) throw new Error(m)
}
const sent = (): HandOff[] => ((globalThis as any).__HANDOFFS__ ||= [])
const bed = (id: number, patient: string | null, over: Partial<BedRecord> = {}): BedRecord =>
  ({
    id,
    ward: "3N Medical/Surgical",
    room_no: "301",
    bed_no: `B${id}`,
    bed_type: "General",
    status: patient ? "Occupied" : "Available",
    daily_rate: 0,
    allocation_id: null,
    admission_id: patient ? 700 + id : null,
    allocated_at: null,
    admission_date: patient ? new Date().toISOString() : null,
    expected_discharge_date: null,
    patient_id: patient,
    patient_name: patient ? "Test" : null,
    patient_last_name: patient ? "Patient" : null,
    patient_phone: null,
    patient_age: 40,
    patient_gender: "Male",
    admission_notes: null,
    room_charges_so_far: null,
    ...over,
  }) as BedRecord

// doctors come from the doctor master
localStorage.setItem(
  "hospai_doctor_master_v3",
  JSON.stringify([
    { id: "D-1", name: "Rao", qualification: "MD", specialty: "General Medicine", section: "Main", verified: true, room: "R1", staffId: "STF-1" },
    { id: "D-2", name: "Mehta", qualification: "DM", specialty: "Cardiology", section: "Main", verified: true, room: "R2", staffId: "STF-2" },
  ]),
)
const [rao, mehta] = getAllDoctorAccounts()

step("ER names the concern doctor: the doctor is told at once, before any bed exists", () => {
  IpCare.recordReferral({ patientId: "PAT-1", patientName: "Test Patient", erVisitId: 5, visitNo: "ER-5", concernDoctorId: rao.id, concernDoctorName: rao.name, specialty: "General Medicine", reason: "Chest pain, needs observation", levelOfCare: "Inpatient ward", decidedBy: "Dr ER" })
  const n = sent().find((h) => h.kind.startsWith("Admission advised"))
  need(n && n.to === "doctor" && n.audience === rao.id, "no personal notice to the concern doctor: " + JSON.stringify(n))
  need(IpCare.openReferralFor("PAT-1")?.concernDoctorName === rao.name, "referral not stored")
})

step("a bed is allocated (any path): the case opens under the referred doctor, the doctor and the ward are told", () => {
  BedDatabase.save([bed(1, "PAT-1"), bed(2, null)])
  IpCare.reconcile()
  const c = IpCare.caseFor("PAT-1")
  need(c, "no case was opened")
  need(c!.attendingDoctorId === rao.id && c!.source === "ER" && c!.erVisitNo === "ER-5", "case lost the referral: " + JSON.stringify(c))
  need(c!.reason === "Chest pain, needs observation", "reason not carried over")
  need(IpCare.casesOfDoctor(rao).length === 1 && IpCare.casesOfDoctor(mehta).length === 0, "the case is not in exactly the concern doctor list")
  need(IpCare.openReferralFor("PAT-1") === undefined, "the fulfilled referral is still open")
  need(sent().some((h) => h.kind === "Admitted under you" && h.audience === rao.id), "the doctor was not told of the admission")
  need(sent().some((h) => h.to === "inpatient" && h.kind.startsWith("New admission")), "the ward was not told")
})

step("reconcile is repeatable: no second case, no second notice", () => {
  const before = sent().length
  IpCare.reconcile()
  IpCare.reconcile()
  need(IpCare.cases().length === 1, "duplicate case")
  need(sent().length === before, "notices were raised again")
})

step("a patient who gets a bed with no concern doctor is flagged and the ward is asked to assign one", () => {
  BedDatabase.save([bed(1, "PAT-1"), bed(2, "PAT-2", { patient_name: "No", patient_last_name: "Doctor" })])
  IpCare.reconcile()
  const c = IpCare.caseFor("PAT-2")
  need(c && !c.attendingDoctorId, "should have no attending doctor")
  need(IpCare.unassigned().length === 1, "not listed as unassigned")
  need(sent().some((h) => h.kind.startsWith("Admitted without a concern doctor") && h.urgent), "no urgent notice to assign a doctor")
  need(IpCare.casesOfDoctor(rao).every((x) => x.patientId !== "PAT-2"), "an unassigned patient leaked into a doctor list")
})

step("assigning the doctor puts the patient in that doctor list and tells them (a first assignment is not a handover)", () => {
  const c = IpCare.caseFor("PAT-2")!
  IpCare.assignAttending(c.id, mehta, "Bed desk")
  need(IpCare.casesOfDoctor(mehta).some((x) => x.patientId === "PAT-2"), "not in the new doctor list")
  need(IpCare.unassigned().length === 0, "still unassigned")
  need(sent().some((h) => h.kind === "Admitted under you" && h.audience === mehta.id), "doctor not told")
  need(IpCare.caseFor("PAT-2")!.handovers.length === 0, "a first assignment was recorded as a handover")
})

step("handing over to another doctor moves the patient, records it and tells the new doctor", () => {
  const c = IpCare.caseFor("PAT-1")!
  IpCare.assignAttending(c.id, mehta, rao.name, "going on leave")
  const after = IpCare.caseFor("PAT-1")!
  need(after.attendingDoctorId === mehta.id, "attending not changed")
  need(after.handovers.length === 1 && after.handovers[0].fromDoctorName === rao.name && after.handovers[0].reason === "going on leave", "handover not recorded: " + JSON.stringify(after.handovers))
  need(IpCare.casesOfDoctor(rao).length === 0 && IpCare.casesOfDoctor(mehta).length === 2, "lists did not move")
  need(sent().some((h) => h.kind === "Patient handed over to you" && h.audience === mehta.id), "new doctor not told")
})

step("a doctor account matches a case by id, staff id or name", () => {
  need(isSameDoctor(rao, "STF-1", null, null) && isSameDoctor(rao, null, "dr rao", null) && isSameDoctor(rao, null, null, "D-1"), "id / staff id / name matching")
  need(!isSameDoctor(rao, "D-2", "Dr. Mehta", "STF-2"), "matched the wrong doctor")
})

step("nurse and doctor notes, vitals timeline, and nothing invented", () => {
  const c = IpCare.caseFor("PAT-1")!
  IpCare.addNote({ patientId: "PAT-1", caseId: c.id, kind: "nurse", text: "Comfortable", vitals: { bp: "120/80", pulse: "72", spo2: "98" }, byId: "N1", byName: "Nurse A", byRole: "ROLE_NURSE", voice: true })
  IpCare.addNote({ patientId: "PAT-1", caseId: c.id, kind: "doctor", text: "Improving", plan: "Continue", byId: mehta.id, byName: mehta.name, byRole: "doctor" })
  let threw = false
  try {
    IpCare.addNote({ patientId: "PAT-1", caseId: c.id, kind: "nurse", text: "  ", byId: "N1", byName: "Nurse A", byRole: "ROLE_NURSE" })
  } catch {
    threw = true
  }
  need(threw, "an empty note was accepted")
  const tl = vitalsTimeline("PAT-1")
  need(tl.length === 1 && tl[0].v.bp === "120/80" && tl[0].by === "Nurse A", "vitals timeline: " + JSON.stringify(tl))
  need(IpCare.notes("PAT-1").length === 2 && IpCare.notes("PAT-2").length === 0, "notes leaked between patients")
  need(IpCare.notes("PAT-1").some((n) => n.kind === "nurse" && n.voice === true), "the dictated mark was lost")
})

step("doctor order to the nurses: STAT is flagged until acknowledged, then done", () => {
  const c = IpCare.caseFor("PAT-1")!
  const o = IpCare.addOrder({ patientId: "PAT-1", caseId: c.id, text: "Inj pantoprazole 40 mg IV now", priority: "stat", byDoctorId: mehta.id, byDoctorName: mehta.name })
  need(sent().some((h) => h.to === "inpatient" && h.kind === "STAT doctor order" && h.urgent), "nurses not told")
  need(attentionFlags(IpCare.caseFor("PAT-1")!).some((f) => f.includes("STAT")), "STAT order not flagged for attention")
  IpCare.updateOrder(o.id, "acknowledged", "Nurse A")
  need(!attentionFlags(IpCare.caseFor("PAT-1")!).some((f) => f.includes("STAT")), "still flagged after acknowledgement")
  IpCare.updateOrder(o.id, "done", "Nurse A", "given")
  const done = IpCare.orders("PAT-1")[0]
  need(done.status === "done" && done.doneNote === "given" && done.doneBy === "Nurse A", "done state not stored")
  let threw = false
  try {
    IpCare.addOrder({ patientId: "PAT-1", caseId: c.id, text: " ", priority: "routine", byDoctorId: "x", byDoctorName: "x" })
  } catch {
    threw = true
  }
  need(threw, "an empty order was accepted")
})

step("vitals overdue is flagged; day of stay counts the admission day as day 1", () => {
  const c = IpCare.caseFor("PAT-2")!
  need(attentionFlags(c, Date.now() + 9 * 3600_000).some((f) => f.includes("vitals")), "no overdue flag")
  need(dayOfStay(new Date().toISOString()) === 1 && dayOfStay(new Date(Date.now() - 2 * 86400000).toISOString()) === 3, "day of stay")
})

step("a transfer to another bed keeps the case; releasing the bed closes it; an empty bed list closes nothing", () => {
  BedDatabase.save([bed(3, "PAT-1", { ward: "ICU", bed_type: "ICU", admission_id: 701 }), bed(2, "PAT-2")])
  IpCare.reconcile()
  const c = IpCare.caseFor("PAT-1")!
  need(c.ward === "ICU" && c.bedNo === "B3" && IpCare.cases().filter((x) => x.patientId === "PAT-1").length === 1, "transfer should update the same case")
  BedDatabase.save([bed(3, null), bed(2, "PAT-2")])
  IpCare.reconcile()
  need(!IpCare.caseFor("PAT-1") && IpCare.cases().find((x) => x.patientId === "PAT-1")?.status === "discharged", "case did not close")
  BedDatabase.save([])
  IpCare.reconcile()
  need(IpCare.caseFor("PAT-2"), "an empty bed list (not loaded yet) must not close every case")
})

step("in-patient orders: lab test + x-ray go to the billing desk under the stay, medicines go to the pharmacy queue", () => {
  BedDatabase.save([bed(2, "PAT-2")])
  IpCare.reconcile()
  const c = IpCare.caseFor("PAT-2")!
  const before = sent().length
  const r = placeInvestigations(c, mehta, [{ name: "CBC", kind: "Laboratory", group: "Haematology", price: 0 }, { name: "Chest X-Ray", kind: "Radiology", group: "X-Ray", price: 0 }], "STAT", "fever 3 days")
  need(r.labOrder && r.labOrder.umr === "PAT-2" && r.labOrder.status === "Awaiting Billing" && r.labOrder.tests.length === 1, "lab order not created / not awaiting billing: " + JSON.stringify(r.labOrder?.status))
  need(r.labOrder!.encounterId === `IP-${c.admissionId}` && r.labOrder!.department === c.ward, "lab order not tied to the admission")
  need(r.labOrder!.tests[0].urgency === "STAT", "urgency lost")
  need(r.studies.length === 1 && r.studies[0].study === "Chest X-Ray" && r.studies[0].paymentStatus === "Payment Pending", "radiology study not created pending payment")
  need(sent().slice(before).some((h) => h.to === "labBilling" && h.kind.startsWith("Lab order")), "lab billing desk not told of the lab order")
  need(sent().slice(before).some((h) => h.to === "labBilling" && h.kind.startsWith("Radiology order")), "lab billing desk not told of the radiology order")
  let threw = false
  try { placeInvestigations(c, mehta, [], "Routine", "") } catch { threw = true }
  need(threw, "an empty investigation order was accepted")

  const rx = placePrescription(c, mehta, [{ label: "Pantoprazole 40 mg", dose: "1 vial", frequency: "BD", route: "IV", duration: "3 days", quantity: 6, instructions: "slow push" }], true)
  need(rx.status === "Sent To Pharmacy" && rx.priority === "Urgent" && rx.patientId === "PAT-2" && rx.items[0].quantity === 6 && rx.items[0].route === "IV", "prescription wrong: " + JSON.stringify(rx).slice(0, 200))
  need(rx.visitId === `IP-${c.admissionId}`, "prescription not tied to the admission")
  need(PharmacyDatabase.getPrescriptions().some((p) => p.id === rx.id), "prescription not in the pharmacy queue")
  need(sent().some((h) => h.to === "pharmacy" && h.kind === "Urgent in-patient medicines" && h.urgent), "pharmacy not told")
  threw = false
  try { placePrescription(c, mehta, [{ label: "Paracetamol", dose: "", frequency: "TDS", route: "Oral", duration: "3 days", quantity: 1 }], false) } catch { threw = true }
  need(threw, "a prescription with no dose was accepted")
  threw = false
  try { placePrescription(c, mehta, [], false) } catch { threw = true }
  need(threw, "an empty prescription was accepted")
})

console.log(results.join("\n"))
console.log(failed ? `${failed} FAILED` : "ALL IP CARE CHECKS PASSED")
process.exit(failed ? 1 : 0)
