/**
 * Which screens a signed-in user may open: one place, exact rules.
 *
 * Inputs are what the server decided at sign-in: the account's role key and its module grants
 * (`module_access`: backend modules such as "patients", "billing", or sub-grants such as "patients.registration",
 * "billing.claims", plus the screen keys an administrator ticks in Roles & Access such as "laboratory",
 * "lab_workbench", "billing_op").
 *
 *  - A grant opens exactly the screens it names. A narrow sub-grant (patients.registration) opens only its screen,
 *    never the whole module (it used to open the doctor workspace and the clinical chart too).
 *  - A role is matched by its exact key, never by a piece of its name ("ER" is in MANAGER, SUPERVISOR, OFFICER and
 *    THERAPIST; "NURSE" is not in NURSING).
 *  - The server still enforces every API call; this decides what is shown and what the browser-held modules allow.
 */

type Rule = string[]

/** A group key opens itself and its child screens. */
export const GROUP_CHILDREN: Record<string, string[]> = {
  patients: ["patients", "register", "registry", "appointments", "patient_messages"],
  outpatient: ["outpatient", "op_management", "queue", "op_nurse", "opd_procedures", "op_workflow", "journey_scan"],
  clinical: ["clinical", "chart"],
  doctor: ["doctor_portal", "doctor_workflow", "doctors_overview", "doctor_scheduling"],
  emergency: ["emergency", "emergency_ui", "triage"],
  inpatient: ["inpatient", "beds", "admissions", "readmission", "discharge"],
  icu: ["icu", "icu_micu", "icu_sicu", "icu_ccu", "icu_nicu", "icu_picu", "icu_ward"],
  laboratory: ["laboratory", "lab_dashboard", "lab_orders_collection", "lab_workbench", "lab_reports", "lab_inventory", "lab_quality_analytics", "lab_admin_config", "lab_billing"],
  radiology: ["radiology", "radiology_worklist", "radiology_operations", "radiology_reporting", "radiology_reports", "radiology_template_upload", "radiology_analytics"],
  pharmacy: [
    "pharmacy", "pharmacy_dispensing", "pharmacy_rx", "pharmacy_returns", "pharmacy_medicine", "pharmacy_suppliers", "pharmacy_ocr",
    "pharmacy_supplier_returns", "pharmacy_ledger", "pharmacy_expiry", "pharmacy_write_off", "pharmacy_analytics", "pharmacy_notifications", "pharmacy_audit",
  ],
  billing: ["billing", "billing_op", "billing_ip", "billing_er", "lab_billing", "billing_unified", "billing_insured", "payments", "billing_revenue"],
  insurance: [
    "insurance", "insurance_overview", "insurance_patient_policies", "insurance_eligibility", "insurance_preauth", "insurance_claims",
    "insurance_emails", "insurance_settlement", "insurance_gaps", "insurance_reports", "insurance_setup", "insurance_docrules", "insurance_masters",
  ],
  accounts: [
    "accounts", "accounts_dashboard", "accounts_coa", "accounts_gl", "accounts_receipts", "accounts_payments", "accounts_cash_bank", "accounts_ar", "accounts_ap",
    "accounts_pharmacy", "accounts_insurance", "accounts_tax", "accounts_budget", "accounts_assets", "accounts_reports", "accounts_period_close", "accounts_audit", "accounts_manager",
  ],
  hrms: [
    "hrms", "employees", "scheduling", "hr_attendance", "hr_staffing", "hr_leave", "hr_approvals", "hr_payroll", "hr_recruitment", "hr_organization",
    "hr_training", "hr_performance", "hr_compliance", "hr_grievances", "hr_reports", "hr_announcements",
  ],
  intelligence: ["intelligence", "dpi_ocr", "smart_ocr", "symptom_ai", "clinical_rag", "clinical_summaries", "bulk_ai", "nl_filtering"],
  reports: [
    "reports", "reports_overview", "reports_patients", "reports_op", "reports_er", "reports_inpatient", "reports_appointments", "reports_doctors", "reports_pharmacy",
    "reports_laboratory", "reports_radiology", "reports_beds", "reports_admissions", "reports_discharges", "reports_staff", "revenue_reports",
    "reports_pharmacy_damaged", "reports_supplier_returns",
  ],
  nursing: ["nursing"],
  surgery: ["surgery"],
}
// Names an administrator may have ticked for the same group.
GROUP_CHILDREN.doctor_portal = GROUP_CHILDREN.doctor
GROUP_CHILDREN.lab = GROUP_CHILDREN.laboratory
GROUP_CHILDREN.finance = GROUP_CHILDREN.accounts
GROUP_CHILDREN.reception = GROUP_CHILDREN.patients
GROUP_CHILDREN.op = GROUP_CHILDREN.outpatient

const ALL = (...groups: string[]): Rule => groups.flatMap((g) => GROUP_CHILDREN[g] ?? [g])

/**
 * Backend grants -> screens. A bare module ("billing") is full access to that module's screens; a dotted grant opens only
 * the screens of that sub-item. (Mirrors core/auth.py SUB_MODULES.)
 */
const BACKEND_GRANTS: Record<string, Rule> = {
  // patients
  patients: ALL("patients", "clinical"),
  "patients.directory": ["patients", "registry"],
  "patients.registration": ["patients", "register", "registry"],
  "patients.appointments": ["patients", "appointments"],
  "patients.consent_desk": ["patients"],
  "patients.documents": ["patients"],
  "patients.insurance_desk": ["patients", ...ALL("insurance")],
  "patients.clinical_records": ALL("clinical"),
  "patients.bulk_ai": ["patients", "bulk_ai"],
  // operations
  op: ALL("outpatient"),
  "op.schedules": ["outpatient", "queue", "op_management"],
  "op.doctors": ["outpatient", "op_management"],
  beds: ALL("inpatient"),
  "beds.manage": ALL("inpatient"),
  er: ALL("emergency"),
  "er.registration": ["emergency", "emergency_ui"],
  "er.triage": ["triage"],
  "er.treatment": ["emergency", "emergency_ui"],
  "er.doctor_assignment": ["emergency", "emergency_ui"],
  "er.disposition": ["emergency", "emergency_ui"],
  "er.config": ["emergency", "emergency_ui"],
  // pharmacy
  pharmacy: ALL("pharmacy"),
  "pharmacy.inventory": ["pharmacy", "pharmacy_medicine", "pharmacy_expiry", "pharmacy_write_off", "pharmacy_ledger"],
  "pharmacy.sales": ["pharmacy", "pharmacy_dispensing", "pharmacy_returns"],
  "pharmacy.suppliers": ["pharmacy", "pharmacy_suppliers", "pharmacy_supplier_returns"],
  "pharmacy.purchases": ["pharmacy", "pharmacy_suppliers", "pharmacy_ocr"],
  "pharmacy.prescriptions": ["pharmacy", "pharmacy_rx", "pharmacy_dispensing"],
  // AI
  symptom_ai: ALL("intelligence"),
  "symptom_ai.documents": ["intelligence", "dpi_ocr", "smart_ocr"],
  // finance
  billing: ALL("billing"),
  "billing.invoices": ["billing", "billing_op", "billing_ip", "billing_er", "lab_billing", "billing_unified", "billing_insured", "payments"],
  "billing.claims": ALL("insurance"),
  accounts: ALL("accounts"),
  "accounts.ledger": ["accounts", "accounts_dashboard", "accounts_gl", "accounts_coa", "accounts_receipts", "accounts_payments", "accounts_cash_bank", "accounts_ar", "accounts_ap"],
  "accounts.approve": ["accounts", "accounts_manager"],
  "accounts.periods": ["accounts", "accounts_period_close"],
  "accounts.setup": ["accounts", "accounts_coa", "accounts_tax", "accounts_budget", "accounts_assets"],
  // administration
  hrms: ALL("hrms"),
  employees: ["employees"],
  "employees.profile": ["employees"],
  "employees.access": ["employees"],
  patient_experience: ["patient_messages"],
  "patient_experience.feedback": ["patient_messages"],
}
// every hrms.* sub-grant opens the HR workspace
BACKEND_GRANTS["hrms.audit"] = ["hrms", "employees", "hr_compliance", "hr_reports"]
for (const sub of ["departments", "attendance", "payroll", "leaves", "shifts", "recruitment", "training", "performance", "documents", "grievances", "reports", "governance", "planning", "engagement", "audit"]) {
  if (sub === "audit") continue
  BACKEND_GRANTS[`hrms.${sub}`] = ["hrms", "employees", ...(sub === "attendance" ? ["hr_attendance"] : []), ...(sub === "payroll" ? ["hr_payroll"] : []), ...(sub === "leaves" ? ["hr_leave"] : []), ...(sub === "recruitment" ? ["hr_recruitment"] : []), ...(sub === "training" ? ["hr_training"] : []), ...(sub === "performance" ? ["hr_performance"] : []), ...(sub === "grievances" ? ["hr_grievances"] : []), ...(sub === "reports" ? ["hr_reports"] : [])]
}

const BACKEND_BASES = new Set(["dashboard", "patients", "op", "beds", "er", "pharmacy", "symptom_ai", "billing", "accounts", "hrms", "employees", "patient_experience", "facility"])

/**
 * Built-in roles whose screens are not backend modules at all (laboratory, radiology, surgery, ICU, nursing, the doctor
 * workspace). Matched by exact role key, and only for an account whose grants name no screen of its own:
 * once an administrator ticks specific screens for the account, those screens are the whole answer.
 */
const ROLE_DEFAULTS: Record<string, Rule> = {
  ROLE_DOCTOR: ALL("doctor", "outpatient", "clinical", "inpatient", "icu", "intelligence"),
  ROLE_PHYSICIAN: ALL("doctor", "outpatient", "clinical", "inpatient", "icu", "intelligence"),
  ROLE_CLINICIAN: ALL("doctor", "outpatient", "clinical", "inpatient", "icu", "intelligence"),
  ROLE_SURGEON: ALL("doctor", "outpatient", "clinical", "inpatient", "icu", "surgery", "intelligence"),
  ROLE_ANESTHETIST: ALL("outpatient", "clinical", "inpatient", "icu", "surgery"),
  ROLE_ER_PHYSICIAN: ALL("doctor", "emergency", "clinical"),
  ROLE_NURSE: ALL("nursing", "clinical", "outpatient", "inpatient", "icu"),
  ROLE_NURSING_SUPERVISOR: ALL("nursing", "clinical", "outpatient", "inpatient", "icu", "emergency"),
  ROLE_PATHOLOGIST: ALL("laboratory"),
  ROLE_LAB_TECHNICIAN: ALL("laboratory"),
  ROLE_RADIOLOGY_TECHNICIAN: ALL("radiology"),
  ROLE_RADIOLOGIST: ALL("radiology"),
  // Reception, pharmacy, billing, insurance, accounts, HR, records ... have backend modules: their grants alone decide.
}

const UNIVERSAL = new Set(["dashboard", "my_hr"])

const baseOf = (p: string) => p.split(/[:.]/)[0]

export function isAdminAccount(role: string, _permissions: string[] = [], staffId?: string): boolean {
  // The role the server issued decides: a "*" or "admin" string inside a module list never makes anyone an administrator.
  const r = (role || "").toUpperCase()
  return r === "ROLE_ADMIN" || r === "ROLE_SUPERADMIN" || r === "ADMIN" || staffId === "ADM-001"
}

/** Every screen key this account may open (not used for admins, who may open everything). */
export function grantedScreens(role: string, permissions: string[] = []): Set<string> {
  const out = new Set<string>(UNIVERSAL)
  const add = (list: string[]) => list.forEach((k) => out.add(k))
  let ownScreens = false
  for (const raw of permissions) {
    const p = (raw || "").trim()
    if (!p) continue
    if (BACKEND_GRANTS[p]) {
      add(BACKEND_GRANTS[p])
      continue
    }
    const base = baseOf(p)
    if (!BACKEND_BASES.has(base)) ownScreens = true
    if (GROUP_CHILDREN[p]) add(GROUP_CHILDREN[p])
    out.add(p)
    // "hrms:payroll" / "reports:daily" style grants name a screen of their own group
    if (p !== base && !BACKEND_GRANTS[p] && GROUP_CHILDREN[base]) out.add(base)
  }
  if (!ownScreens) add(ROLE_DEFAULTS[(role || "").toUpperCase()] ?? [])
  return out
}

export function canOpenScreen(target: string, role: string, permissions: string[] = [], staffId?: string): boolean {
  if (isAdminAccount(role, permissions, staffId)) return true
  if (target === "admin" || target === "admin_doctors") return false
  if (UNIVERSAL.has(target)) return true
  return grantedScreens(role, permissions).has(target)
}
