import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react"
import { canOpenScreen } from "./utils/accessControl"
import hotToast, { Toaster } from "react-hot-toast"
import {
  LayoutDashboard,
  Stethoscope,
  Users,
  ClipboardList,
  FileText,
  Siren,
  BedDouble,
  HeartPulse,
  Syringe,
  FlaskConical,
  Scan,
  Pill,
  Scissors,
  CreditCard,
  ShieldCheck,
  UsersRound,
  Calendar,
  Sparkles,
  BarChart3,
  Landmark,
} from "lucide-react"

import { Icon, type IconProps } from "./components/icons"

import Login, {
  loginUserFromAuthenticated,
  type AuthenticatedUser,
  type LoginUserData,
} from "./components/Login"

const Dashboard = lazy(() => import("./components/Dashboard"))

const PatientSearch = lazy(() => import("./components/PatientSearch"))
const PatientRegistry = lazy(() => import("./components/PatientRegistry"))

const PatientChart = lazy(() => import("./components/PatientChart"))

const ErPage = lazy(() => import("./pages/ErPage"))

const BedManagementPage = lazy(() => import("./pages/BedManagementPage"))

const WardNursing = lazy(() => import("./components/nursing/WardNursing"))

import type { Notice } from "./types"

import { apiFetch } from "./lib/api"
import { setAppSessionAuthenticated } from "./lib/authState"

const Laboratory = lazy(() => import("./components/Laboratory"))
const LaboratoryManagementSuite = lazy(() => import("./components/laboratory/LaboratoryManagementSuite"))

const Pharmacy = lazy(() => import("./components/Pharmacy"))

const Billing = lazy(() => import("./components/Billing"))
const LabBillingQueue = lazy(() => import("./components/LabBillingQueue"))
const InsuredPatientBilling = lazy(() => import("./components/billing/InsuredPatientBilling"))
const BillingDashboard = lazy(() => import("./components/billing/BillingDashboard"))
const RevenueDashboard = lazy(() => import("./components/billing/RevenueDashboard"))

const InsuranceClaims = lazy(() => import("./components/insurance/ClaimsHome"))
const InsuranceSettlementPage = lazy(() => import("./components/insurance/SettlementPage"))
const InsurancePaymentGaps = lazy(() => import("./components/insurance/PaymentGapsPage"))
const EnhancedAuditRulesPage = lazy(() => import("./components/insurance/EnhancedAuditRulesPage"))
const InsuranceDashboardView = lazy(() => import("./components/insurance/InsuranceDashboardView"))
const InsuranceCommandDashboard = lazy(() => import("./components/insurance/InsuranceCommandDashboard"))
const CashlessCaseBoard = lazy(() => import("./components/insurance/CashlessCaseBoard"))
const InsuranceCaseDetailView = lazy(() => import("./components/insurance/InsuranceCaseDetailView"))
const DischargeFinalizationView = lazy(() => import("./components/insurance/DischargeFinalizationView"))
const InsuranceReportsView = lazy(() => import("./components/insurance/InsuranceReportsView"))
const InsuranceEmailHubPage = lazy(() => import("./components/insurance/InsuranceEmailHubPage"))
const InsuranceSetup = lazy(() => import("./components/insurance/InsuranceSetup"))
const InsuranceIntakeView = lazy(() => import("./components/insurance/InsuranceIntakeView"))
const PreAuthRequestView = lazy(() => import("./components/insurance/PreAuthRequestView"))
import { InsuranceEngineService } from "./services/insuranceDb"
import { TransferNotices } from "./services/transferNotices"
import { IpCare, setCurrentActor } from "./services/ipCare"
import { HospAILogo } from "./components/HospAILogo"

const Inpatient = lazy(() => import("./components/Inpatient"))

const Surgery = lazy(() => import("./components/Surgery"))

const Appointments = lazy(() => import("./components/Appointments"))

const Radiology = lazy(() => import("./components/Radiology"))

const ICU = lazy(() => import("./components/ICU"))

const Analytics = lazy(() => import("./components/Analytics"))

const Discharge = lazy(() => import("./components/Discharge"))

const Triage = lazy(() => import("./components/Triage"))


const OrderDrawer = lazy(() => import("./components/OrderDrawer"))

const CommandPalette = lazy(() => import("./components/CommandPalette"))

const Registration = lazy(() => import("./components/Registration"))
const PatientJourneyModal = lazy(() => import("./components/PatientJourneyModal"))
const JourneyScanHost = lazy(() => import("./components/opcard/JourneyScan"))
const PatientRecordPage = lazy(() => import("./components/patientRecord/PatientRecordPage"))
import { patientPageUrl, cardTokenFromHash, patientCodeFromHash } from "./components/patientRecord/patientRecord"
const NurseStation = lazy(() => import("./components/NurseStation"))
import { BreadcrumbsBar, type BreadcrumbItem } from "./components/BreadcrumbsBar"
import { WardCustomizationService } from "./services/wardCustomization"

const OPWorkflow = lazy(() => import("./components/OPWorkflow"))

const SmartOCR = lazy(() => import("./components/SmartOCR"))

const DpiOcrPortal = lazy(() => import("./components/DpiOcrPortal"))

const SymptomAI = lazy(() => import("./components/SymptomAI"))

const ClinicalRAG = lazy(() => import("./components/ClinicalRAG"))

const ClinicalSummaries = lazy(() => import("./components/ClinicalSummaries"))

const BulkAI = lazy(() => import("./components/BulkAI"))

const NLFiltering = lazy(() => import("./components/NLFiltering"))

const IntelligenceHub = lazy(() => import("./components/IntelligenceHub"))

const QueueManagement = lazy(() => import("./components/QueueManagement"))

const OPManagement = lazy(() => import("./components/OPManagement"))
const OPDProcedures = lazy(() => import("./components/OPDProcedures"))
const DoctorPortal = lazy(() => import("./components/doctor/DoctorPortal"))
const DoctorsOverview = lazy(() => import("./components/doctor/DoctorsOverview"))

const DoctorScheduling = lazy(() => import("./components/DoctorScheduling"))

const PatientExperience = lazy(() => import("./components/PatientExperience"))
const PatientMessages = lazy(() => import("./components/messaging/PatientMessages"))

import HrWorkspace, { type HrSection } from "./components/hr/HrWorkspace"
const OnDutyStrip = lazy(() => import("./components/hr/OnDutyStrip"))
import { hr } from "./services/hr/client"
import { HrmsDatabase } from "./services/hrmsDb"
const HRMS = lazy(() => import("./components/HRMS"))
const ApplyLeaveModal = lazy(() => import("./components/hrms/ApplyLeaveModal"))
import { AdminCredentialsModal } from "./components/AdminCredentialsModal"

const Admissions = lazy(() => import("./components/Admissions"))

const Readmission = lazy(() => import("./components/Readmission"))

const PaymentCollection = lazy(() => import("./components/PaymentCollection"))

const RevenueReports = lazy(() => import("./components/RevenueReports"))

const Administration = lazy(() => import("./components/Administration"))
const DepartmentAccessDenied = lazy(() => import("./components/DepartmentAccessDenied"))

const OpReportsPage = lazy(() => import("./components/reports/OpReportsPage"))

const GeneralReportsOverviewPage = lazy(() => import("./components/reports/GeneralReportsOverviewPage"))
const PatientPoliciesPage = lazy(() => import("./components/insurance/PatientPoliciesPage"))

import GenericReportPage, {
  ReportType,
} from "./components/reports/GenericReportPage"

const MessagesPanel = lazy(() => import("./components/MessagesPanel"))
import { useMediaQuery } from "./hooks/useMediaQuery"
import PageErrorBoundary from "./components/PageErrorBoundary"

import {
  DoctorAccount,
  DoctorPortalDatabase,
  resolveDoctorAccount,
  getAllDoctorAccounts,
  DOCTOR_ROSTER,
} from "./services/doctorPortalDb"
import { syncDoctorMasterFromBackend } from "./services/doctorMaster"

import { ALL_SYSTEM_MODULES } from "./services/roleDb"

import { LabOrderDatabase } from "./services/labOrdersDb"
import { LabInventoryDatabase } from "./services/labInventoryDb"
import { PharmacyDatabase, isAwaitingVerification } from "./services/pharmacyDb"
import { ErDatabase } from "./services/erDb"
import { BedDatabase } from "./services/bedDb"
import { BillingDatabase } from "./services/billingDb"
import { db, type DBOPEncounter } from "./services/db"
import { getDischargedIcuPatients } from "./components/icu/IcuDischargeModal"
import { RadiologyWorkflowDb } from "./services/radiologyWorkflowDb"
import { UniversalRadiologyDb } from "./services/universalRadiologyDb"

/** Insurance sub-modules and legacy key mappings */
const SETUP_TAB_OF: Record<string, "main" | "mail" | "plan" | "guide"> = {
  insurance_setup: "main",
  insurance_masters: "main",
  insurance_tpas: "main",
  insurance_mail_setup: "mail",
  insurance_plan: "plan",
  insurance_guide: "guide",
}
const insuranceModule = (m: string): string =>
  SETUP_TAB_OF[m]
    ? "insurance_setup"
    : m === "insurance_reconciliation"
    ? "insurance_settlement"
    : m === "insurance_desk"
      ? "insurance_overview"
      : m === "insurance"
        ? "insurance_claims"
        : m


type Module = "dashboard" | "patients" | "appointments" | "emergency" | "emergency_ui" | "clinical" | "inpatient" | "nursing" | "laboratory" | "lab_dashboard" | "lab_orders_collection" | "lab_workbench" | "lab_review_reports" | "lab_admin_config" | "lab_orders" | "lab_sample_collection" | "lab_sample_reception" | "lab_worklists" | "lab_analyzers" | "lab_result_entry" | "lab_pathologist_review" | "lab_critical_alerts" | "lab_reports" | "lab_test_master" | "lab_quality_analytics" | "lab_settings" | "lab_processing" | "lab_critical" | "lab_catalog" | "lab_inventory" | "lab_analytics" | "lab_tat" | "radiology" | "radiology_overview" | "radiology_worklist" | "radiology_scheduling" | "radiology_operations" | "radiology_reporting" | "radiology_finalized" | "radiology_exceptions" | "radiology_analytics" | "radiology_admin" | "radiology_template_upload" | "radiology_templates" | "radiology_xray" | "radiology_ct" | "radiology_usg" | "radiology_mri" | "radiology_reports" | "pharmacy" | "pharmacy_dispensing" | "pharmacy_rx" | "pharmacy_ocr" | "pharmacy_returns" | "pharmacy_supplier_returns" | "pharmacy_medicine" | "pharmacy_category" | "pharmacy_suppliers" | "pharmacy_po" | "pharmacy_grn" | "pharmacy_ledger" | "pharmacy_transfers" | "pharmacy_expiry" | "pharmacy_write_off" | "pharmacy_analytics" | "pharmacy_notifications" | "pharmacy_users" | "pharmacy_audit" | "pharmacy_settings" | "surgery" | "billing" | "billing_op" | "billing_ip" | "billing_er" | "billing_unified" | "billing_insured" | "billing_revenue" | "icu" | "icu_micu" | "icu_sicu" | "icu_ccu" | "icu_nicu" | "icu_picu" | "icu_ward" | "discharge" | "triage" | "insurance" | "insurance_overview" | "insurance_desk" | "insurance_board" | "insurance_case" | "insurance_discharge" | "insurance_reports" | "insurance_preauth" | "insurance_eligibility" | "insurance_claims" | "insurance_queries" | "insurance_emails" | "insurance_settlement" | "insurance_gaps" | "insurance_reconciliation" | "insurance_masters" | "insurance_tpas" | "insurance_packages" | "insurance_pricing" | "insurance_docrules" | "insurance_patient_policies" | "insurance_guide" | "insurance_plan" | "insurance_mail_setup" | "insurance_setup" | "analytics" | "reports" | "reports_overview" | "reports_patients" | "reports_op" | "reports_er" | "reports_inpatient" | "reports_appointments" | "reports_doctors" | "reports_pharmacy" | "reports_laboratory" | "reports_radiology" | "reports_beds" | "reports_admissions" | "reports_discharges" | "reports_staff" | "admin" | "admin_doctors" | "chart" | "register" | "outpatient" | "queue" | "op_management" | "op_registration" | "op_workflow" | "op_nurse" | "opd_procedures" | "doctor_workflow" | "doctor_portal" | "scheduling" | "admissions" | "readmission" | "lab_billing" | "payments" | "revenue_reports" | "reports_pharmacy_damaged" | "reports_supplier_returns" | "hrms" | "my_hr" | "employees" | "hr_dashboard" | "hr_attendance" | "hr_staffing" | "hr_leave" | "hr_approvals" | "hr_payroll" | "hr_recruitment" | "hr_organization" | "hr_training" | "hr_performance" | "hr_compliance" | "hr_grievances" | "hr_reports" | "hr_announcements" | "hr_muster" | "hr_biometric" | "hr_timetables" | "hr_audit" | "patient_exp" | "patient_messages" | "registry" | "intelligence" | "ocr" | "dpi_ocr" | "symptom_ai" | "clinical_rag" | "clinical_summaries" | "bulk_ai" | "nl_filtering" | "beds"

const HR_MODULE_SECTION_MAP: Record<string, HrSection> = {
  hrms: "dashboard",
  hr_dashboard: "dashboard",
  employees: "employees",
  hr_attendance: "attendance",
  scheduling: "shifts",
  hr_staffing: "staffing",
  hr_leave: "leave",
  hr_approvals: "approvals",
  hr_payroll: "payroll",
  hr_recruitment: "recruitment",
  hr_organization: "organization",
  hr_training: "training",
  hr_performance: "performance",
  hr_compliance: "compliance",
  hr_grievances: "grievances",
  hr_reports: "reports",
  hr_announcements: "announcements",
  hr_muster: "attendance",
  hr_biometric: "attendance",
  hr_timetables: "shifts",
  hr_audit: "reports",
  my_hr: "leave",
}


interface NavItem {
  key: Module

  label: string

  Icon: React.ComponentType<{ className?: string; size?: number | string }>

  badge?: number

  children?: { key: Module; label: string; group?: string }[]
}

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },

  { key: "doctor_portal", label: "Doctor Workspace", Icon: Stethoscope },

  {
    key: "patients",
    label: "Reception",
    Icon: Users,

    children: [
      { key: "patients", label: "Patient Search" },

      { key: "register", label: "Registration" },

      { key: "registry", label: "Registry" },

      { key: "appointments", label: "Appointments" },

      { key: "patient_messages", label: "Patient Messages" },
    ],
  },

  {
    key: "outpatient",
    label: "OP Department",
    Icon: ClipboardList,
    children: [
      { key: "op_management", label: "OP Management" },
      { key: "queue", label: "Live Queue Board" },
      { key: "op_nurse", label: "Nurse Station" },
      { key: "opd_procedures", label: "OPD Minor Procedures" },
    ],
  },

  {
    key: "clinical",
    label: "Clinical",
    Icon: FileText,

    children: [{ key: "chart", label: "Encounters" }],
  },

  {
    key: "emergency",
    label: "Emergency",
    Icon: Siren,

    children: [
      { key: "emergency", label: "ED Track Board" },
      { key: "triage", label: "Triage" },
    ],
  },

  {
    key: "inpatient",
    label: "Inpatient",
    Icon: BedDouble,

    children: [
      { key: "inpatient", label: "Bed Board" },

      { key: "beds", label: "Bed Management" },

      { key: "nursing", label: "Ward Nursing" },

      { key: "admissions", label: "Admissions" },

      { key: "readmission", label: "Readmission" },

      { key: "discharge", label: "Discharge" },
    ],
  },

  {
    // Each ICU unit is its own sub-page of one Critical Care workspace; the
    // sub-keys inherit the "icu" grant, so no role needs updating.
    key: "icu",
    label: "Critical Care",
    Icon: HeartPulse,

    children: [
      { key: "icu", label: "All ICUs" },
      { key: "icu_micu", label: "Medical ICU (MICU)" },
      { key: "icu_sicu", label: "Surgical ICU (SICU)" },
      { key: "icu_ccu", label: "Cardiac ICU (CCU)" },
      { key: "icu_nicu", label: "Neuro ICU (NICU)" },
      { key: "icu_picu", label: "Pediatric ICU (PICU)" },
      { key: "icu_ward", label: "ICU Ward" },
    ],
  },

  {
    key: "laboratory",
    label: "Laboratory",
    Icon: FlaskConical,
    children: [
      { key: "lab_dashboard", label: "Lab Dashboard" },
      { key: "lab_orders_collection", label: "Lab Orders Directory" },
      { key: "lab_workbench", label: "Lab Workbench" },
      { key: "lab_reports", label: "Lab Reports" },
      { key: "lab_inventory", label: "Lab Inventory & Consumables" },
      { key: "lab_quality_analytics", label: "Quality & Analytics" },
      { key: "lab_admin_config", label: "Admin Configuration" },
    ],
  },

  {
    key: "radiology",
    label: "Radiology",
    Icon: Scan,
    children: [
      { key: "radiology", label: "Overview Hub" },
      { key: "radiology_worklist", label: "Examination Worklist" },
      { key: "radiology_operations", label: "Scanning Operations" },
      { key: "radiology_reporting", label: "Reporting Workspace" },
      { key: "radiology_reports", label: "Finalized Reports" },
      { key: "radiology_template_upload", label: "Template Management" },
      { key: "radiology_analytics", label: "Department Analytics" },
    ],
  },

  {
    key: "pharmacy",
    label: "Pharmacy",
    Icon: Pill,

    children: [
      { key: "pharmacy", label: "Dashboard" },
      { key: "pharmacy_dispensing", label: "Dispensing & Billing" },
      { key: "pharmacy_rx", label: "Doctor Prescriptions" },
      { key: "pharmacy_returns", label: "Patient Returns & Refunds" },
      { key: "pharmacy_medicine", label: "Medicine Catalog & Batches" },
      { key: "pharmacy_suppliers", label: "Suppliers Directory" },
      { key: "pharmacy_ocr", label: "Inward Stock Entry (GRN)" },
      { key: "pharmacy_supplier_returns", label: "Supplier Returns (Debit Notes)" },
      { key: "pharmacy_ledger", label: "Stock Movement Ledger" },
      { key: "pharmacy_expiry", label: "Expiry & Low Stock Alerts" },
      { key: "pharmacy_write_off", label: "Medicine Disposal & Write-Off" },
      { key: "pharmacy_analytics", label: "Pharmacy Analytics & Reports" },
      { key: "pharmacy_notifications", label: "Alerts & Notifications" },
      { key: "pharmacy_audit", label: "Pharmacy Audit Log" },
    ],
  },

  { key: "surgery", label: "Surgery", Icon: Scissors },

  {
    key: "billing",
    label: "Billing",
    Icon: CreditCard,

    // One page per counter. Grouped children render under a caption, so the
    // counters, the lab desk and the records read as three short lists.
    children: [
      // "billing" is the Billing Dashboard -- the module's landing page, as
      // Dashboard is for the app. Screens that deep-link to "billing" with a
      // bill preselected are forwarded by the dashboard to that bill's counter.
      { key: "billing", label: "Billing Dashboard" },
      { key: "billing_op", label: "OP Billing", group: "Counters" },
      { key: "billing_ip", label: "IP Billing", group: "Counters" },
      { key: "billing_er", label: "Emergency Billing", group: "Counters" },
      { key: "lab_billing", label: "Investigation Billing", group: "Counters" },
      { key: "billing_insured", label: "Patients & Insurance", group: "Insurance" },
      { key: "billing_unified", label: "Unified Patient Bill", group: "Records" },
      { key: "payments", label: "Payment History", group: "Records" },
      { key: "billing_revenue", label: "Revenue & Dues", group: "Records" },
    ],
  },

  {
    // The insurance engine shared by OP / IP / ER / OT / ICU: one case per
    // insured encounter, from
    // eligibility and pre-auth through claim, queries and settlement.
    key: "insurance",
    label: "Insurance",
    Icon: ShieldCheck,

    children: [
      // Same order as the patient journey: register -> verify -> pre-auth -> claim -> settle.
      { key: "insurance_overview", label: "Command Dashboard" },
      { key: "insurance_patient_policies", label: "Patient Insurance" },
      { key: "insurance_eligibility", label: "Intake & Eligibility" },
      { key: "insurance_preauth", label: "Pre-Authorization" },
      { key: "insurance_claims", label: "Claims, Queries & Denials" },
      { key: "insurance_emails", label: "Email & TPA Decision Hub" },
      { key: "insurance_settlement", label: "Settlement & Reconciliation" },
      { key: "insurance_gaps", label: "Payment Gaps" },
      { key: "insurance_reports", label: "Insurance Reports" },
      { key: "insurance_setup", label: "Setup" },
      { key: "insurance_docrules", label: "Audit Log & Rules" },
    ],
  },

  {
    key: "hrms",
    label: "HR & Staff",
    Icon: UsersRound,
    children: [
      { key: "hrms", label: "Executive Dashboard" },
      { key: "employees", label: "Employees Master" },
      { key: "hr_attendance", label: "Attendance & Bio" },
      { key: "scheduling", label: "Duty Shifts & Roster" },
      { key: "hr_staffing", label: "Department Staffing" },
      { key: "hr_leave", label: "Leave Requests" },
      { key: "hr_approvals", label: "Pending Approvals" },
      { key: "hr_payroll", label: "Payroll Processing" },
      { key: "hr_recruitment", label: "Recruitment & Onboarding" },
      { key: "hr_organization", label: "Organization Structure" },
      { key: "hr_training", label: "Training & Compliance" },
      { key: "hr_performance", label: "Staff Appraisals" },
      { key: "hr_compliance", label: "Regulatory Audits" },
      { key: "hr_grievances", label: "Disciplinary & Grievances" },
      { key: "hr_reports", label: "Statutory HR Reports" },
      { key: "hr_announcements", label: "Staff Circulars" },
    ],
  },

  {
    key: "intelligence",
    label: "Hosp AI",
    Icon: Sparkles,

    children: [
      { key: "dpi_ocr", label: "Keppler OCR" },

      { key: "symptom_ai", label: "Symptom AI" },

      { key: "clinical_summaries", label: "Clinical Summaries" },

      { key: "nl_filtering", label: "PatientReach AI" },
    ],
  },

  {
    key: "reports",
    label: "Reports",
    Icon: BarChart3,

    children: [
      { key: "reports_overview", label: "Overview", group: "General Reports" },

      {
        key: "reports_patients",
        label: "Patient Reports",
        group: "General Reports",
      },

      { key: "reports_op", label: "OP Reports", group: "General Reports" },

      { key: "reports_er", label: "ER Reports", group: "General Reports" },

      {
        key: "reports_inpatient",
        label: "IP / Inpatient Reports",
        group: "General Reports",
      },

      {
        key: "reports_appointments",
        label: "Appointment Reports",
        group: "General Reports",
      },

      {
        key: "reports_doctors",
        label: "Doctor Reports",
        group: "General Reports",
      },

      {
        key: "reports_pharmacy",
        label: "Pharmacy Reports",
        group: "General Reports",
      },

      {
        key: "reports_laboratory",
        label: "Laboratory Reports",
        group: "General Reports",
      },

      {
        key: "reports_radiology",
        label: "Radiology Reports",
        group: "General Reports",
      },

      { key: "reports_beds", label: "Bed Reports", group: "General Reports" },

      {
        key: "reports_admissions",
        label: "Admission Reports",
        group: "General Reports",
      },

      {
        key: "reports_discharges",
        label: "Discharge Reports",
        group: "General Reports",
      },

      {
        key: "reports_staff",
        label: "Staff Reports",
        group: "General Reports",
      },

      {
        key: "revenue_reports",
        label: "Revenue Reports",
        group: "Financial Reports",
      },

      {
        key: "reports_pharmacy_damaged",
        label: "Pharmacy Damaged Stock",
        group: "Financial Reports",
      },

      {
        key: "reports_supplier_returns",
        label: "Supplier Return Ledger",
        group: "Financial Reports",
      },
    ],
  },

  {
    key: "admin",
    label: "Administration",
    Icon: Icon.Admin,
    children: [
      { key: "admin", label: "Control Centre" },
      { key: "admin_doctors", label: "Doctor Workspace & Master" },
    ],
  },
]

// Breadcrumb label for a module. NAV already carries a proper label for every

// entry -- including all 18 pharmacy screens -- so the trail is read from there

// instead of a ternary chain that had to be extended by hand and fell through to

// the raw module key ("Pharmacy_rx") for anything nobody had added yet.

const BREADCRUMB_OVERRIDES: Record<string, string | string[]> = {
  laboratory: "Laboratory",
  chart: "Patient Chart",

  register: "Registration",

  discharge: "Discharge Workflow",

  op_management: "OP Management",
  op_workflow: "OP Clinical Journey",
  doctor_workflow: "Doctor Workspace",
  doctor_portal: "Doctor Workspace",
  admin_doctors: ["Administration", "Doctor Workspace & Master"],
  patient_exp: "Patient Experience",
  patient_messages: ["Reception", "Patient Messages"],
  registry: ["Reception", "Patient Registry"],
  nursing: ["Inpatient", "Ward Nursing"],

  clinical_rag: "Clinical RAG",

  reports: ["Reports", "General Reports", "Overview"],

  reports_overview: ["Reports", "General Reports", "Overview"],

  reports_patients: ["Reports", "General Reports", "Patient Reports"],

  reports_op: ["Reports", "General Reports", "OP Reports"],

  reports_er: ["Reports", "General Reports", "ER Reports"],

  reports_inpatient: ["Reports", "General Reports", "IP / Inpatient Reports"],

  reports_appointments: ["Reports", "General Reports", "Appointment Reports"],

  reports_doctors: ["Reports", "General Reports", "Doctor Reports"],

  reports_pharmacy: ["Reports", "General Reports", "Pharmacy Reports"],

  reports_laboratory: ["Reports", "General Reports", "Laboratory Reports"],

  reports_radiology: ["Reports", "General Reports", "Radiology Reports"],

  reports_beds: ["Reports", "General Reports", "Bed Reports"],

  reports_admissions: ["Reports", "General Reports", "Admission Reports"],

  reports_discharges: ["Reports", "General Reports", "Discharge Reports"],

  reports_staff: ["Reports", "General Reports", "Staff Reports"],

  revenue_reports: ["Reports", "Financial Reports", "Revenue Reports"],

  reports_pharmacy_damaged: [
    "Reports",
    "Financial Reports",
    "Pharmacy Damaged Stock",
  ],

  reports_supplier_returns: [
    "Reports",
    "Financial Reports",
    "Supplier Return Ledger",
  ],
}

function moduleTrail(module: string): string[] {
  const override = BREADCRUMB_OVERRIDES[module]

  if (override) return Array.isArray(override) ? override : [override]

  for (const item of NAV) {
    const parentLabel = WardCustomizationService.getDisplayName(item.key) !== item.key
      ? WardCustomizationService.getDisplayName(item.key)
      : WardCustomizationService.getDisplayName(item.label)

    if (item.key === module && !item.children) return [parentLabel]

    const child = item.children?.find((c) => c.key === module)

    if (child) {
      const childLabel = WardCustomizationService.getDisplayName(child.key) !== child.key
        ? WardCustomizationService.getDisplayName(child.key)
        : WardCustomizationService.getDisplayName(child.label)

      if (child.group) {
        return [parentLabel, child.group, childLabel]
      }

      // A module's own landing page repeats the section name otherwise.
      return child.key === item.key ? [parentLabel] : [parentLabel, childLabel]
    }

    if (item.key === module) return [parentLabel]
  }

  return [module]
}

/** Shown for the instant it takes to load a page's code the first time it is opened. */
function PageLoading() {
  return (
    <div className="flex-1 flex items-center justify-center py-24 text-sm text-slate-400" role="status" aria-live="polite">
      <span className="w-4 h-4 mr-2 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" /> Loading…
    </div>
  )
}

class NotificationErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("NotificationPanel error caught:", error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <>
          <div className="fixed inset-0 z-40" onClick={this.props.onClose} aria-hidden="true" />
          <div className="fixed left-2 right-2 top-12 sm:absolute sm:left-auto sm:right-0 sm:top-full mt-1 sm:w-80 bg-white border border-slate-200 rounded shadow-xl z-50 p-4 text-center">
            <div className="text-slate-800 font-semibold text-xs mb-1">Notifications</div>
            <div className="text-slate-500 text-[11px] mb-3">No active notifications available right now.</div>
            <button
              onClick={() => {
                this.setState({ hasError: false })
                this.props.onClose?.()
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded transition-colors"
            >
              Close
            </button>
          </div>
        </>
      )
    }
    return this.props.children
  }
}

/** "just now", "12 min ago", "3 h ago", or the date: from a real timestamp, never invented. */
function agoLabel(at: string | null | undefined): string {
  if (!at) return ""
  const d = new Date(at.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(at) ? at : at + "Z")
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (Number.isNaN(mins)) return ""
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function NotificationPanel({
  onClose,
  onNavigate,
  onUnreadChange,
  canOpenModule,
}: {
  onClose: () => void
  onNavigate: (module: string, sub?: string) => void
  onUnreadChange?: (count: number) => void
  /** Which departments this user may open: a transfer notice shows only for those. */
  canOpenModule: (module: string) => boolean
}) {
  const [noticeTick, setNoticeTick] = useState(0)
  useEffect(() => {
    const off = TransferNotices.subscribe(() => setNoticeTick((n) => n + 1))
    return () => {
      off()
    }
  }, [])
  const [readState, setReadState] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("hospai_dashboard_notifs_read")
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  const [hrNotes, setHrNotes] = useState<{ id: string; severity: string; title: string; body: string | null; at: string | null; target: string }[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      try {
        if (hr && typeof hr.get === "function") {
          hr.get<typeof hrNotes>("/api/v1/me/notifications")
            .then((rows) => alive && setHrNotes(Array.isArray(rows) ? rows.slice(0, 8) : []))
            .catch(() => alive && setHrNotes([]))
        }
      } catch {
        if (alive) setHrNotes([])
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const items = React.useMemo(() => {
    const list: {
      id: string
      type: "critical" | "warning" | "info"
      icon: string
      title: string
      body: string
      time: string
      target: string
      sub?: string
      /** A department hand-off: can be cleared with "Done" once the patient has been processed. */
      noticeId?: string
      /** Already opened by this user (still waiting for the department to process the patient). */
      seen?: boolean
    }[] = []

    // 0. Patients sent to a department this user can open (shared through the server): everything still
    //    waiting to be processed there, urgent first, until someone presses "Done".
    try {
      TransferNotices.pending(canOpenModule).forEach((tn) => {
        const k = tn.kind.toLowerCase()
        list.push({
          id: `xfer-${tn.id}`,
          noticeId: String(tn.id),
          seen: tn.seen,
          type: tn.priority === "Urgent" ? "critical" : "warning",
          icon: tn.priority === "Urgent" ? "🚨" : k.includes("lab") ? "🧪" : k.includes("study") || k.includes("radiology") ? "🩻" : k.includes("prescription") || k.includes("medicine") ? "💊" : k.includes("bill") || k.includes("payment") ? "🧾" : k.includes("registration") || k.includes("registered") || k.includes("revisit") ? "📝" : "🔁",
          // admissions and hand-overs to a doctor open the doctor's IP patients list
          sub: /admitted under you|concern doctor|handed over|admission advised/i.test(tn.kind) ? "ip" : undefined,
          title: tn.patientName,
          body: `${tn.kind} · ${tn.from || "—"} → ${tn.to}${tn.note ? ` · ${tn.note}` : ""}`,
          time: agoLabel(tn.at),
          target: tn.toModule,
        })
      })
    } catch (e) {
      console.warn("Transfer notices error", e)
    }

    // 1. Bed Transfer notifications
    try {
      const transfers = BedDatabase.getTransferNotifications()
      if (Array.isArray(transfers)) {
        transfers.slice(0, 3).forEach((tr) => {
          if (!tr) return
          const isStat = Boolean(tr.priority && String(tr.priority).includes("Stat"))
          list.push({
            id: `tr-${tr.id || Math.random()}`,
            type: isStat ? "critical" : "warning",
            icon: "🛏️",
            title: `Bed Transfer: ${tr.patient_name || "Patient"}`,
            body: `${tr.source_department || "Ward"} → ${tr.target_destination || "Destination"}`,
            time: "",
            target: "inpatient",
            sub: tr.target_ward,
          })
        })
      }
    } catch (e) {
      console.warn("Transfer notifs error", e)
    }

    // 2. Critical & Pending Labs
    try {
      const labs = LabOrderDatabase.getOrders()
      if (Array.isArray(labs)) {
        labs
          .filter((l) => l && (l.status === "Awaiting Billing" || l.status === "Sample Collected" || l.status === "In Progress" || (Array.isArray(l.tests) && l.tests.some(t => t?.flag === "Critical"))))
          .slice(0, 3)
          .forEach((l) => {
            const isCrit = Array.isArray(l.tests) && l.tests.some((t) => t?.flag === "Critical" || t?.urgency === "STAT")
            const testName = (Array.isArray(l.tests) && l.tests[0]?.name) ? l.tests[0].name : "Diagnostic Order"
            list.push({
              id: `lab-${l.id || Math.random()}`,
              type: isCrit ? "critical" : "info",
              icon: "🧪",
              title: isCrit ? `Critical Lab: ${l.patientName || "Patient"}` : `Pending Lab: ${testName}`,
              body: `${testName} (${l.umr || "UMR"}) · Status: ${l.status || "Pending"}`,
              time: "",
              target: "laboratory",
            })
          })
      }
    } catch (e) {
      console.warn("Lab notifs error", e)
    }

    // 3. ER Active Visits / Census
    try {
      const erVisits = ErDatabase.getVisits("active")
      if (Array.isArray(erVisits) && erVisits.length > 0) {
        const criticalEr = erVisits.filter(
          (v) => v && (v.triage_category === "B1" || v.triage_category === "ESI-1"),
        )
        list.push({
          id: "er-census",
          type: criticalEr.length > 0 ? "warning" : "info",
          icon: "🚨",
          title: `ER Census: ${erVisits.length} Active Patients`,
          body: `${criticalEr.length} critical patient(s) in resuscitation/emergency bay`,
          time: "",
          target: "emergency",
        })
      }
    } catch (e) {
      console.warn("ER notifs error", e)
    }

    // 4. ICU Discharges
    try {
      const icuDis = typeof getDischargedIcuPatients === "function" ? getDischargedIcuPatients() : []
      if (Array.isArray(icuDis) && icuDis.length > 0) {
        list.push({
          id: "icu-discharge",
          type: "info",
          icon: "📋",
          title: `ICU Discharge Handoffs (${icuDis.length})`,
          body: `${icuDis[0]?.patientName || "Patient"} ready for reception bed allocation`,
          time: "",
          target: "discharge",
        })
      }
    } catch (e) {
      console.warn("ICU notifs error", e)
    }

    // 5. Today's Appointments
    try {
      const encs = typeof db?.getEncounters === "function" ? db.getEncounters() : []
      if (Array.isArray(encs) && encs.length > 0) {
        list.push({
          id: "op-appointments",
          type: "info",
          icon: "📅",
          title: `Appointments: ${encs.length} Booked Today`,
          body: `Next: ${encs[0]?.patientName || "Patient"} with ${encs[0]?.assignedDoctor || "Physician"}`,
          time: "Today",
          target: "appointments",
        })
      }
    } catch (e) {
      console.warn("Appointments notifs error", e)
    }

    // 6. HR Notes
    if (Array.isArray(hrNotes)) {
      for (const n of hrNotes) {
        if (!n) continue
        let timeStr = ""
        if (n.at) {
          try {
            timeStr = new Date(n.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
          } catch {}
        }
        list.push({
          id: `hr-${n.id || Math.random()}`,
          type: n.severity === "warning" ? "warning" : "info",
          icon: "👥",
          title: n.title || "HR Notice",
          body: n.body ?? "",
          time: timeStr,
          target: n.target === "approvals" ? "hr_leave" : "hrms",
        })
      }
    }

    // 7. Pharmacy Operational Alerts
    try {
      const pharmNotifs = typeof PharmacyDatabase?.getNotifications === "function" ? PharmacyDatabase.getNotifications() : []
      if (Array.isArray(pharmNotifs)) {
        pharmNotifs.filter(p => !p.read && (p.type === "critical" || p.type === "warning")).slice(0, 2).forEach((pn) => {
          list.push({
            id: `ph-${pn.id}`,
            type: pn.type === "critical" ? "critical" : "warning",
            icon: "💊",
            title: pn.title || "Pharmacy Alert",
            body: pn.message || "",
            time: "Today",
            target: "pharmacy",
            sub: "pharmacy_notifications",
          })
        })
      }
    } catch {}

    return list
  }, [hrNotes, noticeTick, canOpenModule])

  const markAllRead = () => {
    const updated: Record<string, boolean> = { ...readState }
    items.forEach((item) => {
      updated[item.id] = true
    })
    setReadState(updated)
    try {
      localStorage.setItem(
        "hospai_dashboard_notifs_read",
        JSON.stringify(updated),
      )
    } catch { }
  }

  const markDone = (noticeId: string) => {
    void TransferNotices.markHandled(noticeId) // cleared for the whole department
  }

  const markSingleRead = (id: string, target: string, sub?: string) => {
    if (id.startsWith("xfer-")) void TransferNotices.markSeen(id.slice(5)) // seen for this user on the server
    const updated = { ...readState, [id]: true }
    setReadState(updated)
    try {
      localStorage.setItem(
        "hospai_dashboard_notifs_read",
        JSON.stringify(updated),
      )
    } catch { }
    onNavigate(target, sub)
    onClose()
  }

  // A department hand-off is "unread" until someone opens it (tracked on the server, per user); the rest use this browser's read list.
  const isRead = (i: { id: string; noticeId?: string; seen?: boolean }) => (i.noticeId ? Boolean(i.seen) || Boolean(readState[i.id]) : Boolean(readState[i.id]))
  const unreadCount = items.filter((i) => !isRead(i)).length

  useEffect(() => {
    onUnreadChange?.(unreadCount)
  }, [unreadCount, onUnreadChange])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed left-2 right-2 top-12 sm:absolute sm:left-auto sm:right-0 sm:top-full mt-1 sm:w-84 bg-white border border-[#DDE2EC] rounded shadow-xl z-50 overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#DDE2EC] bg-[#FAFCFF] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-gray-900">
              Notifications
            </span>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-mono">
                {unreadCount} New
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] text-[#1B4FD8] font-semibold hover:underline cursor-pointer"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-[#F1F5F9]">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">
              <span className="text-xl block mb-1.5">🔔</span>
              No active notifications
            </div>
          ) : (
            items.map((n) => {
              const rowRead = isRead(n)
              return (
                <div
                  key={n.id}
                  onClick={() => markSingleRead(n.id, n.target, n.sub)}
                  className={`flex gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-blue-50/60 transition-colors ${n.type === "critical" && n.noticeId ? "border-l-4 border-l-red-500 " : ""}${!rowRead ? "bg-[#F4F7FF]" : "bg-white"}`}
                >
                  <span className="text-base mt-0.5">{n.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[12px] truncate ${!rowRead
                          ? "font-bold text-gray-900"
                          : "font-medium text-gray-700"
                          }`}
                      >
                        {n.title}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                        {n.time}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-[#64748B] mt-0.5 line-clamp-2">
                      {n.body}
                    </div>
                    {n.noticeId && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-[10.5px] font-bold text-[#1B4FD8]">Open patient →</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            markDone(n.noticeId!)
                          }}
                          className="text-[10.5px] font-bold px-2 py-0.5 border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 cursor-pointer"
                          title="Patient processed here: clear this notice for the whole department"
                        >
                          ✓ Done
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

function NursingDashboard() {
  return (
    <div className="flex-1 overflow-y-auto bg-[#F0F2F5]">
      <div className="bg-white border-b border-[#DDE2EC] px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">
          Nursing Dashboard — 3N Medical
        </h1>
        <p className="text-[11.5px] text-[#64748B]">
          RN Jessica Carter · Shift: 07:00–19:00 · Aug 23, 2026
        </p>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              room: "204",
              patient: "John Smith",
              age: 41,
              vitals: "Due 11:00",
              meds: "Insulin 11:00 ▲",
              status: "Active",
              acuity: 2,
            },

            {
              room: "208",
              patient: "Mary Jones",
              age: 53,
              vitals: "Done ✓",
              meds: "None due",
              status: "Stable",
              acuity: 3,
            },

            {
              room: "212",
              patient: "Frank Torres",
              age: 55,
              vitals: "Due 12:00",
              meds: "Labetalol PRN",
              status: "Active",
              acuity: 2,
            },

            {
              room: "215",
              patient: "Helen Park",
              age: 72,
              vitals: "Done ✓",
              meds: "Done ✓",
              status: "Isolation",
              acuity: 3,
            },

            {
              room: "221",
              patient: "Robert Lee",
              age: 66,
              vitals: "Overdue ⚠",
              meds: "Overdue ⚠",
              status: "Concern",
              acuity: 2,
            },

            {
              room: "225",
              patient: "Sandra Hill",
              age: 48,
              vitals: "Done ✓",
              meds: "None due",
              status: "Stable",
              acuity: 4,
            },
          ].map((p, i) => (
            <div
              key={i}
              className={`bg-white border rounded p-4 ${p.status === "Concern"
                ? "border-[#FECACA]"
                : p.status === "Isolation"
                  ? "border-[#FED7AA]"
                  : "border-[#DDE2EC]"
                }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#94A3B8]">
                      Rm {p.room}
                    </span>
                    <span
                      className={`text-[10.5px] font-semibold px-1.5 py-px rounded ${p.acuity === 2
                        ? "bg-[#FEE2E2] text-[#B91C1C]"
                        : p.acuity === 3
                          ? "bg-[#FEF3C7] text-[#B45309]"
                          : "bg-[#DCFCE7] text-[#15803D]"
                        }`}
                    >
                      Acuity {p.acuity}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold text-gray-900 mt-0.5">
                    {p.patient}
                  </div>
                  <div className="text-[11.5px] text-[#64748B]">
                    {p.age} yrs
                  </div>
                </div>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${p.status === "Concern"
                    ? "bg-[#FEE2E2] text-[#B91C1C]"
                    : p.status === "Isolation"
                      ? "bg-[#FEF3C7] text-[#B45309]"
                      : p.status === "Active"
                        ? "bg-[#EFF6FF] text-[#1D4ED8]"
                        : "bg-[#F0FDF4] text-[#15803D]"
                    }`}
                >
                  {p.status}
                </span>
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Vitals</span>
                  <span
                    className={`font-medium ${p.vitals.includes("Overdue")
                      ? "text-[#DC2626]"
                      : p.vitals.includes("Due")
                        ? "text-[#D97706]"
                        : "text-[#16A34A]"
                      }`}
                  >
                    {p.vitals}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Medications</span>
                  <span
                    className={`font-medium ${p.meds.includes("Overdue")
                      ? "text-[#DC2626]"
                      : p.meds.includes("▲")
                        ? "text-[#D97706]"
                        : "text-[#16A34A]"
                      }`}
                  >
                    {p.meds}
                  </span>
                </div>
              </div>
              <div className="flex gap-1.5 mt-3">
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Vitals
                </button>
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Meds
                </button>
                <button className="flex-1 text-[11px] font-medium py-1 rounded border border-[#DDE2EC] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-gray-700">
                  Notes
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface StaffProfile {
  id: string

  name: string

  role: string

  title: string

  department: string

  activeShift?: string
}

const DEFAULT_STAFF: StaffProfile = {
  id: "ADM-001",

  name: "Hospital Administrator",

  role: "Admin",

  title: "Hospital Administrator",

  department: "Administration",
}

function getRoleProfile(roleId: string, username?: string): StaffProfile {
  return {
    id: "ADM-001",
    name: "System Administrator",
    role: "ROLE_ADMIN",
    title: "System Administrator",
    department: "Administration",
  }
}

function isModuleAccessible(
  targetModule: string,
  role: string,
  permissions: string[] = [],
  staff?: StaffProfile,
): boolean {
  // One rule set for every screen: see utils/accessControl.ts (exact role keys, exact grants).
  if (staff?.role === "ROLE_ADMIN") return true
  return canOpenScreen(targetModule, role, permissions, staff?.id)
}

function getFirstAllowedModule(
  role: string,
  permissions: string[] = [],
  staff?: StaffProfile,
): Module {
  for (const item of NAV) {
    if (item.key === "admin" && role !== "ROLE_ADMIN" && !permissions.includes("admin")) continue
    if (isModuleAccessible(item.key, role, permissions, staff)) {
      return item.key
    }
    if (item.children) {
      for (const child of item.children) {
        if (isModuleAccessible(child.key, role, permissions, staff)) {
          return child.key
        }
      }
    }
  }
  return "dashboard"
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [routeHash, setRouteHash] = useState(() => (typeof window !== "undefined" ? window.location.hash : ""))

  useEffect(() => {
    const handleHashChange = () => setRouteHash(window.location.hash)
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  const publicCardToken = cardTokenFromHash(routeHash)
  const publicPatientCode = patientCodeFromHash(routeHash)
  const isPublicPatientView = Boolean(publicCardToken || publicPatientCode)

  const [userRole, setUserRole] = useState<string>("ROLE_ADMIN")

  const [userPermissions, setUserPermissions] = useState<string[]>([])

  const [activeStaff, setActiveStaff] = useState<StaffProfile>(DEFAULT_STAFF)

  // Set when a physician signs in: their portal is scoped to this one doctor.
  const [activeDoctor, setActiveDoctor] = useState<DoctorAccount | null>(null)
  // Set when a super admin inspects a specific doctor workspace from the complete overview
  const [adminInspectingDoctor, setAdminInspectingDoctor] = useState<DoctorAccount | null>(null)
  const [adminDoctorView, setAdminDoctorView] = useState<"workspace" | "overview">("workspace")

  const [roleMenuOpen, setRoleMenuOpen] = useState(false)
  const [showAdminCredentialsModal, setShowAdminCredentialsModal] = useState(false)

  const [notice, setNotice] = useState<Notice | null>(null)

  const stableSetNotice = useCallback((n: Notice | null) => setNotice(n), [])

  const [module, setModule] = useState<Module>("dashboard")

  // Insurance pages link to one another by case, e.g. a query row -> its claim.
  const [insuranceCaseId, setInsuranceCaseId] = useState<string | undefined>()
  const [setupTab, setSetupTab] = useState<"main" | "mail" | "plan" | "guide">("main")
  // Which Master Setup tab to open when navigating there (insurers by default).
  const [mastersSection, setMastersSection] = useState<"insurers" | "tpas" | "packages" | "pricing" | "docrules">("insurers")
  // Reception -> billing: open the OP counter with THIS visit's bill selected. It used to open
  // the generic Billing Dashboard with nothing selected, so the booked patient seemed not to
  // have reached billing.
  const goToOpBilling = (encounterId?: string) => {
    if (encounterId) {
      try {
        BillingDatabase.getClaims() // make sure the visit's bill exists before the counter looks for it
      } catch {
        /* the counter re-derives it */
      }
      BillingDatabase.setPreselectedClaimForBilling(encounterId)
    }
    setModule("billing_op" as Module)
  }

  const openInsurance = (m: string, caseId?: string) => {
    if (SETUP_TAB_OF[m]) setSetupTab(SETUP_TAB_OF[m])
    setInsuranceCaseId(caseId)
    setModule(insuranceModule(m) as Module)
  }

  // Set alongside setModule("chart") when another page (e.g. a bed card's

  // patient name) wants Patient Chart to open directly on that patient

  // instead of its own directory.

  const [clinicalPatientId, setClinicalPatientId] = useState<string | null>(
    null,
  )
  const [scannedJourneyEncounter, setScannedJourneyEncounter] = useState<DBOPEncounter | null>(null)

  const openPatientClinical = (patientId: string) => {
    setClinicalPatientId(patientId)

    setModule("chart")
  }

  const [expanded, setExpanded] = useState<string[]>([])
  const [expandedReportGroups, setExpandedReportGroups] = useState<string[]>([
    "General Reports",
  ])
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [showAllDepartments, setShowAllDepartments] = useState<boolean>(true)
  const [radiologyStudyId, setRadiologyStudyId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("hospai_active_radiology_study_id")
    } catch {
      return null
    }
  })
  const [subBadges, setSubBadges] = useState<Record<string, number>>({})

  // Bumped whenever the doctor inbox or the lab-order queue changes, so the

  // sidebar counts move without waiting for the next navigation.

  const [badgeTick, setBadgeTick] = useState(0)

  useEffect(
    () => DoctorPortalDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => LabOrderDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => LabInventoryDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  useEffect(
    () => PharmacyDatabase.subscribe(() => setBadgeTick((t) => t + 1)),
    [],
  )

  const [wardCustomizationTick, setWardCustomizationTick] = useState(0)

  useEffect(() => {
    const handleWardUpdate = () => setWardCustomizationTick((t) => t + 1)
    window.addEventListener("hospai_ward_customization_updated", handleWardUpdate)
    return () => window.removeEventListener("hospai_ward_customization_updated", handleWardUpdate)
  }, [])

  const resolveNavLabel = useCallback(
    (key: string, defaultLabel: string): string => {
      const custom = WardCustomizationService.getDisplayName(key)
      if (custom && custom !== key) return custom
      const customByLabel = WardCustomizationService.getDisplayName(defaultLabel)
      if (customByLabel && customByLabel !== defaultLabel) return customByLabel
      return defaultLabel
    },
    [wardCustomizationTick],
  )

  const [breadcrumbHistory, setBreadcrumbHistory] = useState<BreadcrumbItem[]>([
    { module: "dashboard", label: "Home" },
  ])
  const [currentActivePatient, setCurrentActivePatient] = useState<{ id?: string; name?: string } | null>(null)

  const resolvePatientName = useCallback((patientId?: string | null): string | undefined => {
    if (!patientId) return undefined
    try {
      const pats = typeof db?.getPatients === "function" ? db.getPatients() : []
      const p = pats.find((x: any) => x.patient_id === patientId || x.id === patientId || x.umr === patientId || x.mrn === patientId)
      if (p?.name) return p.name
      if ((p as any)?.firstName) return `${(p as any).firstName} ${(p as any).lastName || ""}`.trim()
      const encs = typeof db?.getEncounters === "function" ? db.getEncounters() : []
      const enc = encs.find((e: any) => e.patientId === patientId || e.id === patientId || e.umr === patientId)
      if (enc?.patientName) return enc.patientName
    } catch {}
    return undefined
  }, [])

  const getModuleBreadcrumbLabel = useCallback(
    (mod: string): string => {
      if (mod === "dashboard") return "Home"
      if (mod === "chart") return "Patient History"
      if (mod === "register") return "Registration"
      if (mod === "patients") return "Reception"
      if (mod === "outpatient" || mod === "op_management" || mod === "op_workflow") return "OP Department"
      if (mod === "queue") return "Live Queue Board"
      if (mod === "op_nurse") return "Nurse Station"
      if (mod === "opd_procedures") return "OPD Minor Procedures"
      if (mod === "billing" || mod === "billing_op" || mod === "billing_ip" || mod === "billing_unified" || mod === "billing_insured") return "Billing"
      if (mod === "doctor_portal" || mod === "doctor_workflow") return "Doctor Workspace"
      if (mod === "emergency") return "Emergency"
      if (mod === "triage") return "Triage"
      if (mod === "inpatient") return resolveNavLabel("inpatient", "Bed Board")
      if (mod === "beds") return "Bed Management"
      if (mod === "admissions") return "Admissions"
      if (mod === "readmission") return "Readmission"
      if (mod === "discharge") return "Discharge"
      if (mod === "icu") return resolveNavLabel("icu", "Critical Care")
      if (mod.startsWith("icu_")) return resolveNavLabel(mod, mod.slice(4).toUpperCase())
      if (mod === "pharmacy" || mod.startsWith("pharmacy_")) return "Pharmacy"
      if (mod === "laboratory" || mod.startsWith("lab_")) return "Laboratory"
      if (mod === "radiology" || mod.startsWith("radiology_")) return "Radiology"
      if (mod === "surgery") return "Surgery & OT"
      const trail = moduleTrail(mod)
      return trail[trail.length - 1] || mod
    },
    [resolveNavLabel],
  )

  useEffect(() => {
    const label = getModuleBreadcrumbLabel(module)
    const patientId = clinicalPatientId || currentActivePatient?.id || undefined
    const patientName = currentActivePatient?.name || resolvePatientName(patientId) || undefined

    setBreadcrumbHistory((prev) => {
      if (module === "dashboard") {
        return [{ module: "dashboard", label: "Home" }]
      }

      const existingIdx = prev.findIndex((c) => c.module === module)
      if (existingIdx >= 0) {
        const sliced = prev.slice(0, existingIdx + 1)
        sliced[existingIdx] = {
          ...sliced[existingIdx],
          label,
          patientId: patientId || sliced[existingIdx].patientId,
          patientName: patientName || sliced[existingIdx].patientName,
          timestamp: Date.now(),
        }
        return sliced
      }

      let base = prev
      if (base.length === 0 || base[0].module !== "dashboard") {
        base = [{ module: "dashboard", label: "Home" }, ...base]
      }

      const newCrumb: BreadcrumbItem = {
        module,
        label,
        patientId,
        patientName,
        timestamp: Date.now(),
      }

      const next = [...base, newCrumb]
      return next.length > 8 ? [next[0], ...next.slice(-7)] : next
    })
  }, [module, clinicalPatientId, currentActivePatient, getModuleBreadcrumbLabel, resolvePatientName])

  const handleNavigateCrumb = (item: BreadcrumbItem, index: number) => {
    if (item.patientId) {
      setClinicalPatientId(item.patientId)
      if (item.patientName) {
        setCurrentActivePatient({ id: item.patientId, name: item.patientName })
      }
    } else {
      setClinicalPatientId(null)
      setCurrentActivePatient(null)
    }
    setBreadcrumbHistory((prev) => prev.slice(0, index + 1))
    setModule(item.module as Module)
  }

  const handleBreadcrumbGoBack = () => {
    if (breadcrumbHistory.length <= 1) return
    const targetIdx = breadcrumbHistory.length - 2
    const target = breadcrumbHistory[targetIdx]
    if (target.patientId) {
      setClinicalPatientId(target.patientId)
      if (target.patientName) {
        setCurrentActivePatient({ id: target.patientId, name: target.patientName })
      }
    } else {
      setClinicalPatientId(null)
      setCurrentActivePatient(null)
    }
    setBreadcrumbHistory((prev) => prev.slice(0, targetIdx + 1))
    setModule(target.module as Module)
  }

  // Below lg (phones, portrait tablets) the sidebar is an off-canvas drawer:
  // a fixed 288px column would leave a phone ~90px for the page itself. On
  // small laptops (lg..xl) it starts as the icon rail so the page keeps most
  // of the width; the toggle still expands it.
  const isCompactViewport = useMediaQuery("(max-width: 1023px)")
  const isNarrowLaptop = useMediaQuery("(max-width: 1279px)")

  const [sidebarCollapsed, setSidebarCollapsed] = useState(isNarrowLaptop)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setSidebarCollapsed(isNarrowLaptop)
  }, [isNarrowLaptop])

  useEffect(() => {
    if (!sidebarCollapsed) {
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current)
        hoverLeaveTimerRef.current = null
      }
      setSidebarHovered(false)
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    }
  }, [])

  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!isCompactViewport) setMobileNavOpen(false)
  }, [isCompactViewport])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileNavOpen])

  // The drawer shows full labels; the icon rail only exists on wide screens.
  // When closed, moving cursor to the sidebar opens it completely; removing cursor closes it.
  const isHoverExpanded = sidebarCollapsed && sidebarHovered && !isCompactViewport
  const railCollapsed = sidebarCollapsed && !sidebarHovered && !isCompactViewport
  const isSidebarOpen = isCompactViewport ? mobileNavOpen : !railCollapsed

  const handleSidebarMouseEnter = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    if (sidebarCollapsed && !isCompactViewport) {
      setSidebarHovered(true)
    }
  }

  const handleSidebarMouseLeave = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
    }
    // Smooth grace window (200ms) before slow, smooth collapse
    hoverLeaveTimerRef.current = setTimeout(() => {
      setSidebarHovered(false)
      hoverLeaveTimerRef.current = null
    }, 200)
  }

  // Picking a page from the drawer should reveal the page, not leave the menu
  // covering it. Expanding a parent group does not close it.
  const closeMobileNav = () => {
    if (isCompactViewport) setMobileNavOpen(false)
  }

  // Keppler OCR is a whole separate React app in an iframe: unmounting it on

  // every nav away means re-downloading its module graph and re-running its

  // silent sign-in on every return (~3s cold). Mount it once, then just hide

  // it, so going back is instant.

  const [ocrMounted, setOcrMounted] = useState(false)

  useEffect(() => {
    if (module === "dpi_ocr") setOcrMounted(true)
  }, [module])

  const mainRef = useRef<HTMLElement>(null)

  // Automatically scroll workspace to top whenever opening or switching modules/reports
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [module])

  const [orderOpen, setOrderOpen] = useState(false)

  const [cmdOpen, setCmdOpen] = useState(false)

  const [notifOpen, setNotifOpen] = useState(false)
  const [notifUnreadCount, setNotifUnreadCount] = useState(0)
  const [transferUnseen, setTransferUnseen] = useState(0)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(3)
  const [globalApplyLeaveOpen, setGlobalApplyLeaveOpen] = useState(false)

  const [globalSearch, setGlobalSearch] = useState("")

  const [isFullscreen, setIsFullscreen] = useState(false)

  const [zoomLevel, setZoomLevel] = useState(() => {
    // Persisted so a chosen text size survives a reload; storage can throw in

    // private windows, and a bad/stale value must not scale the whole app.

    try {
      const saved = parseFloat(localStorage.getItem("hms.zoomLevel") ?? "")

      if (Number.isFinite(saved)) return Math.min(1.2, Math.max(0.7, saved))
    } catch { }

    return 1
  })

  useEffect(() => {
    try {
      localStorage.setItem("hms.zoomLevel", String(zoomLevel))
    } catch { }
  }, [zoomLevel])

  const [newMenuOpen, setNewMenuOpen] = useState(false)

  const [workflowInitialStep, setWorkflowInitialStep] = useState<number>(2)

  const [selectedWorkflowEncounterId, setSelectedWorkflowEncounterId] =
    useState<string | undefined>()

  const [selectedTriageVisitId, setSelectedTriageVisitId] =
    useState<number | null>(null)

  const isNurse = userRole === "rn"

  /**
   * Whether this user may open a clinical consultation screen at all.
   *
   * The sidebar is already filtered by permission, but the OP screens also carry
   * their own "View in Doctor Portal" / "Doctor Portal ➔" buttons, and those
   * bypassed the nav entirely: a receptionist clicking one was bounced to the
   * dashboard by the route guard below with no explanation. Reception books the
   * appointment and takes payment -- the consultation is not theirs to open --
   * so the entry points are withheld rather than left to fail.
   */

  const roleIdUpper = (userRole || "").toUpperCase()
  const isSuperAdminUser =
    userRole === "ROLE_ADMIN" ||
    userRole === "ROLE_SUPERADMIN" ||
    userRole === "admin" ||
    activeStaff?.id === "ADM-001" ||
    activeStaff?.role === "ROLE_ADMIN" ||
    userPermissions.includes("*") ||
    userPermissions.includes("admin")

  const isDoctorUser =
    Boolean(activeDoctor) ||
    userRole === "ROLE_DOCTOR" ||
    Boolean(
      userRole &&
        (roleIdUpper.includes("DOCTOR") ||
          roleIdUpper.includes("SURGEON") ||
          roleIdUpper.includes("PHYSICIAN") ||
          roleIdUpper.includes("CLINICIAN")),
    )

  const canOpenConsultation = isDoctorUser || isSuperAdminUser

  // Opens a case (and tells the concern doctor) for every newly occupied bed, even if nobody opens a bed screen.
  useEffect(() => {
    if (!loggedIn) return
    IpCare.reconcile()
    const t = window.setInterval(() => IpCare.reconcile(), 20_000)
    return () => window.clearInterval(t)
  }, [loggedIn])

  // Notes and orders carry the name of whoever is signed in.
  useEffect(() => {
    setCurrentActor(loggedIn ? { id: activeDoctor?.staffId || activeStaff?.id || "", name: activeDoctor?.name || activeStaff?.name || "Staff", role: userRole } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, activeStaff?.id, activeStaff?.name, activeDoctor?.id, userRole])

  // Personal notices ("admitted under you") reach only the doctor they name (and administrators).
  useEffect(() => {
    TransferNotices.setViewer(
      [activeDoctor?.id, activeDoctor?.staffId, activeDoctor?.name, activeDoctor?.username, activeStaff?.id, activeStaff?.name],
      isSuperAdminUser,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoctor?.id, activeStaff?.id, isSuperAdminUser])

  // Transfer notices: a department learns a patient is on the way without opening the bell first.
  const canOpenNoticeModule = useCallback(
    (m: string) => isSuperAdminUser || isModuleAccessible(m, userRole, userPermissions, activeStaff),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperAdminUser, userRole],
  )
  useEffect(() => {
    if (!loggedIn) return
    // A department learns a patient is on the way without opening the bell: new notices pop up once.
    const announced = new Set<string>()
    let primed = false
    const recount = () => {
      const unseen = TransferNotices.unseen(canOpenNoticeModule)
      setTransferUnseen(unseen.length)
      const fresh = unseen.filter((n) => !announced.has(String(n.id)))
      fresh.forEach((n) => announced.add(String(n.id)))
      if (!primed) {
        if (TransferNotices.loaded()) primed = true // what was already waiting at sign-in is not announced again
        return
      }
      fresh.slice(0, 3).forEach((n) =>
        hotToast(`${n.priority === "Urgent" ? "🚨 URGENT · " : ""}${n.kind}: ${n.patientName}${n.note ? ` — ${n.note}` : ""}`, { duration: n.priority === "Urgent" ? 9000 : 5000 }),
      )
    }
    const off = TransferNotices.subscribe(recount)
    void TransferNotices.refresh()
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void TransferNotices.refresh()
    }, 20_000)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [loggedIn, canOpenNoticeModule])

  // After sign-in, fetch the busiest pages' code while the browser is idle, so the first click on
  // each of them opens instantly instead of waiting for a download.
  useEffect(() => {
    if (!loggedIn) return
    const loaders = [
      () => import("./components/Registration"),
      () => import("./components/OPManagement"),
      () => import("./components/QueueManagement"),
      () => import("./components/Billing"),
      () => import("./pages/ErPage"),
      () => import("./components/Inpatient"),
      () => import("./components/doctor/DoctorPortal"),
      () => import("./components/Pharmacy"),
      () => import("./components/Laboratory"),
      () => import("./components/Radiology"),
    ]
    let cancelled = false
    const idle = (cb: () => void) =>
      typeof (window as any).requestIdleCallback === "function" ? (window as any).requestIdleCallback(cb, { timeout: 4000 }) : window.setTimeout(cb, 1500)
    const next = (i: number) => {
      if (cancelled || i >= loaders.length) return
      idle(() => {
        loaders[i]().catch(() => undefined) // a failed prefetch is harmless: the page loads normally when opened
        next(i + 1)
      })
    }
    next(0)
    return () => {
      cancelled = true
    }
  }, [loggedIn])

  // Insurance records live in PostgreSQL: load them after sign-in and keep desks in step.
  // Only roles that can open the insurance module poll (others would just get 403s).
  useEffect(() => {
    if (!loggedIn) return
    const canInsurance =
      isSuperAdminUser ||
      isModuleAccessible("insurance", userRole, userPermissions, activeStaff) ||
      isModuleAccessible("insurance_overview", userRole, userPermissions, activeStaff)
    if (!canInsurance) return
    void InsuranceEngineService.hydrate()
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void InsuranceEngineService.hydrate()
    }, 30_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, userRole, isSuperAdminUser])

  // Check route access
  useEffect(() => {
    // Needs a session: calling it on the login screen returned a 401 every load.
    // Once per sign-in, and only for roles allowed to read the admin doctor list
    // (everyone else got a 403 on every module change).
    if (!loggedIn) return
    if (!isSuperAdminUser && !userPermissions.includes("admin.use")) return
    syncDoctorMasterFromBackend().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, isSuperAdminUser])

  useEffect(() => {
    if (!loggedIn) return
    if (isSuperAdminUser) return

    // If all departments are visible in the sidebar, restricted modules are handled
    // in-place by DepartmentAccessDenied rather than bouncing the user back.
    if (showAllDepartments) return

    // If restricted departments are hidden, redirect unauthorized routes to first allowed module
    if (!isModuleAccessible(module, userRole, userPermissions, activeStaff)) {
      const fallback = getFirstAllowedModule(userRole, userPermissions, activeStaff)
      if (fallback !== module) {
        setModule(fallback)
      }
    }
  }, [module, loggedIn, userPermissions, userRole, showAllDepartments, activeStaff])

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      // Clear the local UI state even if the session has already expired. The
      // server remains the source of truth and will reject the old cookie.
      console.warn("Logout request failed", error)
    } finally {
      setRoleMenuOpen(false)
      setActiveDoctor(null)
      setAdminInspectingDoctor(null)
      setAppSessionAuthenticated(false)
      setLoggedIn(false)
    }
  }

  const handleLogin = (userData: LoginUserData) => {
    setAdminInspectingDoctor(null)
    setAppSessionAuthenticated(true)
    setUserRole(userData.role)
    const resolvedDoctor = resolveDoctorAccount({
      doctorId: userData.doctorId,
      username: userData.user,
      name: userData.staffName || userData.user,
      specialty: userData.staffDepartment,
      department: userData.staffDepartment,
    })

    const roleIdUpper = (userData.role || "").toUpperCase()
    const userRoleKey = userData.user.trim().toLowerCase()
    const isSuperAdmin =
      roleIdUpper === "ROLE_ADMIN" ||
      roleIdUpper === "ROLE_SUPERADMIN" ||
      userRoleKey === "admin"

    const isDoctor =
      !isSuperAdmin &&
      (roleIdUpper === "ROLE_DOCTOR" ||
        roleIdUpper.includes("DOCTOR") ||
        roleIdUpper.includes("SURGEON") ||
        roleIdUpper.includes("PHYSICIAN") ||
        roleIdUpper.includes("CLINICIAN") ||
        Boolean(userData.doctorId) ||
        Boolean(
          resolvedDoctor &&
            (resolvedDoctor.username.toLowerCase() === userRoleKey ||
              resolvedDoctor.id.toLowerCase() === userRoleKey ||
              resolvedDoctor.staffId.toLowerCase() === userRoleKey),
        ))

    const doctor = isDoctor ? resolvedDoctor : null
    setActiveDoctor(doctor)

    const effectivePermissions = [...userData.permissions]
    if (doctor && !effectivePermissions.includes("doctor_portal")) {
      effectivePermissions.push("doctor_portal")
    }
    setUserPermissions(effectivePermissions)

    if (doctor) {
      setActiveStaff({
        id: doctor.staffId,
        name: doctor.name,
        role: userData.role || "ROLE_DOCTOR",
        title: doctor.qualification || "Consultant Physician",
        department: `${doctor.specialty} · ${doctor.room}`,
      })
    } else if (userData.staffName) {
      setActiveStaff({
        id: userData.staffId,
        name: userData.staffName,
        role: userData.role,
        title: userData.staffTitle || "Hospital Staff",
        department: userData.staffDepartment || "Clinical Operations",
      })
    } else {
      setActiveStaff(getRoleProfile(userData.role, userData.user))
    }

    let defaultModule: Module = "dashboard"

    // An administrator is the role the server issued (never a username that happens to contain "admin", and never a "*" /
    // "admin" string inside a module list).
    const isSuperAdminAccount =
      roleIdUpper === "ROLE_ADMIN" ||
      roleIdUpper === "ROLE_SUPERADMIN" ||
      userData.staffId === "ADM-001"

    // Where each built-in role lands first: matched on the exact role key, then checked against what the account may open.
    const LANDING: Record<string, Module> = {
      ROLE_DOCTOR: "doctor_portal", ROLE_PHYSICIAN: "doctor_portal", ROLE_CLINICIAN: "doctor_portal", ROLE_SURGEON: "doctor_portal", ROLE_ER_PHYSICIAN: "doctor_portal",
      ROLE_NURSE: "nursing", ROLE_NURSING_SUPERVISOR: "nursing",
      ROLE_PHARMACIST: "pharmacy", ROLE_PHARMACY_MANAGER: "pharmacy", ROLE_INVENTORY_MANAGER: "pharmacy",
      ROLE_LAB_TECHNICIAN: "laboratory", ROLE_PATHOLOGIST: "laboratory",
      ROLE_RADIOLOGY_TECHNICIAN: "radiology", ROLE_RADIOLOGIST: "radiology",
      ROLE_RECEPTIONIST: "register", ROLE_FRONT_OFFICE_MANAGER: "register",
      ROLE_BILLING_EXECUTIVE: "billing", ROLE_INSURANCE_TPA_OFFICER: "insurance",
      ROLE_HR_MANAGER: "hrms", ROLE_HR_EXECUTIVE: "hrms", ROLE_COMPLIANCE_OFFICER: "hrms",
    }
    if (isSuperAdminAccount) {
      defaultModule = "admin"
    } else if (doctor) {
      defaultModule = "doctor_portal"
    } else if (LANDING[roleIdUpper]) {
      defaultModule = LANDING[roleIdUpper]
    }

    // If the default module is not in the granted permissions, fallback to the first allowed module
    if (!isSuperAdminAccount && !isModuleAccessible(defaultModule, userData.role, userData.permissions, activeStaff)) {
      defaultModule = getFirstAllowedModule(userData.role, userData.permissions, activeStaff)
    }

    setLoggedIn(true)
    setModule(defaultModule)

    // Signed in from a scanned patient card: go straight to that patient.
    try {
      const pending = sessionStorage.getItem("hospai_pending_patient_page")
      if (pending) {
        sessionStorage.removeItem("hospai_pending_patient_page")
        window.location.hash = `#/patient/${encodeURIComponent(pending)}`
      }
    } catch { }
  }

  // A browser cache must never be sufficient to restore a signed-in user.
  // Ask the server to validate the HttpOnly session cookie on every app load.
  useEffect(() => {
    let cancelled = false
    const restoreSession = async () => {
      try {
        const response = await apiFetch<{ user: AuthenticatedUser | null }>(
          "/api/auth/session",
        )
        if (!cancelled && response.user) {
          handleLogin(loginUserFromAuthenticated(response.user))
        }
      } catch (error) {
        // Network and expired-session failures both leave the user at Login;
        // apiFetch deliberately has no local-auth fallback.
        console.warn("Unable to restore authenticated session", error)
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {
          setIsFullscreen((prev) => !prev)
        })
    } else {
      if (document.exitFullscreen) {
        document
          .exitFullscreen()
          .then(() => setIsFullscreen(false))
          .catch(() => {
            setIsFullscreen(false)
          })
      }
    }
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  // Global Shortcuts (Ctrl+K, F11, ?, Esc)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setCmdOpen(true)
        return
      }

      if (e.key === "F11") {
        e.preventDefault()
        toggleFullscreen()
        return
      }

      if (e.key === "Escape") {
        setCmdOpen(false)
      }
    }

    window.addEventListener("keydown", h)

    return () => window.removeEventListener("keydown", h)
  }, [])

  const [subModule, setSubModule] = useState<string | undefined>(undefined)

  // Any module (patient chart, admissions, ER, OT, discharge, bed board) can
  // open an insurance page on a case without threading a prop down to it.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ module: string; caseId?: string; section?: typeof mastersSection }>).detail
      if (!d?.module) return
      setInsuranceCaseId(d.caseId)
      if (d.section) setMastersSection(d.section)
      if (SETUP_TAB_OF[d.module]) setSetupTab(SETUP_TAB_OF[d.module])
      if (d.caseId && (d.module === "insurance" || d.module === "insurance_case" || d.module === "insurance_claims")) {
        setModule("insurance_case")
      } else if (d.module === "insurance_preauth") {
        setModule("insurance_preauth")
      } else {
        setModule(insuranceModule(d.module) as Module)
      }
    }
    const onNavigateGlobal = (e: Event) => {
      const d = (e as CustomEvent<{ module: string }>).detail
      if (d && d.module) {
        setModule(d.module as Module)
      }
    }
    window.addEventListener("hms:navigate", onNavigateGlobal)
    window.addEventListener("hms:open-insurance", onOpen)
    return () => {
      window.removeEventListener("hms:navigate", onNavigateGlobal)
      window.removeEventListener("hms:open-insurance", onOpen)
    }
  }, [])

  const navigate = (m: string, sub?: string) => {
    setModule(m as Module)
    setSubModule(sub)

    if (sub === "register") setModule("register")

    setCmdOpen(false)
  }

  // Counts on the nav itself, so a pharmacist sees what needs attention without opening each page.

  // Recomputed whenever the module changes, which is also when pharmacy data has just been written.

  useEffect(() => {
    if (!loggedIn) return

    try {
      const prescriptions = PharmacyDatabase.getPrescriptions()

      const batches = PharmacyDatabase.getBatches()

      const medicines = PharmacyDatabase.getMedicines()

      const active = batches.filter((b) => b.availableQuantity > 0)

      const expiringSoon = active.filter((b) => {
        const days = Math.ceil(
          (new Date(b.expiryDate).getTime() - Date.now()) / 86400000,
        )

        return days <= 90
      }).length

      const lowStock = medicines.filter(
        (m) =>
          batches
            .filter((b) => b.medicineId === m.id)
            .reduce((a, b) => a + b.availableQuantity, 0) <= m.reorderLevel,
      ).length

      // Merged in, not a full replace -- a separate effect owns the
      // "emergency" key (live ER visit count, polled from the backend) and
      // would get wiped out every time this effect re-runs otherwise.
      setSubBadges((prev) => ({
        ...prev,
        doctor_portal: activeDoctor
          ? DoctorPortalDatabase.getUnreadCount(activeDoctor.id)
          : 0,

        laboratory: 0,
        lab_orders_collection: LabOrderDatabase.getLabWorklist().filter(
          (o) => o.billing.status === "Paid" && o.status === "Billed",
        ).length,
        lab_workbench: LabOrderDatabase.getLabWorklist().filter(
          (o) => (o.status === "Sample Collected" || o.status === "In Progress"),
        ).length,
        lab_sample_collection: LabOrderDatabase.getLabWorklist().filter(
          (o) => o.billing.status === "Paid" && o.status === "Billed",
        ).length,
        lab_processing: LabOrderDatabase.getLabWorklist().filter(
          (o) => (o.status === "Sample Collected" || o.status === "In Progress"),
        ).length,
        lab_critical: LabOrderDatabase.getLabWorklist().filter((o) =>
          o.tests.some(
            (t) =>
              t.flag === "Critical" ||
              Object.values(t.results || {}).some((r) => r.flag === "Critical"),
          ),
        ).length,
        lab_reports: 0,
        lab_catalog: 0,
        lab_inventory: LabInventoryDatabase.getItems().filter(
          (i) => i.status === "Low Stock" || i.status === "Expiring Soon" || i.status === "Expired"
        ).length,
        lab_analytics: 0,
        lab_tat: 0,

        // Shared helper, not a list kept here: this badge omitted "Sent To Pharmacy"

        // -- the status the doctor portal dispatches with -- so a prescription sat

        pharmacy_rx: prescriptions.filter((p) =>
          isAwaitingVerification(p.status),
        ).length,
        pharmacy_dispensing: prescriptions.filter(
          (p) =>
            p.status === "Verified" ||
            p.status === "Approved" ||
            p.status === "Preparing" ||
            p.status === "Ready For Dispensing",
        ).length,

        pharmacy_expiry: expiringSoon,

        pharmacy_medicine: lowStock,
        radiology_worklist: RadiologyWorkflowDb.getStudies().length,
        radiology_operations: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedStatus === "IN PROGRESS").length,
        radiology_reporting: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedStatus === "DONE" && s.normalizedReportStatus !== "Finalized").length,
        radiology_reports: RadiologyWorkflowDb.getStudies().filter((s) => s.normalizedReportStatus === "Finalized").length,
      }))
    } catch {
      setSubBadges((prev) => ({
        ...prev,
        doctor_portal: 0,
        laboratory: 0,
        lab_sample_collection: 0,
        lab_processing: 0,
        lab_critical: 0,
        lab_reports: 0,
        lab_catalog: 0,
        lab_inventory: 0,
        lab_analytics: 0,
        lab_tat: 0,
        pharmacy_rx: 0,
        pharmacy_dispensing: 0,
        pharmacy_expiry: 0,
        pharmacy_medicine: 0,
        radiology_worklist: 0,
        radiology_operations: 0,
        radiology_reporting: 0,
        radiology_reports: 0,
      }))
    }
  }, [module, loggedIn, badgeTick, activeDoctor])

  // Emergency's nav badge is a live count of active ER visits, and Bed
  // Management's is pending ER bed requests -- both polled from the real
  // backend, unlike the pharmacy/lab/doctor-portal badges above, which read
  // from an in-memory local store. Triage doesn't get its own badge: it's a
  // child of Emergency now, and child badges sum onto the parent's, so a
  // separate "needs triage" count here would double-count against
  // `emergency`'s total-active count instead of adding real information.
  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    // Role-based polling: never call modules this role cannot open.
    const canEr = isSuperAdminUser || isModuleAccessible("emergency", userRole, userPermissions, activeStaff)
    const canBeds = isSuperAdminUser || isModuleAccessible("beds", userRole, userPermissions, activeStaff)
    if (!canEr && !canBeds) return
    const fetchEmergencyCount = async () => {
      if (canEr) try {
        const data = await apiFetch<{ visits: unknown[] }>(
          "/api/er/visits?active_only=true",
        )
        if (!cancelled) {
          setSubBadges((prev) => ({
            ...prev,
            emergency: (data.visits || []).length,
          }))
        }
      } catch {
        // best effort -- picked up again on the next poll tick
      }
      if (canBeds) try {
        const bedReqData = await apiFetch<{ bed_requests: unknown[] }>(
          "/api/er/bed-requests?status=pending",
        )
        if (!cancelled) {
          setSubBadges((prev) => ({
            ...prev,
            beds: (bedReqData.bed_requests || []).length,
          }))
        }
      } catch {
        // best effort -- picked up again on the next poll tick; a role
        // without beds.read just never gets this badge, which is fine
      }
    }
    void fetchEmergencyCount()
    const interval = window.setInterval(fetchEmergencyCount, 20000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, userRole, isSuperAdminUser])

  // Landing on a sub-module from anywhere but the sidebar (command palette, a shortcut button)

  // should still reveal where you are in the tree.

  useEffect(() => {
    const parent = NAV.find((n) =>
      n.children?.some((c) => c.key === module && c.key !== n.key),
    )

    if (!parent) return

    setExpanded((prev) =>
      prev.includes(parent.key) ? prev : [...prev, parent.key],
    )

    if (parent.key === "reports") {
      const child = parent.children?.find((c) => c.key === module)

      if (child?.group) {
        const grp = child.group

        setExpandedReportGroups((prev) =>
          prev.includes(grp) ? prev : [...prev, grp],
        )
      }
    }
  }, [module])

  const toggleExpand = (key: string) => {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  const toggleReportGroup = (group: string) => {
    setExpandedReportGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    )
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-[#F0F2F5]"
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        // dvh, not vh: on phones vh includes the area under the browser's
        // toolbar, which pushed the bottom of every page out of reach.
        height: `${100 / zoomLevel}dvh`,
        width: `${100 / zoomLevel}vw`,
        zoom: zoomLevel,
      }}
    >
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
      {isPublicPatientView ? (
        <PatientRecordPage cardToken={publicCardToken} code={publicPatientCode || ""} />
      ) : !loggedIn ? (
        <Login onLogin={handleLogin} />
      ) : (
        <>
          {/* OP card scans (hardware scanner or "Open journey" on a card)
              open the patient's OP or IP journey from any screen. */}
          <JourneyScanHost
            onOpenJourney={(codeOrEnc) => {
              if (codeOrEnc && typeof codeOrEnc === "object" && codeOrEnc.id) {
                setScannedJourneyEncounter(codeOrEnc)
              } else if (typeof codeOrEnc === "string") {
                const normalized = codeOrEnc.toUpperCase().trim()
                const match = db.getEncounters().find(
                  (e) =>
                    (e.umr && e.umr.toUpperCase().trim() === normalized) ||
                    (e.opNumber && e.opNumber.toUpperCase().trim() === normalized) ||
                    e.id === codeOrEnc,
                )
                if (match) {
                  setScannedJourneyEncounter(match)
                } else {
                  const pat = db.getPatientByUmr(normalized)
                  if (pat) {
                    const fallbackEnc: DBOPEncounter = {
                      id: `ENC-${pat.umr}`,
                      umr: pat.umr,
                      opNumber: "OP",
                      patientName: pat.name,
                      age:
                        typeof pat.age === "number"
                          ? pat.age
                          : parseInt(String(pat.age || 0)) || 0,
                      sex: (pat.sex as any) || "Male",
                      phone: pat.phone || "",
                      address: pat.address || "",
                      dept: "General Medicine",
                      assignedDoctor: "",
                      status: "Registered",
                      isNew: false,
                      bloodGroup: pat.bloodGroup,
                    }
                    setScannedJourneyEncounter(fallbackEnc)
                  } else {
                    window.open(patientPageUrl(codeOrEnc), "_blank")
                  }
                }
              }
            }}
          />

          {/* Quick OP Card & Clinical Journey Scanner Modal */}
          {scannedJourneyEncounter && (
            <PatientJourneyModal
              encounter={scannedJourneyEncounter}
              onClose={() => setScannedJourneyEncounter(null)}
              onNavigateToDoctorPortal={(encId) => {
                setModule("doctor_portal")
              }}
              onNavigateToOPWorkflow={(encId, step) => {
                setSelectedWorkflowEncounterId(encId)
                setWorkflowInitialStep(step ?? 1)
                setModule("op_workflow")
              }}
            />
          )}
          {/* ── Top Header ───────────────────────────────────────────────── */}
          <header className="bg-[#0C1524] border-b border-[#1E2D42] h-12 flex items-center gap-1.5 sm:gap-3 px-2 sm:px-3.5 flex-shrink-0 z-40 text-slate-200 shadow-sm">
            {/* Sidebar toggle */}
            <button
              data-sidebar-toggle
              onClick={() => {
                if (hoverLeaveTimerRef.current) {
                  clearTimeout(hoverLeaveTimerRef.current)
                  hoverLeaveTimerRef.current = null
                }
                setSidebarHovered(false)
                if (isCompactViewport) {
                  setMobileNavOpen((o) => !o)
                } else {
                  setSidebarCollapsed((c) => !c)
                }
              }}
              className="group w-8 h-8 flex-shrink-0 flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors rounded-lg hover:bg-white/10 cursor-pointer"
              title={
                isCompactViewport
                  ? mobileNavOpen
                    ? "Close menu"
                    : "Open menu"
                  : !railCollapsed
                    ? "Collapse sidebar"
                    : "Expand sidebar"
              }
              aria-label="Toggle navigation menu"
              aria-expanded={isSidebarOpen}
            >
              {/* Smooth animated hamburger icon morphing between 3-bar menu and left arrow */}
              <div className="w-[18px] h-[18px] relative flex flex-col justify-center items-center pointer-events-none group-hover:scale-105 transition-transform duration-200">
                {/* Top bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: isSidebarOpen ? "9px" : "14px",
                    left: "2px",
                    top: isSidebarOpen ? "8.2px" : "4px",
                    transformOrigin: "2px 50%",
                    transform: isSidebarOpen ? "rotate(-45deg)" : "none",
                  }}
                />
                {/* Middle bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: "14px",
                    left: "2px",
                    top: "8.2px",
                  }}
                />
                {/* Bottom bar */}
                <span
                  className="absolute h-[1.6px] bg-current rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width: isSidebarOpen ? "9px" : "14px",
                    left: "2px",
                    top: isSidebarOpen ? "8.2px" : "12.4px",
                    transformOrigin: "2px 50%",
                    transform: isSidebarOpen ? "rotate(45deg)" : "none",
                  }}
                />
              </div>
            </button>

            {/* Top Middle: Search bar + New button */}
            <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2.5 px-0 sm:px-3 max-w-2xl mx-auto">
              {/* Global Search */}
              <div className="w-full min-w-0 max-w-[420px] group">
                <button
                  onClick={() => setCmdOpen(true)}
                  aria-label="Search"
                  className="w-full relative flex items-center h-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-left text-[12.5px] text-[#94A3B8] transition-all overflow-hidden cursor-pointer"
                >
                  <span className="absolute left-2.5 text-[#64748B] group-hover:text-blue-400 transition-colors">
                    <Icon.Search />
                  </span>
                  <span className="pl-9 pr-2 md:pr-16 flex-1 truncate text-[#94A3B8]">
                    <span className="sm:hidden">Search…</span>
                    <span className="hidden sm:inline">
                      Search patients, MRN, appointments, reports...
                    </span>
                  </span>
                  <div className="absolute right-2 hidden md:flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <kbd className="bg-black/40 border border-white/10 text-white text-[9.5px] px-1.5 py-0.5 rounded font-mono">
                      Ctrl
                    </kbd>
                    <kbd className="bg-black/40 border border-white/10 text-white text-[9.5px] px-1.5 py-0.5 rounded font-mono">
                      K
                    </kbd>
                  </div>
                </button>
              </div>

              {/* Quick Create + New */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setNewMenuOpen((o) => !o)}
                  aria-label="New"
                  className="flex items-center gap-1.5 h-8 px-2 sm:px-3 bg-[#1B68F8] hover:bg-blue-600 rounded-lg text-white text-[12px] font-semibold transition-colors shadow-xs cursor-pointer"
                >
                  <Icon.Plus /> <span className="hidden sm:inline">New</span>
                </button>
                {newMenuOpen && (
                  <div className="absolute top-full right-0 sm:right-auto sm:left-0 mt-1 w-48 bg-[#0F172A] border border-[#1E2D42] rounded-lg shadow-xl z-50 py-1 text-slate-200">
                    <button
                      onClick={() => {
                        setModule("register")
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Patient
                    </button>
                    <button
                      onClick={() => {
                        setModule("appointments")
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Appointment
                    </button>
                    <button
                      onClick={() => {
                        setModule("chart")
                        setOrderOpen(true)
                        setNewMenuOpen(false)
                      }}
                      className="w-full text-left px-4 py-1.5 text-[12px] hover:bg-white/5 text-slate-200"
                    >
                      New Order
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1.5 ml-auto flex-shrink-0">
              {/* Text Size Zoom Controls -- pinch-zoom covers this on phones */}
              <div
                className="hidden md:flex items-center gap-1 px-1.5 py-1 bg-white/[0.04] hover:bg-white/[0.07] border border-[#1E2D42] rounded-lg transition-colors mr-1"
                title={`Text Size Zoom (Current scale: ${Math.round(zoomLevel * 100)}%)`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))
                  }
                  title="Decrease text size (A-)"
                  className="px-2 py-0.5 bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-blue-500 active:scale-95"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  title={zoomLevel === 1 ? "Scale is 100%" : "Reset text size to 100%"}
                  className="px-2 py-0.5 bg-white/10 hover:bg-slate-700 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-slate-500 active:scale-95"
                >
                  {Math.round(zoomLevel * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((z) => Math.min(1.3, Math.round((z + 0.1) * 10) / 10))
                  }
                  title="Increase text size (A+)"
                  className="px-2 py-0.5 bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border border-white/10 hover:border-blue-500 active:scale-95"
                >
                  A+
                </button>
              </div>

              {/* Notifications */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((n) => !n)}
                  className="relative w-8 h-8 flex items-center justify-center text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="Notifications"
                >
                  <Icon.Bell />
                  {(notifOpen ? notifUnreadCount : Math.max(notifUnreadCount, transferUnseen)) > 0 && (
                    <span className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 bg-[#DC2626] rounded-full text-[8px] text-white font-bold flex items-center justify-center pointer-events-none">
                      {(notifOpen ? notifUnreadCount : Math.max(notifUnreadCount, transferUnseen)) > 9 ? "9+" : notifOpen ? notifUnreadCount : Math.max(notifUnreadCount, transferUnseen)}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <NotificationErrorBoundary onClose={() => setNotifOpen(false)}>
                    <NotificationPanel
                      onClose={() => setNotifOpen(false)}
                      onNavigate={(m, s) => navigate(m, s)}
                      onUnreadChange={(count) => setNotifUnreadCount(count)}
                      canOpenModule={canOpenNoticeModule}
                    />
                  </NotificationErrorBoundary>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="hidden md:flex w-8 h-8 items-center justify-center text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? <Icon.Minimize /> : <Icon.Maximize />}
              </button>

              {/* Role Switcher / User Profile */}
              <div className="relative ml-0.5 sm:ml-1 pl-1 sm:pl-2.5 border-l border-[#1E2D42]">
                <button
                  onClick={() => setRoleMenuOpen(!roleMenuOpen)}
                  className="flex items-center gap-2 text-left hover:bg-white/5 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-[#1E293B] border border-white/15 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 shadow-2xs">
                    {activeStaff.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2) || "SA"}
                  </div>
                  <div className="hidden lg:block">
                    <div className="text-xs font-bold text-white leading-tight">
                      {activeStaff.name || "System Administrator"}
                    </div>
                    <div className="text-[10px] text-[#94A3B8] font-medium">
                      {activeStaff.title || "Hospital Administrator"}
                    </div>
                  </div>
                </button>

                {roleMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto bg-white border border-[#CBD5E1] shadow-2xl rounded-none z-50 p-2 text-[12px] space-y-1">
                    <div className="px-2 py-1 text-[10px] font-bold text-[#64748B] uppercase tracking-wider border-b border-[#E2E8F0]">
                      Assigned access
                    </div>
                    {[{ id: userRole, name: activeStaff.title || "Assigned role", allowedModules: ALL_SYSTEM_MODULES }].map((r) => {
                      const permissions = r.allowedModules || ALL_SYSTEM_MODULES

                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRoleMenuOpen(false)}
                          className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between transition-colors cursor-pointer ${userRole === r.id
                            ? "bg-[#EFF6FF] text-[#1B4FD8] font-bold"
                            : "hover:bg-[#F8FAFC] text-[#334155]"
                            }`}
                        >
                          <span className="flex items-center gap-2">
                            <span>🛡️</span>
                            <span>{r.name}</span>
                          </span>
                          {userRole === r.id && (
                            <span className="text-[10px] text-[#15803D]">
                              ● Active
                            </span>
                          )}
                        </button>
                      )
                    })}
                    <div className="border-t border-[#E2E8F0] pt-1 mt-1">
                      {(userRole === "ROLE_ADMIN" || userRole === "admin" || activeStaff?.id === "ADM-001" || userPermissions.includes("admin") || userPermissions.includes("*")) && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRoleMenuOpen(false)
                              setModule("admin")
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-[11px] text-[#1B4FD8] hover:bg-blue-50 font-bold rounded transition-colors flex items-center gap-2 cursor-pointer mb-1"
                          >
                            <span>⚙️</span>
                            <span>Administration &amp; RBAC</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRoleMenuOpen(false)
                              setShowAdminCredentialsModal(true)
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-[11px] text-[#059669] hover:bg-emerald-50 font-bold rounded transition-colors flex items-center gap-2 cursor-pointer mb-1"
                          >
                            <span>🔑</span>
                            <span>Edit Admin Credentials</span>
                          </button>
                        </>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-2.5 py-1 text-[11px] text-[#B91C1C] hover:bg-red-50 font-semibold rounded transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {notice && (
            <div
              className={`px-4 py-2 text-[12.5px] font-medium flex items-center justify-between flex-shrink-0 ${notice.type === "error"
                ? "bg-red-50 text-red-800 border-b border-red-200"
                : notice.type === "success"
                  ? "bg-green-50 text-green-800 border-b border-green-200"
                  : "bg-blue-50 text-blue-800 border-b border-blue-200"
                }`}
            >
              <span>{notice.message}</span>
              <button className="underline" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">
            {/* ── Sidebar ──────────────────────────────────────────────── */}
            {/* Drawer backdrop (phones / portrait tablets) */}
            {isCompactViewport && mobileNavOpen && (
              <div
                className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px]"
                onClick={() => setMobileNavOpen(false)}
                aria-hidden="true"
              />
            )}
            <aside
              aria-label="Main navigation"
              onMouseEnter={handleSidebarMouseEnter}
              onMouseLeave={handleSidebarMouseLeave}
              className={`bg-[#0C1524] border-r border-[#1E2D42] flex-shrink-0 flex flex-col overflow-y-auto overscroll-contain transition-[width,box-shadow] duration-500 ease-in-out ${isCompactViewport
                ? `fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-2xl transition-[transform,visibility] duration-300 ease-in-out ${mobileNavOpen ? "translate-x-0" : "-translate-x-full invisible"}`
                : `overflow-x-hidden ${railCollapsed ? "w-14" : "w-72"} ${isHoverExpanded ? "shadow-2xl shadow-black/50 z-20" : ""}`
                }`}
            >
              {/* Top Logo Section */}
              <div className="relative flex items-center justify-center py-3.5 px-3 border-b border-[#1E2D42]/80 flex-shrink-0 text-center w-full">
                {isCompactViewport && (
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    aria-label="Close menu"
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/10 text-[18px] leading-none cursor-pointer"
                  >
                    ×
                  </button>
                )}
                {railCollapsed ? (
                  <HospAILogo variant="icon" className="w-10 h-10 mx-auto" />
                ) : (
                  <HospAILogo variant="horizontal" className="h-24 lg:h-40 w-full justify-center mx-auto" />
                )}
              </div>
              <div
                className={`flex-1 py-2 ${railCollapsed ? "px-1" : "px-2"}`}
              >
                {!railCollapsed && (
                  <div className="flex items-center justify-between px-2.5 py-1 mb-1.5 text-[11px] font-semibold text-slate-400 border-b border-[#1E2D42]/60 select-none">
                    <span className="uppercase tracking-wider text-[10px] text-slate-400">Departments</span>
                    <button
                      type="button"
                      onClick={() => setShowAllDepartments((prev) => !prev)}
                      className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                        showAllDepartments
                          ? "bg-blue-600/30 text-blue-300 border border-blue-500/40 hover:bg-blue-600/40"
                          : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                      }`}
                      title={showAllDepartments ? "Showing all hospital departments. Click to show only your assigned workspaces." : "Showing assigned workspaces only. Click to show all hospital departments."}
                    >
                      <span>{showAllDepartments ? "All Depts" : "Assigned"}</span>
                      <span className="text-[10px]">{showAllDepartments ? "👁️" : "🔒"}</span>
                    </button>
                  </div>
                )}
                {NAV.map((item) => {
                  // Module-based Access Control Filtering
                  const isSuperAdmin =
                    userRole === "ROLE_ADMIN" ||
                    userRole === "ROLE_SUPERADMIN" ||
                    userRole === "admin" ||
                    activeStaff?.id === "ADM-001" ||
                    activeStaff?.role === "ROLE_ADMIN" ||
                    userPermissions.includes("*") ||
                    userPermissions.includes("admin")
                  const hasAccess =
                    isSuperAdmin ||
                    isModuleAccessible(item.key, userRole, userPermissions, activeStaff) ||
                    item.children?.some((c) => isModuleAccessible(c.key, userRole, userPermissions, activeStaff))

                  // Strictly restrict Doctor Workspace: ONLY doctors, authorized oversight managers, and super admin can view and access that!
                  if (item.key === "doctor_portal" && !isSuperAdminUser && !isDoctorUser && !userPermissions.includes("doctors_overview")) {
                    return null
                  }

                  if (!hasAccess && !showAllDepartments) return null

                  // Sub-items inherit the parent's access unless the role actually enumerates
                  // sub-module keys -- otherwise a role granted only "pharmacy" would collapse
                  // the whole Pharmacy tree down to its Dashboard entry.
                  const subModulesGranted = item.children?.some(
                    (c) =>
                      c.key !== item.key &&
                      (userPermissions.includes(c.key) ||
                        userPermissions.some((p) => p.startsWith(c.key + ":") || p.startsWith(c.key + "."))),
                  )

                  const filteredChildren = item.children?.filter((c) => {
                    if (isSuperAdmin) return true
                    // Strictly isolate HRMS from regular staff
                    if (item.key === "hrms") {
                      return (
                        userPermissions.includes("hrms") ||
                        userPermissions.includes(c.key) ||
                        userPermissions.some((p) => p.startsWith("hrms:") || p.startsWith(c.key + ":"))
                      )
                    }
                    return (
                      c.key === item.key ||
                      (item.key === "pharmacy" &&
                        (userPermissions.includes("pharmacy") ||
                          userPermissions.includes("pharmacy_rx") ||
                          userPermissions.includes("pharmacy_dispensing") ||
                          userPermissions.some((p) => p.startsWith("pharmacy:") || p.startsWith("pharmacy.")) ||
                          userPermissions.includes("ROLE_DOCTOR") ||
                          userPermissions.includes("ROLE_PHARMACIST") ||
                          userPermissions.includes("ROLE_PHARMACY"))) ||
                      (item.key === "reports" &&
                        (userPermissions.includes("reports") || userPermissions.some((p) => p.startsWith("reports:")))) ||
                      (item.key === "insurance" &&
                        (userPermissions.includes("insurance") || userPermissions.some((p) => p.startsWith("insurance:")))) ||
                      (item.key === "laboratory" &&
                        (userPermissions.includes("laboratory") || userPermissions.some((p) => p.startsWith("laboratory:")))) ||
                      (item.key === "radiology" &&
                        (userPermissions.includes("radiology") || userPermissions.some((p) => p.startsWith("radiology:")))) ||
                      (c.key === "pharmacy_write_off" &&
                        (userPermissions.includes("pharmacy") ||
                          userPermissions.includes("pharmacy_ledger") ||
                          userPermissions.includes("pharmacy_expiry"))) ||
                      !subModulesGranted ||
                      userPermissions.includes(c.key) ||
                      userPermissions.some((p) => p.startsWith(c.key + ":") || p.startsWith(c.key + "."))
                    )
                  })

                  const isActive =
                    module === item.key ||
                    (item.key === "laboratory" && (module === "laboratory" || module.startsWith("lab_"))) ||
                    (item.key === "radiology" && (module === "radiology" || module.startsWith("radiology_"))) ||
                    (item.key === "hrms" && (module === "hrms" || module === "employees" || module === "scheduling" || module.startsWith("hr_"))) ||
                    filteredChildren?.some((c) => c.key === module)

                  const isExpanded = expanded.includes(item.key)

                  const childBadgeTotal =
                    filteredChildren?.reduce(
                      (a, c) => a + (subBadges[c.key] || 0),
                      0,
                    ) || 0

                  const navBadge =
                    childBadgeTotal > 0
                      ? childBadgeTotal
                      : subBadges[item.key] || item.badge

                  return (
                    <div key={item.key} className="relative group">
                      <div
                        className={
                          railCollapsed
                            ? `w-10 h-10 mx-auto my-1 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150 relative ${isActive
                              ? "bg-[#1B4FD8] text-white shadow-md shadow-blue-500/25 ring-1 ring-blue-400/40"
                              : "hover:bg-white/10 text-white"
                            }`
                            : `nav-item ${isActive ? "active" : ""}`
                        }
                        onClick={() => {
                          if (!hasAccess) {
                            setInsuranceCaseId(undefined)
                            setModule(item.key)
                            closeMobileNav()
                            return
                          }
                          if (filteredChildren && filteredChildren.length > 0) {
                            if (railCollapsed) {
                              setInsuranceCaseId(undefined)
                              if (item.key === "intelligence") {
                                setModule("intelligence")
                              } else {
                                setModule(filteredChildren[0].key)
                              }
                            } else {
                              if (isActive) {
                                toggleExpand(item.key)
                              } else {
                                setInsuranceCaseId(undefined)
                                setExpanded((prev) => (prev.includes(item.key) ? prev : [...prev, item.key]))
                                if (item.key === "intelligence") {
                                  setModule("intelligence")
                                } else {
                                  setModule(filteredChildren[0].key)
                                }
                                closeMobileNav()
                              }
                            }
                          } else {
                            setInsuranceCaseId(undefined)
                            setModule(item.key)
                            closeMobileNav()
                          }
                        }}
                        title={railCollapsed ? item.label : undefined}
                      >
                        <item.Icon
                          size={railCollapsed ? 20 : 18}
                          className={`${railCollapsed
                            ? "w-5 h-5 flex-shrink-0"
                            : "w-4.5 h-4.5 mr-3 flex-shrink-0"
                            } nav-icon ${isActive ? "text-white" : !hasAccess ? "text-[#64748B] group-hover:text-slate-300" : "text-[#94A3B8] group-hover:text-white"}`}
                        />

                        {/* Collapsed Badge Dot */}
                        {railCollapsed && navBadge && !isActive && (
                          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#DC2626] border border-[#0C1524] rounded-full"></span>
                        )}

                        {/* Collapsed Hover Tooltip */}
                        {railCollapsed && !sidebarHovered && (
                          <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#0F172A] text-white text-[12px] font-semibold rounded-lg shadow-2xl border border-white/10 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 flex items-center gap-2">
                            <span>
                              {item.key === "doctor_portal"
                                ? isSuperAdminUser
                                  ? "Doctor Workspace & Hospital Oversight"
                                  : "My Doctor Workspace"
                                : resolveNavLabel(item.key, item.label)}
                            </span>
                            {!hasAccess && (
                              <span className="bg-amber-500/20 text-amber-300 text-[10px] font-semibold px-1.5 py-0.2 rounded border border-amber-500/30">
                                🔒 Restricted
                              </span>
                            )}
                            {navBadge && (
                              <span className="bg-[#DC2626] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                                {navBadge}
                              </span>
                            )}
                          </div>
                        )}

                        {!railCollapsed && (
                          <div className="flex-1 min-w-0 flex items-center justify-between sidebar-fade-in">
                            <span className={`flex-1 truncate ${!hasAccess ? "text-slate-400 group-hover:text-slate-200" : ""}`}>
                              {item.key === "doctor_portal" ? "Doctor Workspace" : resolveNavLabel(item.key, item.label)}
                            </span>
                            {!hasAccess ? (
                              <span className="text-[10px] bg-amber-500/15 text-amber-300/90 border border-amber-500/30 px-1.5 py-0.2 rounded flex items-center gap-1 font-normal ml-1 shrink-0">
                                <span>🔒</span>
                                <span>Restricted</span>
                              </span>
                            ) : (
                              <>
                                {Boolean(navBadge) && (
                                  <span
                                    className={`badge ${isActive ? "bg-white/20 text-white" : "bg-[#DC2626] text-white"} ml-1`}
                                  >
                                    {navBadge}
                                  </span>
                                )}
                                {filteredChildren &&
                                  filteredChildren.length > 0 && (
                                    <span
                                      className={`transition-transform duration-200 ml-1 ${isExpanded ? "rotate-90" : ""
                                        }`}
                                    >
                                      <Icon.ChevronRight />
                                    </span>
                                  )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {!railCollapsed &&
                        filteredChildren &&
                        filteredChildren.length > 0 &&
                        isExpanded && (
                          <div className="space-y-0.5 my-1 sidebar-fade-in">
                            {/* Ungrouped children sit directly under the parent. */}
                            {filteredChildren
                              .filter((c) => !c.group)
                              .map((child) => {
                                const isChildActive =
                                  (module === child.key || (child.key === "laboratory" && module === "lab_catalog")) &&
                                  isActive
                                const childBadge = subBadges[child.key] || 0

                                return (
                                  <div
                                    key={`${child.key}_${child.label}`}
                                    className={`nav-item sub justify-between ${isChildActive ? "active" : ""}`}
                                    onClick={() => {
                                      setInsuranceCaseId(undefined)
                                      setModule(child.key)
                                      closeMobileNav()
                                    }}
                                  >
                                    <span className="flex-1 truncate">{resolveNavLabel(child.key, child.label)}</span>
                                    {childBadge > 0 && (
                                      <span
                                        className={`badge ${isChildActive ? "bg-white/25 text-white" : "bg-[#334155] text-[#CBD5E1]"}`}
                                      >
                                        {childBadge}
                                      </span>
                                    )}
                                  </div>
                                )
                              })}

                            {/* Grouped children are laid out under a plain section
                              caption rather than a second accordion: the group was
                              a third click before you could reach a page that the
                              module itself listed in one flat sidebar. The caption
                              keeps the grouping legible without hiding anything. */}
                            {[
                              ...new Set(
                                filteredChildren
                                  .filter((c) => c.group)
                                  .map((c) => c.group as string),
                              ),
                            ].map((group) => {
                              const groupChildren = filteredChildren.filter(
                                (c) => c.group === group,
                              )

                              const isGroupActive = groupChildren.some(
                                (c) => c.key === module,
                              )

                              const isGroupExpanded =
                                expandedReportGroups.includes(group)

                              if (item.key === "reports") {
                                const GroupIcon =
                                  group === "General Reports"
                                    ? Icon.Reports
                                    : Icon.Billing

                                return (
                                  <div
                                    key={`${item.key}:${group}`}
                                    className="mt-1"
                                  >
                                    {/* Category Header: exactly like Inpatient */}
                                    <div
                                      className={`nav-item category ${isGroupActive ? "active" : ""
                                        }`}
                                      onClick={(e) => {
                                        e.stopPropagation()

                                        toggleReportGroup(group)

                                        if (
                                          !isGroupExpanded &&
                                          !isGroupActive &&
                                          groupChildren.length > 0
                                        ) {
                                          setModule(groupChildren[0].key)
                                        }
                                      }}
                                    >
                                      <GroupIcon
                                        size={16}
                                        className="w-4 h-4 nav-icon"
                                      />
                                      <span className="flex-1 truncate">
                                        {group}
                                      </span>
                                      <span
                                        className={`transition-transform duration-200 ${isGroupExpanded ? "rotate-90" : ""
                                          }`}
                                      >
                                        <Icon.ChevronRight />
                                      </span>
                                    </div>

                                    {/* Sub-items: exactly like Bed Board / Inpatient sub-items */}
                                    {isGroupExpanded && (
                                      <div className="space-y-0.5 my-1">
                                        {groupChildren.map((child) => {
                                          const isChildActive =
                                            module === child.key

                                          return (
                                            <div
                                              key={`${child.key}_${child.label}`}
                                              className={`nav-item sub justify-between ${isChildActive ? "active" : ""
                                                }`}
                                              onClick={() => {
                                                setModule(child.key)
                                                closeMobileNav()
                                              }}
                                            >
                                              <span className="flex-1 truncate">
                                                {child.label}
                                              </span>
                                              {(subBadges[child.key] || 0) >
                                                0 &&
                                                !isChildActive && (
                                                  <span className="badge bg-[#334155] text-[#CBD5E1]">
                                                    {subBadges[child.key]}
                                                  </span>
                                                )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )
                              }

                              return (
                                <div
                                  key={`${item.key}:${group}`}
                                  className="mt-2 first:mt-1"
                                >
                                  <div
                                    className="px-3 pt-1 pb-1 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors mx-1 rounded"
                                    onClick={() =>
                                      setCollapsedGroups((prev) =>
                                        prev.includes(`${item.key}:${group}`)
                                          ? prev.filter(
                                            (g) =>
                                              g !== `${item.key}:${group}`,
                                          )
                                          : [...prev, `${item.key}:${group}`],
                                      )
                                    }
                                  >
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B] select-none">
                                      {group}
                                    </span>
                                    <span
                                      className={`text-[#64748B] transition-transform ${collapsedGroups.includes(
                                        `${item.key}:${group}`,
                                      )
                                        ? "-rotate-90"
                                        : ""
                                        }`}
                                    >
                                      <Icon.ChevronDown size={14} />
                                    </span>
                                  </div>
                                  {!collapsedGroups.includes(
                                    `${item.key}:${group}`,
                                  ) &&
                                    groupChildren.map((child) => (
                                      <div
                                        key={`${child.key}_${child.label}`}
                                        className={`nav-item sub justify-between ${module === child.key && isActive
                                          ? "active"
                                          : ""
                                          }`}
                                        onClick={() => {
                                          setModule(child.key)
                                          closeMobileNav()
                                        }}
                                      >
                                        <span className="flex-1 truncate">
                                          {child.label}
                                        </span>
                                        {(subBadges[child.key] || 0) > 0 &&
                                          module !== child.key && (
                                            <span className="badge bg-[#334155] text-[#CBD5E1]">
                                              {subBadges[child.key]}
                                            </span>
                                          )}
                                      </div>
                                    ))}
                                </div>
                              )
                            })}
                          </div>
                        )}
                    </div>
                  )
                })}
              </div>

              <div className="border-t border-[#1E2D42]/80 flex-shrink-0 overflow-hidden">
                {railCollapsed ? (
                  <div className="p-2 flex justify-center">
                    <button
                      onClick={() => setCmdOpen(true)}
                      title="Command Palette (Ctrl+K)"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Icon.Cmd size={18} className="w-8 h-8 p-1.5" />
                    </button>
                  </div>
                ) : (
                  <div className="p-3 sidebar-fade-in">
                    <button
                      onClick={() => {
                        closeMobileNav()
                        setCmdOpen(true)
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-white/10 text-[#64748B] hover:text-white hover:border-white/20 transition-colors text-[11.5px] cursor-pointer whitespace-nowrap"
                    >
                      <Icon.Cmd />
                      <span>Command Palette</span>
                      <kbd className="ml-auto font-mono text-[10px]">Ctrl+K</kbd>
                    </button>
                  </div>
                )}
              </div>
            </aside>

            {/* ── Main Workspace ───────────────────────────────────────── */}
            <main
              ref={mainRef}
              className="app-main flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-auto"
            >
              {/* Breadcrumb strip with dynamic workflow history & quick back navigation */}
              <BreadcrumbsBar
                trail={breadcrumbHistory}
                currentModule={module}
                currentPatientId={clinicalPatientId || currentActivePatient?.id || undefined}
                currentPatientName={currentActivePatient?.name || resolvePatientName(clinicalPatientId) || undefined}
                onNavigateCrumb={handleNavigateCrumb}
                onGoBack={handleBreadcrumbGoBack}
              />

              {(() => {
                const isSuperAdminUser =
                  userRole === "ROLE_ADMIN" ||
                  userRole === "ROLE_SUPERADMIN" ||
                  userRole === "admin" ||
                  activeStaff?.id === "ADM-001" ||
                  activeStaff?.role === "ROLE_ADMIN" ||
                  userPermissions.includes("*") ||
                  userPermissions.includes("admin")

                const currentModuleHasAccess = isModuleAccessible(module, userRole, userPermissions, activeStaff)

                return (
                  <PageErrorBoundary resetKey={module}>
                  <Suspense fallback={<PageLoading />}>
                    {!currentModuleHasAccess ? (
                      <DepartmentAccessDenied
                        moduleKey={module}
                        activeStaff={activeStaff}
                        userRole={userRole}
                        userPermissions={userPermissions}
                        onNavigateHome={() => {
                          const firstAllowed = getFirstAllowedModule(userRole, userPermissions, activeStaff)
                          setModule(firstAllowed)
                        }}
                        onOpenAdmin={isSuperAdminUser ? () => setModule("admin") : undefined}
                        onNavigateToModule={(mod) => setModule(mod as Module)}
                      />
                    ) : (
                      <>
                      {module === "dashboard" && (
                        <Dashboard
                          navigate={navigate}
                          userRole={userRole}
                          activeStaff={activeStaff}
                        />
                      )}
              {module === "patients" && (
                <PatientSearch
                  onSelect={(p) => {
                    setClinicalPatientId(
                      p.umr || (p as any).patient_id || (p as any).id,
                    )

                    setModule("chart")
                  }}
                  onRegister={() => setModule("register")}
                  onNavigateToWorkflow={(encounterId) => {
                    setSelectedWorkflowEncounterId(encounterId)

                    setWorkflowInitialStep(2)

                    setModule("op_workflow")
                  }}
                />
              )}
              {module === "registry" && (
                <PatientRegistry
                  onRegister={() => setModule("register")}
                  onOpenChart={(umr) => {
                    setClinicalPatientId(umr)
                    setModule("chart")
                  }}
                />
              )}
              {(module === "register" || module === "op_registration") && (
                <Registration
                  onBookAppointment={(patient) => {
                    if (patient?.id) setSelectedWorkflowEncounterId(patient.id)

                    setModule("appointments")
                  }}
                  onGoToBilling={goToOpBilling}
                  onComplete={() => setModule("patients")}
                  onBack={() => setModule("patients")}
                />
              )}
              {module === "chart" && (
                <PatientChart
                  onBack={() => setModule("patients")}
                  setNotice={setNotice}
                  initialPatientId={clinicalPatientId}
                  onConsumeInitialPatient={() => setClinicalPatientId(null)}
                  onPatientSelect={(pat) => setCurrentActivePatient(pat)}
                />
              )}
              {module === "appointments" && (
                <Appointments
                  initialEncounterId={selectedWorkflowEncounterId}
                  onSelect={(patientId?: string) => {
                    if (patientId) setClinicalPatientId(patientId)
                    setModule("chart")
                  }}
                  onGoToBilling={goToOpBilling}
                />
              )}
              {module === "emergency" && <OnDutyStrip hmsModule="er" label="ER staff on duty" />}
              {module === "emergency" && (
                <ErPage
                  setNotice={stableSetNotice}
                  onNavigate={(m) => setModule(m as any)}
                  onOpenTriage={(visitId) => {
                    setSelectedTriageVisitId(visitId)

                    setModule("triage")
                  }}
                />
              )}
              {module === "inpatient" && (
                <Inpatient
                  navigate={navigate}
                  onOpenPatientClinical={openPatientClinical}
                  permissions={userPermissions}
                  initialWard={subModule}
                />
              )}
              {module === "beds" && (
                <BedManagementPage
                  setNotice={stableSetNotice}
                  onOpenPatientClinical={openPatientClinical}
                  permissions={userPermissions}
                />
              )}
              {module === "nursing" && <WardNursing />}
              {(module === "laboratory" || (module.startsWith("lab_") && module !== "lab_billing")) && (
                <LaboratoryManagementSuite
                  technician={activeStaff.name}
                  activeSubPage={module}
                  onNavigate={(m) => setModule(m as Module)}
                />
              )}
              {(module === "pharmacy" || module.startsWith("pharmacy_")) && (
                <Pharmacy
                  activeModule={module}
                  onNavigate={(m) => setModule(m as Module)}
                />
              )}
              {module === "surgery" && <OnDutyStrip hmsModule="ot" label="OT staff on duty" />}
              {module === "surgery" && <Surgery onOpenPatientRecord={openPatientClinical} />}
              {(module === "billing_op" ||
                module === "billing_ip" ||
                module === "billing_er" ||
                module === "billing_unified") && (
                  <Billing
                    key={module}
                    view={module === "billing_unified" ? "unified" : "counter"}
                    scope={
                      module === "billing_op"
                        ? "op"
                        : module === "billing_ip"
                          ? "ip"
                          : "er"
                    }
                  />
                )}
              {module === "billing_insured" && (
                <InsuredPatientBilling onOpenBill={() => setModule("billing_ip" as Module)} onOpenInsurance={(id) => openInsurance("insurance_claims", id)} />
              )}
              {module === "lab_billing" && <LabBillingQueue />}
              {module === "billing_revenue" && (
                <RevenueDashboard onNavigate={(m) => setModule(m as Module)} />
              )}
              {module === "billing" && (
                <BillingDashboard onNavigate={(m) => setModule(m as Module)} />
              )}
              {module === "payments" && <PaymentCollection />}
              {(module === "radiology" ||
                module === "radiology_templates" ||
                module.startsWith("radiology_")) && (
                <Radiology
                  initialTab={
                    module === "radiology_worklist"
                      ? "worklist"
                      : module === "radiology_operations"
                      ? "operations"
                      : module === "radiology_reporting"
                      ? "reporting"
                      : module === "radiology_reports" || module === "radiology_finalized"
                      ? "finalized"
                      : module === "radiology_template_upload" || module === "radiology_templates"
                      ? "template_upload"
                      : module === "radiology_analytics"
                      ? "analytics"
                      : "overview"
                  }
                  initialStudyId={
                    module === "radiology_reporting" || module === "radiology_operations"
                      ? radiologyStudyId
                      : null
                  }
                  departmentScope={
                    module === "radiology_ct"
                      ? "ct"
                      : module === "radiology_usg"
                      ? "usg"
                      : module === "radiology_mri"
                      ? "mri"
                      : module === "radiology_xray"
                      ? "xray"
                      : "all"
                  }
                  technician={activeStaff?.name}
                  role={userRole}
                  onNavigateView={(view, subParam) => {
                    const mapping: Record<string, Module> = {
                      overview: "radiology",
                      worklist: "radiology_worklist",
                      operations: "radiology_operations",
                      reporting: "radiology_reporting",
                      finalized: "radiology_reports",
                      template_upload: "radiology_template_upload",
                      analytics: "radiology_analytics",
                    }
                    if (subParam) {
                      setRadiologyStudyId(subParam)
                      try {
                        localStorage.setItem("hospai_active_radiology_study_id", subParam)
                      } catch {}
                    } else if (view === "worklist" || view === "reporting" || view === "overview") {
                      setRadiologyStudyId(null)
                      try {
                        localStorage.removeItem("hospai_active_radiology_study_id")
                      } catch {}
                    }
                    if (mapping[view]) {
                      setModule(mapping[view])
                    }
                  }}
                  onNavigateTab={(tab: "worklist" | "reports" | "templates") => {
                    if (tab === "worklist") setModule("radiology_worklist")
                    else if (tab === "reports") setModule("radiology_reports")
                    else if (tab === "templates") setModule("radiology_template_upload")
                  }}
                />
              )}
              {(module === "icu" || module.startsWith("icu_")) && <OnDutyStrip hmsModule="icu" label="ICU staff on duty" />}
              {(module === "icu" || module.startsWith("icu_")) && (
                <ICU
                  unit={
                    module === "icu"
                      ? "All"
                      : module.slice("icu_".length).toUpperCase()
                  }
                  onOpenBedManagement={() => setModule("beds")}
                />
              )}
              {module === "analytics" && <Analytics />}
              {module === "discharge" && (
                <Discharge
                  setNotice={stableSetNotice}
                  onComplete={() => setModule("inpatient")}
                />
              )}
              {module === "triage" && (
                <Triage
                  initialVisitId={selectedTriageVisitId}
                  setNotice={stableSetNotice}
                  onNavigate={(m) => setModule(m as any)}
                />
              )}

              {/* Insurance Command Dashboard — new Page 1 */}
              {module === "insurance_overview" && (
                <InsuranceCommandDashboard
                  onNavigate={(page, caseId) => {
                    if (page === "board") setModule("insurance_board" as any)
                    else if (page === "preauth") setModule("insurance_preauth" as any)
                    else if (page === "intake") setModule("insurance_eligibility" as any)
                    else if (page === "claims") {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                    else if (page === "emails") setModule("insurance_emails" as any)
                    else if (page === "settlements") setModule("insurance_settlement" as any)
                    else if (page === "masters") { setSetupTab("main"); setModule("insurance_setup" as any) }
                    else if (page === "case" && caseId) {
                      setInsuranceCaseId(caseId)
                      setModule("insurance_case" as any)
                    }
                    else {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                  }}
                />
              )}
              {/* Legacy overview key */}
              {module === "insurance_desk" && (
                <InsuranceDashboardView
                  onOpenCase={(id) => openInsurance("insurance", id)}
                  onOpenIntake={() => setModule("insurance_eligibility" as any)}
                />
              )}
              {/* Page 2: Insurance Command Dashboard (reused for board key) */}
              {(module === "insurance_board" as any) && (
                <InsuranceCommandDashboard
                  onNavigate={(page, caseId) => {
                    if (page === "preauth") setModule("insurance_preauth" as any)
                    else if (page === "intake") setModule("insurance_eligibility" as any)
                    else if (page === "claims") {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_claims" as any)
                    }
                    else if (page === "emails") setModule("insurance_emails" as any)
                    else if (page === "settlements") setModule("insurance_settlement" as any)
                    else if (page === "masters") { setSetupTab("main"); setModule("insurance_setup" as any) }
                    else if (page === "case" && caseId) {
                      setInsuranceCaseId(caseId)
                      setModule("insurance_case" as any)
                    }
                    else {
                      if (caseId) setInsuranceCaseId(caseId)
                      setModule("insurance_overview" as any)
                    }
                  }}
                />
              )}
              {/* Page 3: Intake */}
              {module === "insurance_patient_policies" && <PatientPoliciesPage />}
              {module === "insurance_eligibility" && (
                <InsuranceIntakeView
                  onBack={() => setModule("insurance_overview" as any)}
                  onComplete={(id) => {
                    setInsuranceCaseId(id)
                    setModule("insurance_preauth" as any)
                  }}
                />
              )}
              {/* Page 4/5: Pre-Auth */}
              {module === "insurance_preauth" && (
                <PreAuthRequestView
                  caseId={insuranceCaseId}
                  onBack={() => setModule("insurance_overview" as any)}
                  onSubmitted={(id) => {
                    setInsuranceCaseId(id)
                    setModule("insurance_case" as any)
                  }}
                />
              )}
              {/* Page 6: Full Case Detail Hub */}
              {module === "insurance_case" && (() => {
                const allCasesForDetail = InsuranceEngineService.getClaims()
                const detailCase = allCasesForDetail.find((c) => c.id === insuranceCaseId)
                return detailCase ? (
                  <InsuranceCaseDetailView
                    c={detailCase}
                    onBack={() => setModule("insurance_board")}
                    onOpenBilling={() => setModule("billing_ip")}
                  />
                ) : (
                  <div className="p-6 text-slate-500 text-sm">Case not found. <button className="text-blue-600 underline" onClick={() => setModule("insurance_board")}>Back to board</button></div>
                )
              })()}
              {/* Page 8: Discharge & Final Approval */}
              {module === "insurance_discharge" && (() => {
                const allCasesForDischarge = InsuranceEngineService.getClaims()
                const dischargeCase = allCasesForDischarge.find((c) => c.id === insuranceCaseId)
                return dischargeCase ? (
                  <DischargeFinalizationView
                    c={dischargeCase}
                    onBack={() => setModule("insurance_board")}
                  />
                ) : null
              })()}
              {/* Pages: Legacy claim / settlement / masters */}
              {(module === "insurance" || module === "insurance_claims" || module === "insurance_queries") && (
                <InsuranceClaims onNavigate={openInsurance} initialCaseId={insuranceCaseId} initialView="needs" />
              )}
              {module === "insurance_emails" && (
                <InsuranceEmailHubPage
                  onNavigateToClaim={(claimId) => openInsurance("insurance_claims", claimId)}
                  initialClaimId={insuranceCaseId}
                />
              )}
              {module === "insurance_gaps" && <InsurancePaymentGaps onNavigate={openInsurance} />}
              {(module === "insurance_settlement" || module === "insurance_reconciliation") && (
                <InsuranceSettlementPage onNavigate={openInsurance} initialCaseId={insuranceCaseId} />
              )}
              {module === "insurance_setup" && (
                <InsuranceSetup
                  initialTab={setupTab}
                  mastersSection={mastersSection}
                  initialCaseId={insuranceCaseId}
                  onNavigate={openInsurance}
                />
              )}
              {module === "insurance_packages" && <EnhancedAuditRulesPage initialTab="packages" />}
              {module === "insurance_pricing" && <EnhancedAuditRulesPage initialTab="packages" />}
              {module === "insurance_docrules" && <EnhancedAuditRulesPage initialTab="audit" />}
              {(module === "insurance_reports" as any) && <EnhancedAuditRulesPage initialTab="reports" />}

              {(module === "reports" || module === "reports_overview") && (
                <GeneralReportsOverviewPage
                  onNavigate={(m) => setModule(m as any)}
                />
              )}
              {module === "reports_op" && (
                <OpReportsPage
                  userRole={userRole}
                  onNavigate={(m) => setModule(m as any)}
                />
              )}
              {module === "revenue_reports" && <RevenueReports />}
              {(module === "reports_patients" ||
                module === "reports_er" ||
                module === "reports_inpatient" ||
                module === "reports_appointments" ||
                module === "reports_doctors" ||
                module === "reports_pharmacy" ||
                module === "reports_laboratory" ||
                module === "reports_radiology" ||
                module === "reports_beds" ||
                module === "reports_admissions" ||
                module === "reports_discharges" ||
                module === "reports_staff" ||
                module === "reports_pharmacy_damaged" ||
                module === "reports_supplier_returns") && (
                  <GenericReportPage
                    key={module}
                    reportType={module as ReportType}
                    onNavigate={(m) => setModule(m as any)}
                  />
                )}
              {module === "op_nurse" && (
                <NurseStation
                  nurseName={activeStaff?.name || "OP Nurse"}
                  onOpenQueue={
                    userPermissions.includes("queue")
                      ? () => setModule("queue")
                      : undefined
                  }
                />
              )}
              {(module === "admin" || module === "admin_doctors") && (
                <Administration
                  initialTab={module === "admin_doctors" ? "doctors" : "overview"}
                  initialDoctorSubTab={module === "admin_doctors" ? "workspace" : undefined}
                  onNavigateToDoctorPortal={() => setModule("doctor_portal")}
                />
              )}

              {/* Outpatient Department Modular Suite */}
              {module === "op_management" && <OnDutyStrip hmsModule="op" category="doctor" label="Doctors on duty in OP" />}
              {module === "op_management" && (
                <OPManagement
                  staffName={activeStaff?.name || "OP desk"}
                  onNavigateToNurseStation={
                    userPermissions.includes("op_nurse")
                      ? () => setModule("op_nurse")
                      : undefined
                  }
                  onNavigateToQueue={() => setModule("queue")}
                  onNavigateToOPDProcedures={() => setModule("opd_procedures")}
                  onNavigateToOPWorkflow={(encId, step) => {
                    if (encId) setSelectedWorkflowEncounterId(encId)

                    if (step !== undefined) setWorkflowInitialStep(step)

                    setModule("op_workflow")
                  }}
                  onNavigateToDoctorWorkflow={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                  onNavigateToOPRegistration={() => {
                    setModule("op_registration")
                  }}
                />
              )}
              {module === "queue" && (
                <QueueManagement
                  onNavigateToNurseStation={
                    userPermissions.includes("op_nurse")
                      ? () => setModule("op_nurse")
                      : undefined
                  }
                  onNavigateToOPWorkflow={(encId, step) => {
                    if (encId) setSelectedWorkflowEncounterId(encId)

                    if (step !== undefined) setWorkflowInitialStep(step)

                    setModule("op_workflow")
                  }}
                  onNavigateToDoctorWorkflow={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                  onNavigateToOPRegistration={() => {
                    setModule("op_registration")
                  }}
                />
              )}
              {module === "opd_procedures" && (
                <OPDProcedures
                  onNavigateToOPManagement={() => setModule("op_management")}
                />
              )}
              {module === "op_workflow" && (
                <OPWorkflow
                  initialStep={workflowInitialStep}
                  initialEncounterId={selectedWorkflowEncounterId}
                  onComplete={() => setModule("op_management")}
                  onOpenDoctorPortal={
                    !canOpenConsultation
                      ? undefined
                      : (encId) => {
                        if (encId) setSelectedWorkflowEncounterId(encId)

                        setModule("doctor_portal")
                      }
                  }
                />
              )}
              {module === "patient_exp" && <PatientExperience />}
              {module === "patient_messages" && <PatientMessages />}
              {(module === "doctor_workflow" || module === "doctor_portal" || module === "doctors_overview") &&
                (isDoctorUser && !isSuperAdminUser && !userPermissions.includes("doctors_overview") && activeDoctor ? (
                  // Logged-in doctor only views and accesses their OWN individual workspace:
                  // Strictly scoped to this doctor with no ability to switch to other doctors or view other queues.
                  <DoctorPortal
                    key={activeDoctor.id}
                    doctor={activeDoctor}
                    isSuperAdmin={false}
                    initialView={subModule === "ip" ? "ip" : undefined}
                    onOpenErVisit={(visitId) => {
                      setSelectedTriageVisitId(visitId)
                      setModule("triage")
                    }}
                  />
                ) : (isSuperAdminUser || userPermissions.includes("doctors_overview") || userPermissions.includes("admin")) ? (
                  // Admin / authorized oversight manager views the complete hospital clinical overview (the screen shown in user's screenshot).
                  // Clicking [Open Doctor Workspace] on any doctor card opens that specific doctor's consultation workspace.
                  adminInspectingDoctor ? (
                    <DoctorPortal
                      key={adminInspectingDoctor.id}
                      doctor={adminInspectingDoctor}
                      isSuperAdmin={true}
                      onBackToOverview={() => setAdminInspectingDoctor(null)}
                      onOpenErVisit={(visitId) => {
                        setSelectedTriageVisitId(visitId)
                        setModule("triage")
                      }}
                    />
                  ) : (
                    <DoctorsOverview
                      onOpenWorkspace={(doc) => {
                        setAdminInspectingDoctor(doc)
                      }}
                      onOpenAdminMaster={() => {
                        setModule("admin_doctors")
                      }}
                    />
                  )
                ) : activeDoctor ? (
                  <DoctorPortal
                    key={activeDoctor.id}
                    doctor={activeDoctor}
                    isSuperAdmin={false}
                    initialView={subModule === "ip" ? "ip" : undefined}
                    onOpenErVisit={(visitId) => {
                      setSelectedTriageVisitId(visitId)
                      setModule("triage")
                    }}
                  />
                ) : (
                  <DepartmentAccessDenied
                    department="Doctor Workspace"
                    requiredRole="Authenticated Doctor or Clinical Administrator"
                  />
                ))}
              {module === "admissions" && (
                <Admissions setNotice={setNotice} navigate={navigate} />
              )}
              {module === "readmission" && (
                <Readmission setNotice={setNotice} />
              )}
              {Boolean(HR_MODULE_SECTION_MAP[module]) && (
                <HrWorkspace
                  section={HR_MODULE_SECTION_MAP[module]}
                  onNavigateSection={(sec) => {
                    const targetModule = Object.entries(HR_MODULE_SECTION_MAP).find(
                      ([k, v]) => v === sec && k !== "hr_dashboard" && k !== "hr_shifts"
                    )?.[0]
                    if (targetModule) setModule(targetModule as Module)
                  }}
                  legacy={<HRMS onNavigate={(m) => setModule(m as any)} />}
                />
              )}
              {module === "ocr" && <SmartOCR setNotice={setNotice} />}
              {ocrMounted && (
                <div
                  className={module === "dpi_ocr" ? "h-full w-full" : "hidden"}
                >
                  <DpiOcrPortal />
                </div>
              )}
              {module === "symptom_ai" && <SymptomAI setNotice={setNotice} />}
              {module === "clinical_rag" && <ClinicalRAG />}
              {module === "clinical_summaries" && <ClinicalSummaries />}
              {module === "bulk_ai" && <BulkAI setNotice={setNotice} />}
              {module === "nl_filtering" && (
                <NLFiltering setNotice={setNotice} />
              )}
              {module === "intelligence" && (
                <IntelligenceHub navigate={navigate} />
              )}
                      </>
                    )}
                  </Suspense>
                  </PageErrorBoundary>
                )
              })()}
            </main>
          </div>

          {/* ── Overlays ─────────────────────────────────────────────────── */}
          <OrderDrawer open={orderOpen} onClose={() => setOrderOpen(false)} />
          <CommandPalette
            open={cmdOpen}
            onClose={() => setCmdOpen(false)}
            onNavigate={(key) => {
              if (key === "order") {
                setModule("chart")
                setOrderOpen(true)
              } else if (key === "register") {
                setModule("register")
              } else {
                if (key === "radiology_reporting" || key === "radiology_worklist" || key === "radiology" || key === "radiology_operations" || key === "radiology_reports") {
                  setRadiologyStudyId(null)
                  try {
                    localStorage.removeItem("hospai_active_radiology_study_id")
                  } catch {}
                }
                setModule(key as Module)
              }
            }}
            onSelectPatient={(patientId, encounterId) => {
              setClinicalPatientId(patientId)

              if (encounterId) {
                setSelectedWorkflowEncounterId(encounterId)
              }

              setModule("chart")
            }}
          />

          {globalApplyLeaveOpen && (
            <ApplyLeaveModal
              isOpen={globalApplyLeaveOpen}
              onClose={() => setGlobalApplyLeaveOpen(false)}
              loggedInStaffId={activeStaff.id}
              loggedInStaffName={activeStaff.name}
              isSelfService={userRole !== "ROLE_ADMIN" && userRole !== "ROLE_SUPERADMIN" && userRole !== "ROLE_HR"}
            />
          )}

          {showAdminCredentialsModal && (
            <AdminCredentialsModal
              isOpen={showAdminCredentialsModal}
              onClose={() => setShowAdminCredentialsModal(false)}
              onSaved={(updated) => {
                setActiveStaff((prev) => ({
                  ...prev,
                  name: updated.name,
                }))
                setNotice({
                  type: "success",
                  message: `System Administrator credentials updated successfully (@${updated.username}).`,
                })
                setTimeout(() => setNotice(null), 5000)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
