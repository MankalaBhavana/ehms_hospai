/**
 * SmartRx client: medication safety checks for the prescription sheet.
 *
 * Rules this file keeps:
 *  - It never invents a result. If the server cannot be reached the outcome is "unavailable", which the screen shows as
 *    "checks did not run": never as "no alerts".
 *  - It never throws into the screen: every failure becomes an outcome.
 *  - Alerts never block signing on their own; a critical alert needs the prescriber's acknowledgement with a reason, and
 *    that acknowledgement is written to the server audit trail.
 */
import { apiFetch } from "../lib/api"

export type Severity = "critical" | "warning" | "info"

export interface SmartRxAlert {
  id: string
  check: string
  drug_name: string
  severity: Severity
  title: string
  message: string
  recommendation?: string
  source?: string
  is_blocking: boolean
  knowledge_status?: string
  provenance?: "unsourced" | "cited" | "verified" | "hospital_policy" | null
  source_ref?: string | null
  source_jurisdiction?: string | null
}

export interface SmartRxResult {
  status: string
  check_status?: "complete" | "partial" | "not_run"
  partial_reasons?: string[]
  alerts: SmartRxAlert[]
  evaluated_count?: number
  rule_set_version?: string
  engine_version?: string
  has_critical?: boolean
  has_warning?: boolean
  items?: { index: number; input: string; matched: boolean; ingredients: string[] }[]
  coverage?: { rules_not_evaluated?: string[] }
  context?: Record<string, unknown>
}

export type SmartRxOutcome =
  | { kind: "ok"; result: SmartRxResult }
  | { kind: "unavailable"; message: string }

export interface SmartRxPatient {
  patientId: string
  encounterId?: string
  age?: number
  sex?: string
}

export interface MedicationLine {
  name: string
  strength?: string
  dosage?: string
  frequency?: string
  route?: string
  duration?: string
}

export const MAX_ITEMS = 60

/** The lines the server should check: named medicines only, trimmed, capped. */
export function medicationItems(meds: MedicationLine[]) {
  return meds
    .filter((m) => (m.name || "").trim())
    .slice(0, MAX_ITEMS)
    .map((m) => {
      const item: Record<string, string> = { medicine: m.name.trim().slice(0, 300) }
      for (const key of ["strength", "dosage", "frequency", "route", "duration"] as const) {
        const value = (m[key] || "").trim()
        if (value) item[key] = value.slice(0, 80)
      }
      return item
    })
}

export function buildRequest(patient: SmartRxPatient, meds: MedicationLine[]) {
  const request: Record<string, unknown> = { patient_id: patient.patientId, items: medicationItems(meds) }
  if (patient.encounterId) request.encounter_id = patient.encounterId
  if (Number.isFinite(patient.age)) request.patient_age = String(patient.age)
  if (patient.sex) request.patient_sex = patient.sex
  return request
}

/** Identifies one exact question, so an answer is only ever shown for the prescription it was computed for. */
export function requestSignature(patient: SmartRxPatient, meds: MedicationLine[]): string {
  return JSON.stringify(buildRequest(patient, meds))
}

function isResult(value: unknown): value is SmartRxResult {
  return !!value && typeof value === "object" && Array.isArray((value as SmartRxResult).alerts) && (value as SmartRxResult).status === "ok"
}

export async function evaluatePrescription(
  patient: SmartRxPatient,
  meds: MedicationLine[],
  signal?: AbortSignal,
): Promise<SmartRxOutcome> {
  try {
    const result = await apiFetch<unknown>("/api/smartrx/evaluate", {
      method: "POST",
      body: JSON.stringify(buildRequest(patient, meds)),
      signal,
      timeoutMs: 15000,
    })
    if (!isResult(result)) return { kind: "unavailable", message: "The safety service returned an unexpected answer." }
    return { kind: "ok", result }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "The safety service could not be reached."
    return { kind: "unavailable", message }
  }
}

// ── acknowledging critical alerts ─────────────────────────────────────────────────────────────

export const OVERRIDE_REASONS = [
  { code: "benefit_outweighs_risk", label: "Benefit outweighs the risk for this patient" },
  { code: "already_tolerating", label: "Patient already takes it and tolerates it" },
  { code: "no_alternative", label: "No suitable alternative available" },
  { code: "dose_adjusted", label: "Dose or frequency adjusted for this patient" },
  { code: "monitoring_planned", label: "Monitoring arranged" },
  { code: "other", label: "Other (describe)" },
] as const

export interface Acknowledgement {
  reasonCode: string
  reasonText?: string
  at: string
  by?: string
}
export type Acknowledgements = Record<string, Acknowledgement>

export function reasonIsValid(code: string, text: string): boolean {
  if (!OVERRIDE_REASONS.some((r) => r.code === code)) return false
  return code !== "other" || text.trim().length >= 5
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }

export function sortAlerts(alerts: SmartRxAlert[]): SmartRxAlert[] {
  return [...alerts].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
}

/** Critical alerts the prescriber has not yet acknowledged: what must be cleared before the prescription is sent. */
export function unacknowledgedCriticals(outcome: SmartRxOutcome | undefined, acks: Acknowledgements): SmartRxAlert[] {
  if (!outcome || outcome.kind !== "ok") return []
  return outcome.result.alerts.filter((a) => a.severity === "critical" && !acks[a.id])
}

export async function recordOverride(
  patient: SmartRxPatient,
  alert: SmartRxAlert,
  ack: Pick<Acknowledgement, "reasonCode" | "reasonText">,
  ruleSetVersion?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch("/api/smartrx/overrides", {
      method: "POST",
      body: JSON.stringify({
        patient_id: patient.patientId,
        encounter_id: patient.encounterId,
        alert_id: alert.id,
        check: alert.check,
        severity: alert.severity,
        drug_name: alert.drug_name,
        rule_set_version: ruleSetVersion,
        reason_code: ack.reasonCode,
        reason_text: ack.reasonText?.trim() || undefined,
      }),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : "The acknowledgement could not be saved." }
  }
}

/** Acknowledgements already given for this visit, so a page reload does not make the doctor repeat them. */
export async function loadOverrides(patient: SmartRxPatient): Promise<Acknowledgements> {
  try {
    const query = new URLSearchParams({ patient_id: patient.patientId })
    if (patient.encounterId) query.set("encounter_id", patient.encounterId)
    const data = await apiFetch<{ items?: { alert_id: string; reason_code: string; reason_text?: string; created_at: string; by?: string }[] }>(
      `/api/smartrx/overrides?${query.toString()}`,
    )
    const acks: Acknowledgements = {}
    for (const row of [...(data.items || [])].reverse()) {
      acks[row.alert_id] = { reasonCode: row.reason_code, reasonText: row.reason_text, at: row.created_at, by: row.by }
    }
    return acks
  } catch {
    return {}
  }
}

export function describeProvenance(alert: SmartRxAlert): { label: string; tone: "good" | "caution" | "muted" } {
  if (alert.knowledge_status === "draft") return { label: "Draft rule, under review", tone: "muted" }
  if (alert.provenance === "verified") return { label: "Guideline-verified", tone: "good" }
  if (alert.provenance === "hospital_policy") return { label: "Hospital policy", tone: "good" }
  if (alert.provenance === "cited") return { label: "Cited, not yet verified", tone: "caution" }
  return { label: "Source not verified", tone: "muted" }
}

/** Plain-language form of the engine's partial_reasons codes (e.g. "renal_function_unknown:Metformin"). */
export function explainPartialReason(code: string): string {
  const [kind, detail = ""] = code.split(/:(.*)/s)
  switch (kind) {
    case "unrecognised_drug": return `${detail} was not found in the drug catalogue`
    case "no_ingredient_mapping": return `${detail} has no active-ingredient data`
    case "ambiguous_drug": return `${detail} matches more than one product`
    case "spelling_corrected": return `${detail} was read as a similar name: please confirm`
    case "renal_function_unknown": return `no recent kidney function on record for ${detail}`
    case "allergy_status_not_recorded": return "allergy status is not recorded"
    case "allergy_not_interpreted": return `allergy "${detail}" could not be matched to a drug`
    default:
      if (kind.startsWith("egfr_not_computed")) return `kidney function could not be calculated (${detail || kind.split(":").pop()})`
      return code.replace(/_/g, " ")
  }
}
