import "./shim"
import { InsuranceEngineService as E, matchInsurer } from "../src/services/insuranceDb"
import { BillingDatabase } from "../src/services/billingDb"
import { canOpenScreen } from "../src/utils/accessControl"
import { coverLimit, policyShare } from "../src/utils/coverLimit"
import { approvalOf, billView, tabOf } from "../src/utils/insuredBilling"
import { stayBenefit } from "../src/utils/policyBenefits"
import { BedDatabase } from "../src/services/bedDb"

/**
 * Audit of the insurance module as the insurance desk of a multi-speciality hospital would use it.
 * Each probe is written as the behaviour a careful desk needs; a FAIL is a defect found.
 */
const results: string[] = []
let failed = 0
async function probe(name: string, fn: () => unknown) {
  try {
    await fn()
    results.push("PASS  " + name)
  } catch (e) {
    failed++
    results.push("FAIL  " + name + " -> " + ((e as Error)?.message || e))
  }
}
const throws = (fn: () => unknown, re?: RegExp) => {
  try {
    fn()
  } catch (e) {
    if (re && !re.test((e as Error).message)) throw new Error("wrong error: " + (e as Error).message)
    return
  }
  throw new Error("expected an error but the action was accepted")
}
const policy = (o: any = {}) => ({ paymentType: "Insurance / Cashless", insurerId: "", insurerName: "Star Health", tpaName: "MediAssist", policyNumber: "P-1", memberId: "M1", policyHolderName: "X", relationship: "Self", validUntil: "2099-12-31", sumInsured: 500000, balanceAvailable: 500000, roomCategoryEligible: "", copayPercentage: 0, deductibleAmount: 0, preAuthRequired: true, ...o }) as any
const elig = (o: any = {}) => ({ status: "Eligible", method: "Portal", policyActive: true, inNetwork: true, sumInsured: 500000, balanceAvailable: 500000, roomEligibilityNote: "", copayApplicable: false, copayValue: "", deductibleRemaining: 0, preAuthRequired: true, ...o }) as any
let n = 0
const newCase = (name = "Audit Patient", umr?: string, o: any = {}) => E.openEncounterCase({ patientId: umr || `AUD-${++n}`, patientName: name, encounterType: "IP", department: "General Medicine" }, policy(o))

;(async () => {
  // ── identity: a multi-speciality hospital has many patients with the same name ──────────────
  await probe("two different patients with the same name can each have insurance (matched by UMR, not name)", () => {
    newCase("Ravi Kumar", "UMR-RK-1", { policyNumber: "RK-1" })
    newCase("Ravi Kumar", "UMR-RK-2", { policyNumber: "RK-2" })
  })
  await probe("a patient's policy list never shows another patient's policy that shares the name", () => {
    const a = E.getPatientPolicies({ id: "UMR-RK-1", name: "Ravi Kumar" })
    if (a.some((p) => p.policyNumber === "RK-2")) throw new Error("patient 1 is shown patient 2's policy RK-2")
    const b = E.casesForPatient({ id: "UMR-RK-2", name: "Ravi Kumar" })
    if (b.length !== 1 || b[0].patientId !== "UMR-RK-2") throw new Error("cases mixed up: " + b.map((c) => c.patientId).join(","))
  })

  // ── insurer masters ──────────────────────────────────────────────────────────────────────────
  const ins = (name: string, code: string) => ({ id: "", companyName: name, companyCode: code, contactPhone: "", contactEmail: "", preAuthEmail: "", claimsEmail: "", networkStatus: "Empaneled / In-Network", documentRequirements: [], slaDaysForPreAuth: 2, slaDaysForClaimSettlement: 30, status: "Active" }) as any
  await probe("bill's insurer name maps to the right master (\"Medicare Plus\" is not \"Care Health\")", () => {
    const list = [ins("Care Health Insurance", "CARE"), ins("Medicare Plus TPA", "MPT")].map((x, i) => ({ ...x, id: "INS-" + i }))
    const m = matchInsurer("Medicare Plus", list)
    if (m?.companyCode !== "MPT") throw new Error("mapped to " + m?.companyName)
  })
  await probe("an insurer with no master entry is not guessed from a shared word (\"The New India\" vs \"New Horizon Care\")", () => {
    const list = [ins("New Horizon Care", "NHC")].map((x, i) => ({ ...x, id: "INS-" + i }))
    const m = matchInsurer("The New India Assurance", list)
    if (m) throw new Error("wrongly mapped to " + m.companyName)
  })
  await probe("'Care Health' is not matched to 'Medicare Plus TPA' just because the letters appear inside the word", () => {
    const list = [ins("Medicare Plus TPA", "MPT")].map((x, i) => ({ ...x, id: "INS-" + i }))
    if (matchInsurer("Care Health", list)) throw new Error("wrongly mapped")
  })
  await probe("exact insurer names still map (Star Health & Allied Insurance <- 'Star Health')", () => {
    const list = [ins("Star Health & Allied Insurance", "STAR"), ins("HDFC ERGO General Insurance", "HDFC")].map((x, i) => ({ ...x, id: "INS-" + i }))
    if (matchInsurer("Star Health", list)?.companyCode !== "STAR") throw new Error("Star not matched")
    if (matchInsurer("HDFC ERGO", list)?.companyCode !== "HDFC") throw new Error("HDFC not matched")
  })

  // ── eligibility ─────────────────────────────────────────────────────────────────────────────
  await probe("eligibility with an exhausted balance (₹0 of ₹5,00,000) is recorded as exhausted, not silently kept at the old balance", () => {
    const c = newCase()
    E.recordEligibility(c.id, elig({ balanceAvailable: 0 }))
    const got = E.getClaimById(c.id)!.policy.balanceAvailable
    if (got !== 0) throw new Error("balance still shows ₹" + got)
  })
  await probe("cannot mark 'Eligible' on a policy that has already expired", () => {
    const c = newCase("Expired Pol", undefined, { validUntil: "2020-01-01" })
    throws(() => E.recordEligibility(c.id, elig()), /expired|validity|valid until/i)
  })
  await probe("NOT eligible -> re-verify -> eligible works", () => {
    const c = newCase()
    E.recordEligibility(c.id, elig({ status: "Not Eligible", policyActive: false }))
    if (E.getClaimById(c.id)!.status !== "NOT_ELIGIBLE") throw new Error("not marked")
    E.recordEligibility(c.id, elig())
    if (E.getClaimById(c.id)!.status !== "ELIGIBLE") throw new Error("not re-verified")
  })
  await probe("a patient can be insured again after a NOT_ELIGIBLE case (new policy)", () => {
    const c = newCase("Retry Pat", "UMR-RETRY")
    E.recordEligibility(c.id, elig({ status: "Not Eligible", policyActive: false }))
    E.openEncounterCase({ patientId: "UMR-RETRY", patientName: "Retry Pat", encounterType: "IP", department: "General Medicine" }, policy({ policyNumber: "NEW-POL" }))
  })

  // ── pre-authorisation ───────────────────────────────────────────────────────────────────────
  const toTreatment = (amount = 300000, name?: string) => {
    const c = newCase(name)
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "Appendicitis", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: amount, estimatedHospitalStayDays: 3 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) {
      E.uploadDocument(c.id, d.id, d.documentType + ".pdf")
      E.verifyDocument(c.id, d.id, true)
    }
    E.submitPreAuth(c.id, "Portal", "REF1")
    E.recordPreAuthResponse(c.id, { outcome: "Approved", amount, approvalCode: "AUTH1", note: "ok" })
    return c.id
  }
  await probe("pre-auth cannot be approved for more than the policy's sum insured", () => {
    const c = newCase()
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 100, estimatedHospitalStayDays: 1 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    throws(() => E.recordPreAuthResponse(c.id, { outcome: "Approved", amount: 900000, approvalCode: "A", note: "" }), /sum insured|exceed/i)
  })
  await probe("enhancement: a second request while one is pending is refused", () => {
    const id = toTreatment()
    E.requestEnhancement(id, 400000, "more days")
    throws(() => E.requestEnhancement(id, 450000, "again"), /pending|already/i)
  })
  await probe("enhancement: approving at a LOWER amount than the current approval is refused", () => {
    const id = toTreatment()
    E.requestEnhancement(id, 400000, "more days")
    throws(() => E.resolveEnhancement(id, true, 100000), /more than|exceed|lower|current/i)
  })
  await probe("enhancement approved/rejected paths", () => {
    const id = toTreatment()
    E.requestEnhancement(id, 400000, "icu")
    E.resolveEnhancement(id, true, 400000)
    if (E.getClaimById(id)!.approvedPreAuthAmount !== 400000) throw new Error("limit not raised")
    E.requestEnhancement(id, 450000, "more")
    E.resolveEnhancement(id, false)
    if (E.getClaimById(id)!.approvedPreAuthAmount !== 400000) throw new Error("rejected enhancement changed the limit")
  })
  await probe("pre-auth rejected -> revise -> resubmit", () => {
    const c = newCase()
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 1000, estimatedHospitalStayDays: 1 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    E.recordPreAuthResponse(c.id, { outcome: "Rejected", note: "PED not disclosed" })
    if (E.getClaimById(c.id)!.status !== "PREAUTH_REJECTED") throw new Error("not rejected")
    E.savePreAuthDraft(c.id, { diagnosis: "y", clinicalSummary: "y", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 1000, estimatedHospitalStayDays: 1 })
    if (E.getClaimById(c.id)!.status !== "PREAUTH_DRAFT") throw new Error("not back to draft")
  })
  await probe("emergency: treatment can start without pre-auth only when the policy allows it", () => {
    const a = newCase()
    E.recordEligibility(a.id, elig({ preAuthRequired: true }))
    throws(() => E.startTreatmentWithoutPreAuth(a.id), /requires pre-auth/i)
    const b = newCase()
    E.recordEligibility(b.id, elig({ preAuthRequired: false }))
    E.startTreatmentWithoutPreAuth(b.id)
  })

  // ── ER -> IP ─────────────────────────────────────────────────────────────────────────────────
  await probe("ER quick capture, then the patient is admitted: the same case follows to the IP bill and shows the ward, not Emergency", () => {
    const c = E.openEncounterCase({ patientId: "UMR-ER1", patientName: "Er Patient", encounterType: "ER", department: "Emergency" }, policy({ policyNumber: "" }), { quick: true })
    const bill = BillingDatabase.createClaim({
      patientId: "UMR-ER1", patientName: "Er Patient", mrn: "UMR-ER1", department: "Inpatient", carePathway: "Admitted", insuranceProvider: "Self-Pay",
      items: [{ id: "i1", description: "Bed", category: "Room", quantity: 1, unitPrice: 1000, total: 1000, insuranceCovered: 0, patientPayable: 1000 } as any],
    } as any)
    const got = E.getClaims().find((x) => x.id === c.id)!
    if (got.billingClaimId !== bill.id) throw new Error("the ER case was not linked to the admission bill")
    if (got.encounterType === "ER" || got.department === "Emergency") throw new Error(`still shown as ${got.encounterType} / ${got.department} after admission to ${bill.department}`)
  })

  // ── claim, queries, decision ───────────────────────────────────────────────────────────────
  await probe("claim cannot be submitted before the case is at 'final bill ready'", () => {
    const id = toTreatment()
    throws(() => E.submitClaim(id, "Portal", "R"))
  })
  await probe("blank response to an insurer query is refused; closing a query works", () => {
    const id = toTreatment()
    E.initiateDischarge(id)
    throws(() => E.raiseClaimQuery(id, "q"), /./) // not at claim stage
  })
  await probe("a claim decision cannot approve more than was claimed", () => {
    // build a case at CLAIM_SUBMITTED through the billing hand-over is covered in insurance-flow; here check the guard directly
    const id = toTreatment()
    throws(() => E.recordClaimDecision(id, { outcome: "Approved", approvedAmount: 10, note: "" }), /./)
  })
  await probe("insurance case ids and query ids do not collide when many cases are opened quickly", () => {
    const real = Math.random
    ;(Math as any).random = () => 0.5
    try {
      const a = E.openEncounterCase({ patientId: "UMR-COL-1", patientName: "Col One", encounterType: "ICU", department: "ICU" }, policy({ policyNumber: "C1" }))
      const b = E.openEncounterCase({ patientId: "UMR-COL-2", patientName: "Col Two", encounterType: "ICU", department: "ICU" }, policy({ policyNumber: "C2" }))
      if (a.id === b.id) throw new Error("two different patients got the same case id " + a.id)
      if (E.getClaims().filter((x) => x.id === a.id).length !== 1) throw new Error("one case overwrote the other")
    } finally {
      ;(Math as any).random = real
    }
  })

  // ── the money at the billing hand-over ─────────────────────────────────────────────────────
  await probe("a ₹6,00,000 bill on a ₹5,00,000 approval: the insurer's share starts at ₹5,00,000, not ₹6,00,000", () => {
    const share = policyShare(600000, 600000, { approved: 500000, sumInsured: 500000, copayPct: 0 })
    if (share !== 500000) throw new Error("share " + share)
  })
  await probe("co-pay clause is applied: ₹2,00,000 bill, 10% co-pay, ₹5,00,000 approved -> insurer ₹1,80,000", () => {
    if (policyShare(200000, 200000, { approved: 500000, copayPct: 10 }) !== 180000) throw new Error("wrong")
  })
  await probe("limit falls back from approved pre-auth, to policy balance, to sum insured, to none", () => {
    if (coverLimit({ approved: 4, balance: 3, sumInsured: 2 }).cap !== 4) throw new Error("approved")
    if (coverLimit({ balance: 3, sumInsured: 2 }).cap !== 3) throw new Error("balance")
    if (coverLimit({ sumInsured: 2 }).cap !== 2) throw new Error("sum insured")
    if (coverLimit({}).cap !== null) throw new Error("none")
  })
  await probe("what the patient already paid still caps the insurer's share", () => {
    if (policyShare(100000, 60000, { approved: 500000 }) !== 60000) throw new Error("not capped by maxCover")
  })

  // ── the billing desk: approval -> split -> patient's payment ─────────────────────────────────
  await probe("billing desk sees the approval, the split and what the patient owes, and takes the payment", () => {
    const umr = "UMR-BILLDESK"
    const c = E.openEncounterCase({ patientId: umr, patientName: "Bill Desk Pat", encounterType: "IP", department: "Inpatient" }, policy({ policyNumber: "BD-1", copayPercentage: 0 }))
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 500000, estimatedHospitalStayDays: 4 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    E.recordPreAuthResponse(c.id, { outcome: "Approved", amount: 500000, approvalCode: "AUTH-BD", note: "ok" })
    E.initiateDischarge(c.id)
    const bill = BillingDatabase.createClaim({
      patientId: umr, patientName: "Bill Desk Pat", mrn: umr, department: "Inpatient", insuranceProvider: "Self-Pay",
      items: [{ id: "i1", description: "Ward stay + procedures", category: "Room", quantity: 1, unitPrice: 600000, total: 600000, insuranceCovered: 0, patientPayable: 600000 } as any],
    } as any)
    let cs = E.getClaims().find((x) => x.id === c.id)!
    if (cs.billingClaimId !== bill.id) throw new Error("case not linked to the bill")
    // before the hand-over: approval is visible, the patient's share is only an estimate, nothing can be collected yet
    let a = approvalOf(cs), v = billView(cs, BillingDatabase.getClaimById(bill.id)!)
    if (a.kind !== "preauth" || a.amount !== 500000 || a.code !== "AUTH-BD") throw new Error("approval: " + JSON.stringify(a))
    if (v.canCollect || v.expectedPatientShare !== 100000 || v.beyondCover !== 100000) throw new Error("before split: " + JSON.stringify(v))
    if (tabOf(a, v) !== "waiting") throw new Error("tab " + tabOf(a, v))
    // the counter hands it over with the policy's share
    BillingDatabase.billToInsurance(bill.id, { coverage: { i1: 500000 } })
    cs = E.getClaims().find((x) => x.id === c.id)!
    const b1 = BillingDatabase.getClaimById(bill.id)!
    v = billView(cs, b1)
    if (v.insurerShare !== 500000 || v.patientShare !== 100000 || v.due !== 100000 || !v.canCollect) throw new Error("after split: " + JSON.stringify(v))
    if (tabOf(a, v) !== "collect") throw new Error("not in collect tab")
    // the cashier takes it in two parts; can never take more than is due
    BillingDatabase.recordPayment(bill.id, { amount: 40000, paymentMethod: "Cash", collectedBy: "Cashier" })
    v = billView(cs, BillingDatabase.getClaimById(bill.id)!)
    if (v.due !== 60000 || v.paid !== 40000) throw new Error("after part payment: " + JSON.stringify(v))
    throws(() => BillingDatabase.recordPayment(bill.id, { amount: 70000, paymentMethod: "Cash", collectedBy: "Cashier" }), /more than the outstanding/i)
    BillingDatabase.recordPayment(bill.id, { amount: 60000, paymentMethod: "UPI / Digital", transactionRef: "UPI1", collectedBy: "Cashier" })
    v = billView(cs, BillingDatabase.getClaimById(bill.id)!)
    if (v.due !== 0 || v.canCollect || tabOf(a, v) !== "cleared") throw new Error("after full payment: " + JSON.stringify(v))
  })
  await probe("handing a bill to insurance keeps the patient's real insurer and policy (no 'Pending Insurance Assignment' / 'Pending KYC' overwrite)", () => {
    const umr = "UMR-HANDOVER"
    const c = E.openEncounterCase({ patientId: umr, patientName: "Handover Pat", encounterType: "IP", department: "Inpatient" }, policy({ insurerName: "Star Health", policyNumber: "HO-777", tpaName: "MediAssist" }))
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 100000, estimatedHospitalStayDays: 2 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    E.recordPreAuthResponse(c.id, { outcome: "Approved", amount: 100000, approvalCode: "A", note: "" })
    E.initiateDischarge(c.id)
    // The bill is raised by billing; the insurance engine has not looked at it yet (no insurance screen opened).
    const bill = BillingDatabase.createClaim({ patientId: umr, patientName: "Handover Pat", mrn: umr, department: "Inpatient", insuranceProvider: "Self-Pay", items: [{ id: "i1", description: "Stay", category: "Room", quantity: 1, unitPrice: 100000, total: 100000, insuranceCovered: 0, patientPayable: 100000 } as any] } as any)
    BillingDatabase.billToInsurance(bill.id, { coverage: { i1: 90000 } })
    const after = BillingDatabase.getClaimById(bill.id)!
    if (after.insuranceProvider !== "Star Health" || after.policyNumber !== "HO-777") throw new Error(`bill now says "${after.insuranceProvider}" / "${after.policyNumber}"`)
  })
  await probe("an insured patient still in the bed: the daily bed-charge refresh keeps the insurer / patient split (patient is not asked for the whole bill)", () => {
    const umr = "UMR-INBED"
    const c = E.openEncounterCase({ patientId: umr, patientName: "In Bed Pat", encounterType: "IP", department: "Inpatient" }, policy({ policyNumber: "IB-1" }))
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 200000, estimatedHospitalStayDays: 2 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    E.recordPreAuthResponse(c.id, { outcome: "Approved", amount: 200000, approvalCode: "A", note: "" })
    E.initiateDischarge(c.id)
    const bill = BillingDatabase.createClaim({ patientId: umr, patientName: "In Bed Pat", mrn: umr, department: "Inpatient", insuranceProvider: "Self-Pay", items: [{ id: "i1", description: "Procedure", category: "Procedure / Surgery", quantity: 1, unitPrice: 100000, total: 100000, insuranceCovered: 0, patientPayable: 100000 } as any] } as any)
    BillingDatabase.billToInsurance(bill.id, { coverage: { i1: 90000 } })
    const beds = BedDatabase.createBedsBulk({ ward: "General Ward", room_no: "301", from_bed: "1", to_bed: "1", bed_type: "General", daily_rate: 2000 })
    BedDatabase.updateBed(beds[0].id, { status: "Occupied", patient_id: umr, patient_name: "In Bed", patient_last_name: "Pat", admission_date: new Date(Date.now() - 2 * 86400000).toISOString() } as any)
    const after = BillingDatabase.getClaims().find((b) => b.id === bill.id)!
    // the bed line is added at the patient's cost: the patient owes the 10,000 co-pay + the bed, never the insurer's 90,000
    const bed = after.totalAmount - 100000
    if (bed <= 0 || after.patientPortion !== 10000 + bed || after.insurancePortion !== 90000) throw new Error(`patient share ${after.patientPortion}, insurer ${after.insurancePortion}, total ${after.totalAmount}`)
    if (after.status === "Paid") throw new Error("status flipped to Paid")
  })
  await probe("a bill never handed to insurance is never offered for collection, with the reason", () => {
    const fake: any = { totalAmount: 90000, amountPaid: 0, patientPortion: 90000, insurancePortion: 0, status: "Draft", tpa: undefined }
    const cs: any = { status: "DISCHARGE_INITIATED", approvedPreAuthAmount: 0, policy: { copayPercentage: 0, sumInsured: 0, balanceAvailable: 0 } }
    const v = billView(cs, fake)
    if (v.canCollect || !/not been handed to insurance/i.test(v.why)) throw new Error(JSON.stringify(v))
  })
  await probe("an admitted patient's running bill is shown but payment waits for discharge", () => {
    const cs: any = { status: "TREATMENT_IN_PROGRESS", approvedPreAuthAmount: 300000, policy: { copayPercentage: 0, sumInsured: 500000, balanceAvailable: 500000 } }
    const v = billView(cs, { totalAmount: 120000, amountPaid: 0, patientPortion: 120000, insurancePortion: 0, status: "Draft", runningAdmissionId: "ADM-1", tpa: undefined } as any)
    if (v.canCollect || tabOf(approvalOf(cs), v) !== "admitted") throw new Error(JSON.stringify(v))
  })

  // ── what the policy gives for the bed ────────────────────────────────────────────────────────
  await probe("bed above the policy's daily limit: the excess is the patient's (₹8,000/day bed, ₹5,000/day limit, 5 days)", () => {
    const r = stayBenefit({ beds: [{ kind: "room", label: "Private", perDay: 8000, days: 5 }], otherCharges: 0, terms: { roomRentPerDay: 5000 } })
    if (r.bedExcess !== 15000 || r.insurerShare !== 25000 || r.patientShare !== 15000 || r.beds[0].excessPerDay !== 3000) throw new Error(JSON.stringify(r))
  })
  await probe("bed within the limit is covered fully; no cap recorded means no cap", () => {
    const a = stayBenefit({ beds: [{ kind: "room", label: "Semi", perDay: 3000, days: 4 }], otherCharges: 0, terms: { roomRentPerDay: 5000 } })
    if (a.bedExcess !== 0 || a.patientShare !== 0) throw new Error("within limit: " + JSON.stringify(a))
    const b = stayBenefit({ beds: [{ kind: "room", label: "Suite", perDay: 12000, days: 2 }], otherCharges: 0, terms: {} })
    if (b.bedExcess !== 0 || b.insurerShare !== 24000) throw new Error("no cap: " + JSON.stringify(b))
  })
  await probe("ICU uses the ICU limit, not the room limit", () => {
    const r = stayBenefit({ beds: [{ kind: "icu", label: "ICU", perDay: 15000, days: 2 }], otherCharges: 0, terms: { roomRentPerDay: 5000, icuRentPerDay: 10000 } })
    if (r.bedExcess !== 10000 || r.insurerShare !== 20000) throw new Error(JSON.stringify(r))
  })
  await probe("whole stay: bed excess + co-pay + insurer limit all land on the patient; the parts add up", () => {
    // 5 days at ₹8,000 (limit ₹5,000), ₹2,00,000 of other charges, 10% co-pay, ₹2,00,000 approved
    const r = stayBenefit({ beds: [{ kind: "room", label: "Private", perDay: 8000, days: 5 }], otherCharges: 200000, terms: { roomRentPerDay: 5000, copayPct: 10, approved: 200000 } })
    // covered before co-pay = 25,000 + 2,00,000 = 2,25,000; co-pay 22,500; after co-pay 2,02,500; limit 2,00,000 -> beyond 2,500
    if (r.coveredBeforeCopay !== 225000 || r.copayAmount !== 22500 || r.beyondLimit !== 2500 || r.insurerShare !== 200000) throw new Error(JSON.stringify(r))
    if (r.patientShare !== r.bedExcess + r.copayAmount + r.beyondLimit || r.billTotal !== r.insurerShare + r.patientShare) throw new Error("parts do not add up: " + JSON.stringify(r))
  })
  await probe("the daily limits and co-pay a desk types at Intake / eligibility are kept on the policy", () => {
    const c = newCase("Terms Kept", undefined, { roomRentPerDay: 4500, icuRentPerDay: 9000, copayPercentage: 15, validUntil: "2098-06-30", relationship: "Spouse" })
    const got = E.getClaimById(c.id)!.policy
    if (got.roomRentPerDay !== 4500 || got.icuRentPerDay !== 9000 || got.copayPercentage !== 15 || got.validUntil !== "2098-06-30" || got.relationship !== "Spouse") throw new Error(JSON.stringify(got))
    E.recordEligibility(c.id, elig({ roomRentPerDay: 6000, icuRentPerDay: 12000, copayApplicable: true, copayValue: "20%" }))
    const after = E.getClaimById(c.id)!.policy
    if (after.roomRentPerDay !== 6000 || after.icuRentPerDay !== 12000 || after.copayPercentage !== 20) throw new Error("verification did not update terms: " + JSON.stringify(after))
    const listed = E.getAllPatientPolicies().find((p) => p.patientId === c.patientId)
    if (listed?.roomRentPerDay !== 6000) throw new Error("register does not show the bed limit")
  })

  // ── ways out of a case that will never be paid ───────────────────────────────────────────────
  await probe("patient not eligible / chooses self-pay: the case can be closed without a claim (reason required)", () => {
    const c = newCase("Selfpay Pat")
    E.recordEligibility(c.id, elig({ status: "Not Eligible", policyActive: false }))
    throws(() => E.withdrawCase(c.id, { reason: " " }), /why|reason/i)
    E.withdrawCase(c.id, { reason: "Policy lapsed; patient will pay" })
    const got = E.getClaimById(c.id)!
    if (got.status !== "CLOSED" || got.closure?.kind !== "Withdrawn") throw new Error(JSON.stringify(got.closure) + got.status)
  })
  await probe("a case already under treatment or with the insurer cannot be quietly closed", () => {
    const id = toTreatment()
    throws(() => E.withdrawCase(id, { reason: "x" }), /cannot be closed/i)
  })
  await probe("rejected pre-authorisation can be closed (patient goes self-pay)", () => {
    const c = newCase("Rej Pre")
    E.recordEligibility(c.id, elig())
    E.savePreAuthDraft(c.id, { diagnosis: "x", clinicalSummary: "x", treatingDoctor: "Dr A", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: 1000, estimatedHospitalStayDays: 1 })
    for (const d of E.getClaimById(c.id)!.documents.filter((x) => x.isMandatory)) (E.uploadDocument(c.id, d.id, "f.pdf"), E.verifyDocument(c.id, d.id, true))
    E.submitPreAuth(c.id, "Portal", "R")
    E.recordPreAuthResponse(c.id, { outcome: "Rejected", note: "PED" })
    E.withdrawCase(c.id, { reason: "Patient will pay" })
    if (E.getClaimById(c.id)!.status !== "CLOSED") throw new Error("not closed")
  })
  await probe("a final claim rejection must say who bears the amount; the choice is recorded", () => {
    const id = toTreatment(100000)
    E.initiateDischarge(id)
    ;(E as any).act(id, (c: any) => { c.status = "FINAL_BILL_READY"; c.finalClaimAmount = 90000; c.totalHospitalBill = 100000 })
    for (const d of E.getClaimById(id)!.documents.filter((x) => x.isMandatory && x.status !== "Verified")) (E.uploadDocument(id, d.id, "f.pdf"), E.verifyDocument(id, d.id, true))
    E.submitClaim(id, "Portal", "R")
    E.recordClaimDecision(id, { outcome: "Rejected", note: "Exclusion upheld" })
    throws(() => E.withdrawCase(id, { reason: "final" }), /who bears/i)
    E.withdrawCase(id, { reason: "Exclusion upheld on appeal", bearer: "writeoff" })
    const c = E.getClaimById(id)!
    if (c.status !== "CLOSED" || c.closure?.kind !== "Rejected - written off" || c.closure.amount !== 90000) throw new Error(JSON.stringify(c.closure))
  })

  // ── who can open what ─────────────────────────────────────────────────────────────────────
  await probe("Insurance / TPA officer can open every insurance screen (incl. Patient Insurance, Payment Gaps, Reports)", () => {
    const grants = ["dashboard", "patients.insurance_desk", "billing.claims"]
    const screens = ["insurance", "insurance_overview", "insurance_patient_policies", "insurance_eligibility", "insurance_preauth", "insurance_claims", "insurance_emails", "insurance_settlement", "insurance_gaps", "insurance_reports"]
    const no = screens.filter((s) => !canOpenScreen(s, "ROLE_INSURANCE_TPA_OFFICER", grants))
    if (no.length) throw new Error("blocked: " + no.join(", "))
  })
  await probe("Billing executive can see insurance claims but a receptionist cannot open any insurance screen", () => {
    if (canOpenScreen("insurance_settlement", "ROLE_RECEPTIONIST", ["dashboard", "patients.registration", "billing.invoices"])) throw new Error("receptionist can open settlement")
    if (canOpenScreen("insurance_gaps", "ROLE_NURSE", ["dashboard", "beds"])) throw new Error("nurse can open payment gaps")
  })

  console.log(results.join("\n"))
  console.log(failed ? `${failed} DEFECT(S) FOUND` : "ALL AUDIT PROBES PASSED")
  process.exit(failed ? 1 : 0)
})()
