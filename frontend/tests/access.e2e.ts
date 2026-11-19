import "./shim"
import { canOpenScreen } from "../src/utils/accessControl"

/** Role-based screen access: what every built-in role may and may not open. Grants copied from core/auth.py INITIAL_ROLE_TEMPLATES. */
const TEMPLATES: Record<string, string[]> = {
  ROLE_DOCTOR: ["dashboard", "patients.clinical_records", "op"],
  ROLE_SURGEON: ["dashboard", "patients.clinical_records", "op", "beds"],
  ROLE_ANESTHETIST: ["dashboard", "patients.clinical_records", "op", "beds"],
  ROLE_ER_PHYSICIAN: ["dashboard", "patients.clinical_records", "er"],
  ROLE_PATHOLOGIST: ["dashboard", "patients.documents", "symptom_ai.documents"],
  ROLE_RECEPTIONIST: ["dashboard", "patients.registration", "patients.appointments", "patients.directory", "billing.invoices"],
  ROLE_FRONT_OFFICE_MANAGER: ["dashboard", "patients", "billing.invoices"],
  ROLE_NURSE: ["dashboard", "patients.clinical_records", "beds", "er.triage"],
  ROLE_NURSING_SUPERVISOR: ["dashboard", "patients.clinical_records", "beds", "er"],
  ROLE_PHYSIOTHERAPIST: ["dashboard", "patients.clinical_records"],
  ROLE_PHARMACIST: ["dashboard", "pharmacy.prescriptions", "pharmacy.inventory", "pharmacy.sales", "pharmacy.purchases"],
  ROLE_PHARMACY_MANAGER: ["dashboard", "pharmacy"],
  ROLE_LAB_TECHNICIAN: ["dashboard", "patients.documents", "symptom_ai.documents"],
  ROLE_RADIOLOGY_TECHNICIAN: ["dashboard", "patients.documents", "symptom_ai.documents"],
  ROLE_HR_MANAGER: ["dashboard", "employees", "hrms"],
  ROLE_HR_EXECUTIVE: ["dashboard", "employees.profile", "hrms.attendance", "hrms.leaves", "hrms.documents"],
  ROLE_ACCOUNTANT: ["dashboard", "accounts.ledger"],
  ROLE_FINANCE_MANAGER: ["dashboard", "accounts.ledger", "accounts.approve", "accounts.periods"],
  ROLE_BILLING_EXECUTIVE: ["dashboard", "billing.invoices", "billing.claims"],
  ROLE_INSURANCE_TPA_OFFICER: ["dashboard", "patients.insurance_desk", "billing.claims"],
  ROLE_RADIOLOGIST: ["dashboard", "patients.documents", "symptom_ai"],
  ROLE_MEDICAL_RECORDS_OFFICER: ["dashboard", "patients.directory", "patients.documents", "patients.clinical_records"],
  ROLE_INVENTORY_MANAGER: ["dashboard", "pharmacy.inventory", "pharmacy.suppliers", "pharmacy.purchases"],
  ROLE_FACILITY_MANAGER: ["dashboard", "facility"],
  ROLE_COMPLIANCE_OFFICER: ["dashboard", "hrms.audit", "hrms.documents", "hrms.reports"],
  ROLE_IT_SUPPORT: ["dashboard", "facility.requests"],
}

const results: string[] = []
let failed = 0
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : " -> " + detail}`)
  if (!ok) failed++
}
const can = (role: string, screen: string) => canOpenScreen(screen, role, TEMPLATES[role])

// each role: screens it must open, screens it must not
const EXPECT: Record<string, { yes: string[]; no: string[] }> = {
  ROLE_RECEPTIONIST: { yes: ["patients", "register", "registry", "appointments", "billing_op", "billing_unified"], no: ["doctor_portal", "clinical", "chart", "emergency", "inpatient", "icu", "laboratory", "pharmacy", "accounts", "hrms", "insurance", "surgery", "billing_revenue", "admin"] },
  ROLE_FRONT_OFFICE_MANAGER: { yes: ["patients", "register", "billing_op"], no: ["emergency", "doctor_portal", "pharmacy", "accounts", "hrms", "insurance", "admin"] },
  ROLE_DOCTOR: { yes: ["doctor_portal", "clinical", "chart", "outpatient", "inpatient"], no: ["emergency", "billing", "billing_op", "accounts", "hrms", "pharmacy", "laboratory", "admin", "register"] },
  ROLE_ER_PHYSICIAN: { yes: ["emergency", "triage", "clinical", "doctor_portal"], no: ["billing", "accounts", "hrms", "pharmacy", "laboratory", "inpatient", "admin"] },
  ROLE_NURSE: { yes: ["nursing", "clinical", "inpatient", "icu", "op_nurse"], no: ["emergency", "billing", "accounts", "hrms", "pharmacy", "laboratory", "doctor_portal", "admin"] },
  ROLE_NURSING_SUPERVISOR: { yes: ["nursing", "clinical", "inpatient", "icu", "emergency"], no: ["billing", "accounts", "hrms", "pharmacy", "doctor_portal", "admin"] },
  ROLE_PHYSIOTHERAPIST: { yes: ["clinical", "chart"], no: ["emergency", "triage", "billing", "pharmacy", "inpatient", "doctor_portal", "admin"] },
  ROLE_LAB_TECHNICIAN: { yes: ["laboratory", "lab_workbench", "lab_billing"], no: ["billing_op", "billing", "pharmacy", "emergency", "doctor_portal", "accounts", "hrms", "admin"] },
  ROLE_PATHOLOGIST: { yes: ["laboratory", "lab_reports"], no: ["billing", "pharmacy", "emergency", "admin"] },
  ROLE_RADIOLOGY_TECHNICIAN: { yes: ["radiology", "radiology_worklist"], no: ["laboratory", "billing", "emergency", "admin"] },
  ROLE_RADIOLOGIST: { yes: ["radiology", "radiology_reporting"], no: ["laboratory", "billing", "emergency", "admin"] },
  ROLE_PHARMACIST: { yes: ["pharmacy", "pharmacy_dispensing", "pharmacy_rx"], no: ["billing", "emergency", "laboratory", "accounts", "hrms", "doctor_portal", "admin"] },
  ROLE_PHARMACY_MANAGER: { yes: ["pharmacy", "pharmacy_suppliers", "pharmacy_analytics"], no: ["emergency", "billing", "hrms", "admin"] },
  ROLE_INVENTORY_MANAGER: { yes: ["pharmacy", "pharmacy_medicine", "pharmacy_suppliers"], no: ["emergency", "billing", "hrms", "admin"] },
  ROLE_BILLING_EXECUTIVE: { yes: ["billing", "billing_op", "billing_ip", "billing_er", "insurance", "insurance_claims"], no: ["accounts", "hrms", "pharmacy", "doctor_portal", "emergency", "admin"] },
  ROLE_INSURANCE_TPA_OFFICER: { yes: ["insurance", "insurance_claims", "patients"], no: ["billing_op", "billing", "accounts", "hrms", "pharmacy", "emergency", "admin"] },
  ROLE_ACCOUNTANT: { yes: ["accounts", "accounts_gl", "accounts_receipts"], no: ["accounts_manager", "accounts_period_close", "billing", "hrms", "pharmacy", "emergency", "admin"] },
  ROLE_FINANCE_MANAGER: { yes: ["accounts", "accounts_manager", "accounts_period_close"], no: ["accounts_tax", "billing", "hrms", "emergency", "admin"] },
  ROLE_HR_MANAGER: { yes: ["hrms", "employees", "hr_payroll"], no: ["billing", "accounts", "pharmacy", "emergency", "doctor_portal", "admin"] },
  ROLE_HR_EXECUTIVE: { yes: ["hrms", "employees", "hr_attendance", "hr_leave"], no: ["hr_payroll", "hr_recruitment", "billing", "emergency", "admin"] },
  ROLE_COMPLIANCE_OFFICER: { yes: ["hrms", "hr_compliance"], no: ["hr_payroll", "billing", "emergency", "admin"] },
  ROLE_MEDICAL_RECORDS_OFFICER: { yes: ["patients", "clinical", "chart"], no: ["register", "billing", "pharmacy", "emergency", "admin"] },
  ROLE_FACILITY_MANAGER: { yes: ["dashboard"], no: ["emergency", "billing", "hrms", "pharmacy", "admin"] },
  ROLE_IT_SUPPORT: { yes: ["dashboard"], no: ["emergency", "billing", "hrms", "pharmacy", "patients", "admin"] },
  ROLE_SURGEON: { yes: ["surgery", "doctor_portal", "clinical"], no: ["emergency", "billing", "accounts", "hrms", "admin"] },
  ROLE_ANESTHETIST: { yes: ["surgery", "clinical"], no: ["doctor_portal", "emergency", "billing", "admin"] },
}
for (const [role, e] of Object.entries(EXPECT)) {
  const wrongNo = e.no.filter((s) => can(role, s))
  const wrongYes = e.yes.filter((s) => !can(role, s))
  check(`${role}: opens its own screens`, wrongYes.length === 0, "blocked: " + wrongYes.join(", "))
  check(`${role}: cannot open the others`, wrongNo.length === 0, "wrongly allowed: " + wrongNo.join(", "))
}
// every role in the templates has an expectation (nothing slips through unchecked)
check("every built-in role is covered", Object.keys(TEMPLATES).every((r) => EXPECT[r]), Object.keys(TEMPLATES).filter((r) => !EXPECT[r]).join(", "))

// the old substring bug: a role NAME containing ER (MANAGER, OFFICER, SUPERVISOR, THERAPIST) must not give Emergency
for (const r of ["ROLE_INVENTORY_MANAGER", "ROLE_PHYSIOTHERAPIST", "ROLE_COMPLIANCE_OFFICER", "ROLE_FACILITY_MANAGER", "ROLE_SOME_OFFICER", "ROLE_TECHNICIAN", "ROLE_SUPERVISOR"]) {
  check(`${r}: a name containing ER does not grant Emergency`, !canOpenScreen("emergency", r, TEMPLATES[r] ?? ["dashboard"]), "emergency opened")
}
check("unknown role with no grants opens only the dashboard", !canOpenScreen("billing", "ROLE_WHATEVER", ["dashboard"]) && canOpenScreen("dashboard", "ROLE_WHATEVER", ["dashboard"]), "")

// narrow grants stay narrow
check("the Reception Registry opens with the patient grants, and not without them", canOpenScreen("registry", "X", ["patients"]) && canOpenScreen("registry", "X", ["patients.directory"]) && canOpenScreen("registry", "X", ["patients.registration"]) && !canOpenScreen("registry", "X", ["billing"]) && !canOpenScreen("registry", "X", ["pharmacy"]), "")
check("patients.registration opens Registration but not the doctor workspace / chart", canOpenScreen("register", "X", ["patients.registration"]) && !canOpenScreen("doctor_portal", "X", ["patients.registration"]) && !canOpenScreen("chart", "X", ["patients.registration"]), "")
check("billing.invoices opens invoices but not insurance claims", canOpenScreen("billing_op", "X", ["billing.invoices"]) && !canOpenScreen("insurance_claims", "X", ["billing.invoices"]), "")
check("billing.claims opens insurance but not the cash counters", canOpenScreen("insurance_claims", "X", ["billing.claims"]) && !canOpenScreen("billing_op", "X", ["billing.claims"]), "")
check("laboratory does not open billing (only the lab's own billing desk)", canOpenScreen("lab_billing", "X", ["laboratory"]) && !canOpenScreen("billing_op", "X", ["laboratory"]) && !canOpenScreen("billing", "X", ["laboratory"]), "")

// screens an administrator ticked for the account are the whole answer (no role defaults on top)
check("explicit screens replace the role's defaults", canOpenScreen("lab_workbench", "ROLE_LAB_TECHNICIAN", ["dashboard", "lab_workbench"]) && !canOpenScreen("lab_reports", "ROLE_LAB_TECHNICIAN", ["dashboard", "lab_workbench"]) && !canOpenScreen("laboratory", "ROLE_LAB_TECHNICIAN", ["dashboard", "lab_workbench"]), "")
check("a group key opens its children", canOpenScreen("pharmacy_rx", "X", ["pharmacy"]) && canOpenScreen("icu_ccu", "X", ["icu"]) && canOpenScreen("radiology_reports", "X", ["radiology"]), "")
check("a doctor created by the admin form still gets the doctor workspace group", canOpenScreen("doctors_overview", "ROLE_DOCTOR", ["dashboard", "clinical", "doctor_workflow", "patients", "chart", "inpatient", "emergency", "op_workflow", "appointments", "queue", "doctor_portal"]), "")

// administrators open everything; nobody else opens Administration
check("admin opens everything", ["admin", "billing", "hr_payroll", "emergency", "accounts_gl"].every((s) => canOpenScreen(s, "ROLE_ADMIN", [])), "")
check("no non-admin opens Administration", Object.keys(TEMPLATES).every((r) => !can(r, "admin") && !can(r, "admin_doctors")), "")
console.log(results.join("\n"))
console.log(failed ? `\n${failed} FAILED` : "\nALL ACCESS CHECKS PASSED")
if (failed) process.exitCode = 1
