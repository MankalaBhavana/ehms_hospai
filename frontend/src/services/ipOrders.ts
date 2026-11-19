/**
 * Investigations and medicines ordered for an admitted patient (from the in-patient screen).
 *
 *  - Laboratory orders go to the lab billing desk first (the laboratory sees them once they are paid), exactly like an ICU
 *    or OP order; radiology studies the same way, with the stay's investigation bill.
 *  - Medicines go into the pharmacy prescription queue and the pharmacy is told.
 * Prices are whatever Administration set; an unpriced item is never given a made-up price.
 */
import { BillingDatabase } from "./billingDb"
import { LabOrderDatabase, priceForTest } from "./labOrdersDb"
import { PharmacyDatabase, type AppPrescription } from "./pharmacyDb"
import { handOff } from "./handoffs"
import { getModalityForTest, getRoomForModality } from "../utils/testClassifier"
import type { IpCase } from "./ipCare"
import type { DoctorAccount } from "./doctorPortalDb"

export interface Orderable {
  name: string
  kind: "Laboratory" | "Radiology"
  group: string
  price: number
}

export interface RxLine {
  medicineId?: string
  label: string
  dose: string
  frequency: string
  route: string
  duration: string
  quantity: number
  instructions?: string
}

/** The encounter an in-patient order hangs on: one per admission, so the stay's investigations bill together. */
export function ipEncounter(c: IpCase) {
  return {
    id: `IP-${c.admissionId ?? c.patientId}`,
    umr: c.patientId,
    patientName: c.patientName,
    opNumber: `IP/${c.bedNo}`,
    dept: c.ward,
    assignedDoctor: c.attendingDoctorName || undefined,
    diagnosis: c.reason || undefined,
  }
}

export function placeInvestigations(c: IpCase, doctor: DoctorAccount | undefined, picked: Orderable[], urgency: "Routine" | "STAT", notes: string) {
  if (!picked.length) throw new Error("Pick at least one test.")
  const enc = ipEncounter(c)
  const by = doctor?.name || c.attendingDoctorName || "Doctor"
  const labs = picked.filter((p) => p.kind === "Laboratory")
  const rads = picked.filter((p) => p.kind === "Radiology")
  let labOrder: ReturnType<typeof LabOrderDatabase.createOrder> | undefined
  const studies: ReturnType<typeof BillingDatabase.createRadiologyStudy>[] = []
  if (labs.length) {
    labOrder = LabOrderDatabase.createOrder({
      encounterId: enc.id,
      umr: c.patientId,
      patientName: c.patientName,
      age: 0,
      sex: "",
      phone: "",
      opNumber: enc.opNumber,
      doctorId: doctor?.id || "",
      doctorName: by,
      department: c.ward,
      diagnosis: c.reason || "",
      clinicalNotes: notes.trim() || undefined,
      tests: labs.map((t) => ({ name: t.name, urgency })),
    })
  }
  const today = new Date().toISOString().slice(0, 10)
  rads.forEach((t, idx) => {
    const modality = getModalityForTest(t.name)
    studies.push(
      BillingDatabase.createRadiologyStudy({
        id: `RAD-${Date.now().toString().slice(-6)}-${idx + 1}`,
        patient: c.patientName,
        mrn: c.patientId,
        umr: c.patientId,
        encounterId: enc.id,
        opNumber: enc.opNumber,
        department: c.ward,
        diagnosis: c.reason || "",
        study: t.name,
        modality,
        priority: urgency === "STAT" ? "STAT" : "Routine",
        ordered: `${today} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        orderDate: today,
        provider: by,
        status: "Orders",
        room: getRoomForModality(modality),
        price: t.price || priceForTest(t.name),
        paymentStatus: "Payment Pending",
        paymentStatusDisplay: "PENDING",
        isPaid: false,
        indication: notes.trim() || c.reason || "In-patient order",
        technique: `Diagnostic ${modality} imaging scan`,
      } as any),
    )
  })
  if (studies.length) {
    BillingDatabase.ensureConsolidatedInvestigationClaim({
      encounter: enc,
      doctor: doctor ? { id: doctor.id, name: doctor.name, staffId: doctor.staffId, specialty: doctor.specialty } : undefined,
      labOrder,
      radiologyStudies: studies,
    })
    handOff({
      to: "labBilling",
      from: `${c.ward} · ${by}`,
      patientName: c.patientName,
      patientId: c.patientId,
      kind: "Radiology order — payment pending",
      note: studies.map((s) => s.study).slice(0, 3).join(", "),
      ref: `${studies[0].id}:bill`,
      urgent: urgency === "STAT",
    })
  }
  return { labOrder, studies }
}

export function placePrescription(c: IpCase, doctor: DoctorAccount | undefined, lines: RxLine[], urgent: boolean): AppPrescription {
  if (!lines.length) throw new Error("Add at least one medicine.")
  const bad = lines.find((r) => !r.dose.trim() || !r.frequency.trim() || !r.duration.trim())
  if (bad) throw new Error(`${bad.label || "A medicine"}: dose, frequency and duration are required.`)
  const stamp = new Date()
  const by = doctor?.name || c.attendingDoctorName || "Doctor"
  const rx: AppPrescription = {
    id: `RX-${stamp.getTime().toString(36).toUpperCase()}`,
    patientId: c.patientId,
    patientName: c.patientName,
    uhid: c.patientId,
    visitId: `IP-${c.admissionId ?? c.patientId}`,
    doctorId: doctor?.id || "",
    doctorName: by,
    department: `${c.ward} · Bed ${c.bedNo}`,
    diagnosis: c.reason || undefined,
    date: stamp.toISOString().split("T")[0],
    arrivalTime: stamp.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
    sourceType: "DIGITAL",
    priority: urgent ? "Urgent" : "Normal",
    status: "Sent To Pharmacy",
    dispensingStatus: "Waiting",
    items: lines.map((r, i) => ({
      id: `${stamp.getTime().toString(36)}-${i}`,
      medicineName: r.label,
      medicineId: r.medicineId || undefined,
      dosage: r.dose.trim(),
      frequency: r.frequency.trim(),
      duration: r.duration.trim(),
      route: r.route,
      instructions: r.instructions?.trim() || undefined,
      quantity: Math.max(1, Number(r.quantity) || 1),
      substitutionAllowed: false,
    })),
    verificationNotes: `In-patient prescription: ${c.ward}, Room ${c.roomNo}, Bed ${c.bedNo}. Written by ${by}.`,
    createdAt: stamp.toISOString(),
  }
  PharmacyDatabase.savePrescriptions([rx, ...PharmacyDatabase.getPrescriptions()])
  handOff({
    to: "pharmacy",
    from: `${c.ward} · ${by}`,
    patientName: c.patientName,
    patientId: c.patientId,
    kind: urgent ? "Urgent in-patient medicines" : "In-patient medicines to dispense",
    note: `${lines.length} medicine(s) · ${c.ward} Bed ${c.bedNo}`,
    ref: `${rx.id}:rx`,
    urgent,
  })
  return rx
}
