import "./shim"
import { db, isHeldForPayment } from "../src/services/db"
import { bookAppointment } from "../src/services/appointmentBooking"
import { BillingDatabase } from "../src/services/billingDb"
import { doesDoctorMatchEncounter } from "../src/services/doctorPortalDb"
import { saveDoctorMaster } from "../src/services/doctorMaster"

let failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`)
  if (!ok) failed++
}

async function main() {
  saveDoctorMaster([
    {
      id: "DOC-9001", name: "Dr. Test Rao", qualification: "MBBS", specialty: "General Medicine", section: "Main",
      verified: true, username: "drrao", room: "Room 7", staffId: "DOC-9001", consultationFee: 600,
    } as any,
  ])

  // reception has already registered the patient (existing-encounter booking path)
  const { encounter } = db.registerNewPatient(
    { firstName: "Asha", lastName: "Verma", age: 34, sex: "Female", phone: "9000000001", dept: "General Medicine", chiefComplaint: "fever" },
    { patient_id: "PAT-T1", encounter_id: "ENC-T1", op_number: "OP-T1" },
  )

  const booked = await bookAppointment({
    encounterId: encounter.id, time: "10:30", patient: "Asha Verma", age: 34, sex: "Female", phone: "9000000001",
    complaint: "fever", dept: "General Medicine", doctor: "Dr. Test Rao", registryType: "OP",
  })
  check("booking reports the consultation fee", booked.consultationFee === 600, String(booked.consultationFee))

  let enc = db.getEncounterById(encounter.id)!
  check("encounter is held for payment", isHeldForPayment(enc))

  // ---- billing reflects the appointment immediately
  const claims = BillingDatabase.getClaims().filter((c) => (c.encounterId || "").toLowerCase() === encounter.id.toLowerCase())
  check("a bill exists in Billing right after booking", claims.length === 1, `claims=${claims.length}`)
  const claim = claims[0]
  const consult = (claim?.items || []).find((i) => String(i.category) === "Consultation")
  check("the bill carries the consultation fee", Boolean(consult) && consult!.total === 600, JSON.stringify(consult))
  check("the bill is unpaid", Boolean(claim) && claim.balanceDue > 0 && (claim.amountPaid || 0) === 0, `due=${claim?.balanceDue} paid=${claim?.amountPaid}`)

  // ---- the doctor and the nurse do not get the patient yet
  const doctor = { id: "DOC-9001", name: "Dr. Test Rao", staffId: "DOC-9001", username: "drrao" }
  check("doctor does NOT see the held patient", !doesDoctorMatchEncounter(doctor, enc))
  db.callToNurseStation(encounter.id, "OP Desk")
  db.callToDoctor(encounter.id, "OP Desk")
  enc = db.getEncounterById(encounter.id)!
  check("held patient cannot be called through to nurse / doctor", !enc.timestamps?.calledToNurse && !enc.timestamps?.calledToDoctor)

  // ---- paying the consultation fee releases the patient
  BillingDatabase.recordPayment(claim.id, { amount: claim.balanceDue, paymentMethod: "Cash" as any, collectedBy: "tester" })
  enc = db.getEncounterById(encounter.id)!
  check("payment releases the hold", !isHeldForPayment(enc), `billing=${enc.billing?.status} hold=${enc.paymentHold}`)
  check("doctor sees the patient once paid", doesDoctorMatchEncounter(doctor, enc))

  // ---- an authorised exception releases without payment
  const second = db.registerNewPatient(
    { firstName: "Ravi", lastName: "Kumar", age: 40, sex: "Male", phone: "9000000002", dept: "General Medicine", chiefComplaint: "cough" },
    { patient_id: "PAT-T2", encounter_id: "ENC-T2", op_number: "OP-T2" },
  ).encounter
  await bookAppointment({
    encounterId: second.id, time: "11:00", patient: "Ravi Kumar", age: 40, sex: "Male", phone: "9000000002",
    complaint: "cough", dept: "General Medicine", doctor: "Dr. Test Rao", registryType: "OP",
  })
  check("second patient is held", isHeldForPayment(db.getEncounterById(second.id)))
  db.releasePaymentHold(second.id, "Reception", "Staff relative - approved by administrator")
  const released = db.getEncounterById(second.id)!
  check("exception release works and the reason is recorded", !isHeldForPayment(released) && released.paymentHoldReleaseReason === "Staff relative - approved by administrator")
  check("a released patient still has an unpaid bill in Billing",
    BillingDatabase.getClaims().some((c) => (c.encounterId || "").toLowerCase() === second.id.toLowerCase() && c.balanceDue > 0))

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed")
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
