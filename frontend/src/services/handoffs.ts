/**
 * Department hand-offs: every place a patient is sent on to another department calls `handOff`, and that
 * department's bell lights up with the patient, what was sent and a one-click way to open it. The department
 * clears the notice with "Done" once the patient has been processed.
 *
 * Built on the server-shared transfer notices (transferNotices.ts), so the receiving desk -- a different
 * computer -- sees it. Never throws and never blocks the action that triggered it.
 */
import { TransferNotices } from "./transferNotices"

/** The screen each department opens, and its display name. */
export const DEPARTMENTS = {
  doctor: { module: "doctor_portal", name: "Doctor Workspace" },
  queue: { module: "queue", name: "OP Queue" },
  opBilling: { module: "billing_op", name: "OP Billing" },
  labBilling: { module: "lab_billing", name: "Lab & Radiology Billing" },
  laboratory: { module: "laboratory", name: "Laboratory" },
  radiology: { module: "radiology", name: "Radiology" },
  pharmacy: { module: "pharmacy", name: "Pharmacy" },
  inpatient: { module: "inpatient", name: "Inpatient / Wards" },
  icu: { module: "icu", name: "ICU" },
  emergency: { module: "emergency", name: "Emergency" },
  reception: { module: "patients", name: "Reception" },
  discharge: { module: "discharge", name: "Discharge" },
} as const

export type DeptKey = keyof typeof DEPARTMENTS

export interface HandOff {
  to: DeptKey
  /** Department or desk the patient is coming from (free text, e.g. "OP · Cardiology"). */
  from: string
  patientName: string
  /** UMR / patient id. */
  patientId?: string | null
  /** Short label: "Lab order", "Prescription", "Admission advised" ... */
  kind: string
  /** What the receiving desk has to do or has been sent. */
  note?: string
  /** The piece of work: stops the same order being announced twice. */
  ref?: string
  urgent?: boolean
  /** Only this person sees the notice (a doctor's id, staff id or name); everyone else in the department does not. */
  audience?: string
}

export function handOff(h: HandOff): void {
  try {
    const g = globalThis as { __HOSPAI_TEST__?: boolean; __HANDOFFS__?: HandOff[] }
    if (g.__HOSPAI_TEST__) {
      // test runs have no server: record what would have been sent
      ;(g.__HANDOFFS__ = g.__HANDOFFS__ || []).push(h)
      return
    }
    const d = DEPARTMENTS[h.to]
    if (!h.patientName?.trim()) return
    void TransferNotices.add({
      kind: h.kind,
      patientId: h.patientId ?? null,
      patientName: h.patientName,
      from: h.from,
      to: d.name,
      toModule: d.module,
      note: h.note ?? null,
      ref: h.ref ?? null,
      priority: h.urgent ? "Urgent" : "Normal",
      audience: h.audience ?? null,
    })
  } catch {
    /* a notification must never break the action that raised it */
  }
}
