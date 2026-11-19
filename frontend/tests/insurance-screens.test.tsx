import "./shim"
import React from "react"
import { renderToString } from "react-dom/server"
import { InsuranceEngineService as E } from "../src/services/insuranceDb"
import ClaimsHome from "../src/components/insurance/ClaimsHome"
import InsuranceCommandDashboard from "../src/components/insurance/InsuranceCommandDashboard"
import InsuranceIntakeView from "../src/components/insurance/InsuranceIntakeView"
import PreAuthRequestView from "../src/components/insurance/PreAuthRequestView"
import InsuranceCaseDetailView from "../src/components/insurance/InsuranceCaseDetailView"
import DischargeFinalizationView from "../src/components/insurance/DischargeFinalizationView"
import InsuranceEmailHubPage from "../src/components/insurance/InsuranceEmailHubPage"
import SettlementPage from "../src/components/insurance/SettlementPage"
import PaymentGapsPage from "../src/components/insurance/PaymentGapsPage"
import PatientPoliciesPage from "../src/components/insurance/PatientPoliciesPage"
import EnhancedAuditRulesPage from "../src/components/insurance/EnhancedAuditRulesPage"
import InsuranceSetup from "../src/components/insurance/InsuranceSetup"
import InsuranceDashboardView from "../src/components/insurance/InsuranceDashboardView"
import InsuranceReportsView from "../src/components/insurance/InsuranceReportsView"
import { PatientInsuranceTab } from "../src/components/insurance/integrations"
import InsuredPatientBilling from "../src/components/billing/InsuredPatientBilling"
import { BillingDatabase } from "../src/services/billingDb"

/**
 * Renders every insurance screen against claims at every stage of the journey (built by the engine, in memory), so a
 * screen that cannot cope with real data (missing field, odd status) is found without touching live records.
 */
const results: string[] = []
let failed = 0
const mark = (name: string, ok: boolean, why = "") => {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + why))
}
const render = (name: string, el: React.ReactElement) => {
  try {
    const html = renderToString(el)
    mark(name, html.length > 200 && !/Application error|could not be displayed/i.test(html), "rendered an empty or error page")
    return html
  } catch (e) {
    mark(name, false, ((e as Error).message || String(e)).split("\n")[0])
    return ""
  }
}

const pol = (o: any = {}) => ({ paymentType: "Insurance / Cashless", insurerId: "INS-1", insurerName: "Star Health", tpaName: "MediAssist", policyNumber: "P-1", memberId: "M1", policyHolderName: "X", relationship: "Self", validUntil: "2099-12-31", sumInsured: 500000, balanceAvailable: 500000, roomCategoryEligible: "", copayPercentage: 10, deductibleAmount: 0, preAuthRequired: true, ...o }) as any
const elig = (o: any = {}) => ({ status: "Eligible", method: "Portal", policyActive: true, inNetwork: true, sumInsured: 500000, balanceAvailable: 500000, roomEligibilityNote: "Single AC", copayApplicable: true, copayValue: "10%", deductibleRemaining: 0, preAuthRequired: true, ...o }) as any
let n = 0
const mk = (name: string, o: any = {}) => E.openEncounterCase({ patientId: `SCR-${++n}`, patientName: name, encounterType: "IP", department: "Inpatient", attendingDoctor: "Dr Test", age: 40, gender: "Male", phone: "9000000000" }, pol(o))
const draft = (id: string, amt = 120000) => E.savePreAuthDraft(id, { diagnosis: "Appendicitis", icdCode: "K35", clinicalSummary: "Acute", treatingDoctor: "Dr Test", admissionType: "Planned", procedureCodes: [], estimatedOtherCharges: amt, estimatedHospitalStayDays: 3 })
const docs = (id: string) => E.getClaimById(id)!.documents.forEach((d) => { if (d.isMandatory && d.status !== "Verified") { E.uploadDocument(id, d.id, "f.pdf"); E.verifyDocument(id, d.id, true) } })
const bill = (id: string, claimed: number) => (E as any).act(id, (c: any) => { c.status = "FINAL_BILL_READY"; c.finalClaimAmount = claimed; c.totalHospitalBill = claimed + 20000 })

;(async () => {
  const ids: Record<string, string> = {}
  const build = (label: string, fn: (id: string) => void, o: any = {}) => {
    try {
      const c = mk(label, o)
      fn(c.id)
      ids[label] = c.id
    } catch (e) {
      mark(`build case: ${label}`, false, (e as Error).message)
    }
  }
  build("Eligibility pending", () => {})
  build("Eligible", (id) => E.recordEligibility(id, elig()))
  build("Not eligible", (id) => E.recordEligibility(id, elig({ status: "Not Eligible", policyActive: false })))
  build("Pre-auth draft", (id) => (E.recordEligibility(id, elig()), draft(id)))
  build("Pre-auth submitted", (id) => (E.recordEligibility(id, elig()), draft(id), docs(id), E.submitPreAuth(id, "Portal", "R1")))
  build("Pre-auth query", (id) => (E.recordEligibility(id, elig()), draft(id), docs(id), E.submitPreAuth(id, "Portal", "R1"), E.recordPreAuthResponse(id, { outcome: "Query", note: "Send ECG", dueDays: 2 })))
  build("Pre-auth rejected", (id) => (E.recordEligibility(id, elig()), draft(id), docs(id), E.submitPreAuth(id, "Email", "R1"), E.recordPreAuthResponse(id, { outcome: "Rejected", note: "PED" })))
  const treat = (id: string) => (E.recordEligibility(id, elig()), draft(id), docs(id), E.submitPreAuth(id, "Portal", "R1"), E.recordPreAuthResponse(id, { outcome: "Approved", amount: 120000, approvalCode: "A1", note: "ok" }))
  build("In treatment", treat)
  build("Enhancement pending", (id) => (treat(id), E.requestEnhancement(id, 200000, "ICU stay")))
  build("Discharge initiated", (id) => (treat(id), E.initiateDischarge(id)))
  build("Claim ready", (id) => (treat(id), E.initiateDischarge(id), bill(id, 150000)))
  const submitted = (id: string) => (treat(id), E.initiateDischarge(id), bill(id, 150000), docs(id), E.submitClaim(id, "Portal", "CR1"))
  build("Claim submitted", submitted)
  build("Claim query", (id) => (submitted(id), E.raiseClaimQuery(id, "Need OT notes", 3)))
  build("Claim rejected", (id) => (submitted(id), E.recordClaimDecision(id, { outcome: "Rejected", note: "Not covered" })))
  const partial = (id: string) => (submitted(id), E.recordClaimDecision(id, { outcome: "Partially Approved", approvedAmount: 130000, deductions: [{ id: "d1", category: "Non-Payable Consumables", amount: 20000, remark: "gloves" }], note: "n" }))
  build("Partially approved", partial)
  build("Settlement pending", (id) => (partial(id), E.recordSettlementAdvice(id, "ADV1", "2099-01-01")))
  build("Payment part-received", (id) => (partial(id), E.recordSettlementAdvice(id, "ADV2", "2099-01-01"), E.recordPayment(id, { amount: 100000, utr: "U1", paymentDate: "2026-11-01", bankAccount: "HDFC" })))
  build("Short payment explained", (id) => (partial(id), E.recordSettlementAdvice(id, "ADV3", "2099-01-01"), E.recordPayment(id, { amount: 110000, utr: "U2", paymentDate: "2026-11-01", bankAccount: "HDFC" }), E.recordShortfall(id, { amount: 13000, kind: "TDS deducted by insurer", remark: "" }), E.recordShortfall(id, { amount: 7000, kind: "Disputed with insurer", remark: "raised" })))
  build("Reconciled", (id) => (partial(id), E.recordSettlementAdvice(id, "ADV4", "2099-01-01"), E.recordPayment(id, { amount: 130000, utr: "U3", paymentDate: "2026-11-01", bankAccount: "HDFC" }), E.reconcile(id, "")))
  build("Closed", (id) => (partial(id), E.recordSettlementAdvice(id, "ADV5", "2099-01-01"), E.recordPayment(id, { amount: 130000, utr: "U4", paymentDate: "2026-11-01", bankAccount: "HDFC" }), E.reconcile(id, ""), E.closeClaim(id)))
  try {
    const q = E.openEncounterCase({ patientId: "SCR-ER", patientName: "ER Quick", encounterType: "ER", department: "Emergency" }, pol({ policyNumber: "", insurerName: "Pending Insurance Assignment" }), { quick: true })
    ids["ER quick capture"] = q.id
    const r = E.openEncounterCase({ patientId: "SCR-RE", patientName: "Reimb Pat", encounterType: "IP", department: "Inpatient" }, pol({ policyNumber: "RB-1" }), { claimType: "Reimbursement" })
    ids["Reimbursement"] = r.id
    E.recordEligibility(r.id, elig())
    E.startTreatmentWithoutPreAuth(r.id)
    E.recordPatientPayment(r.id, { amount: 50000, receiptNo: "RC1" })
  } catch (e) {
    mark("build ER / reimbursement cases", false, (e as Error).message)
  }
  mark(`built ${Object.keys(ids).length} claims across the journey`, Object.keys(ids).length >= 20, Object.keys(ids).join(", "))

  // A claim with a real bill, handed to insurance, with part of the patient's share paid.
  try {
    const bc = mk("Billing desk patient")
    E.recordEligibility(bc.id, elig())
    draft(bc.id, 500000)
    docs(bc.id)
    E.submitPreAuth(bc.id, "Portal", "RB")
    E.recordPreAuthResponse(bc.id, { outcome: "Approved", amount: 500000, approvalCode: "AUTH-B", note: "ok" })
    E.initiateDischarge(bc.id)
    const bill = BillingDatabase.createClaim({ patientId: E.getClaimById(bc.id)!.patientId, patientName: "Billing desk patient", mrn: E.getClaimById(bc.id)!.patientId, department: "Inpatient", insuranceProvider: "Self-Pay", items: [{ id: "i1", description: "Stay", category: "Room", quantity: 1, unitPrice: 600000, total: 600000, insuranceCovered: 0, patientPayable: 600000 } as any] } as any)
    BillingDatabase.billToInsurance(bill.id, { coverage: { i1: 500000 } })
    BillingDatabase.recordPayment(bill.id, { amount: 30000, paymentMethod: "Cash", collectedBy: "Cashier" })
    ids["Billed to insurance"] = bc.id
  } catch (e) {
    mark("build billed case", false, (e as Error).message)
  }
  const nav = () => {}
  for (const tabHint of ["collect", "all"]) render(`Insured patient billing (${tabHint})`, <InsuredPatientBilling onOpenBill={nav} onOpenInsurance={nav} />)
  render("Command dashboard", <InsuranceCommandDashboard onNavigate={nav} />)
  render("Legacy dashboard", <InsuranceDashboardView onOpenCase={nav} onOpenIntake={nav} />)
  render("Intake & eligibility", <InsuranceIntakeView onBack={nav} onComplete={nav} />)
  render("Settlement desk", <SettlementPage onNavigate={nav} />)
  render("Payment gaps", <PaymentGapsPage onNavigate={nav} />)
  render("Patient insurance register", <PatientPoliciesPage />)
  render("Email hub", <InsuranceEmailHubPage onNavigateToClaim={nav} />)
  for (const t of ["packages", "audit", "reports"] as const) render(`Rules / audit / reports (${t})`, <EnhancedAuditRulesPage initialTab={t} />)
  for (const t of ["main", "insurers", "tpas", "mail", "rules"] as const) render(`Setup (${t})`, <InsuranceSetup initialTab={t as any} />)
  render("Insurance reports view", <InsuranceReportsView onOpenCase={nav as any} {...({} as any)} />)
  for (const v of ["needs", "all", "queries", "claims"]) render(`Claims home (${v})`, <ClaimsHome onNavigate={nav} initialView={v} />)

  for (const [label, id] of Object.entries(ids)) {
    const c = E.getClaimById(id)
    if (!c) {
      mark(`case exists: ${label}`, false, "missing")
      continue
    }
    render(`Claim workspace — ${label} (${c.status})`, <ClaimsHome onNavigate={nav} initialCaseId={id} />)
    render(`Pre-auth screen — ${label}`, <PreAuthRequestView caseId={id} onBack={nav} onSubmitted={nav} />)
    render(`Case detail — ${label}`, <InsuranceCaseDetailView c={c} onBack={nav} onOpenBilling={nav} />)
    render(`Discharge & final approval — ${label}`, <DischargeFinalizationView c={c} onBack={nav} />)
    render(`Settlement drawer — ${label}`, <SettlementPage onNavigate={nav} initialCaseId={id} />)
    render(`Patient record insurance tab — ${label}`, <PatientInsuranceTab patientId={c.patientId} patientName={c.patientName} />)
  }

  console.log(results.join("\n"))
  console.log(failed ? `${failed} SCREEN PROBLEM(S)` : "ALL INSURANCE SCREENS RENDER WITH REAL DATA")
  process.exit(failed ? 1 : 0)
})()
