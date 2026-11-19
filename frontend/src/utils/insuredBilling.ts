import type { ClaimRecord } from "../services/billingDb"
import type { ComprehensiveClaimRecord } from "../types/insurance"
import { coverLimit, hasPolicyTerms, policyShare, type CoverTerms } from "./coverLimit"

/**
 * What the billing counter needs to know about an insured patient: what the insurer has approved, how the bill is
 * split between insurer and patient, and what the patient owes now. Pure (no storage, no UI) so it can be tested.
 */

export type ApprovalKind = "claim" | "preauth" | "waiting" | "none" | "rejected"

export interface Approval {
  kind: ApprovalKind
  label: string
  /** The approved amount, 0 when there is no approval. */
  amount: number
  code?: string
  detail: string
}

const CLAIM_DECIDED = new Set(["APPROVED", "PARTIALLY_APPROVED", "SETTLEMENT_PENDING", "PAYMENT_RECEIVED", "RECONCILED", "CLOSED"])
const PREAUTH_WAITING = new Set(["PREAUTH_SUBMITTED", "PREAUTH_UNDER_REVIEW", "PREAUTH_QUERY", "CLAIM_SUBMITTED", "CLAIM_QUERY_RAISED"])

export function approvalOf(c: ComprehensiveClaimRecord): Approval {
  if ((c.status === "REJECTED" || c.status === "PREAUTH_REJECTED") && !(c.approvedPreAuthAmount > 0))
    return { kind: "rejected", label: c.status === "REJECTED" ? "Claim rejected" : "Pre-auth rejected", amount: 0, detail: "The insurer did not approve. The patient may have to pay; check with the insurance desk." }
  if (CLAIM_DECIDED.has(c.status) && (c.approvedClaimAmount ?? 0) > 0)
    return { kind: "claim", label: c.status === "PARTIALLY_APPROVED" ? "Claim partly approved" : "Claim approved", amount: c.approvedClaimAmount!, code: c.preAuth?.approvalCode, detail: `Final claim decision. Claimed ₹${Math.round(c.finalClaimAmount || 0).toLocaleString("en-IN")}.` }
  if (c.approvedPreAuthAmount > 0)
    return { kind: "preauth", label: "Pre-auth approved", amount: c.approvedPreAuthAmount, code: c.preAuth?.approvalCode, detail: "Approved before treatment. The final claim is decided after discharge." }
  if (PREAUTH_WAITING.has(c.status)) return { kind: "waiting", label: "Awaiting insurer", amount: 0, detail: "Submitted to the insurer; no decision yet." }
  return { kind: "none", label: "No approval yet", amount: 0, detail: "Eligibility or pre-authorisation is still being completed." }
}

export interface BillView {
  total: number
  insurerShare: number
  patientShare: number
  paid: number
  /** What the patient owes now (the bill's own balance). */
  due: number
  /** Still admitted: only a running bill exists, payment is collected at discharge. */
  running: boolean
  /** The bill has been split between insurer and patient (handed to insurance at the counter). */
  billed: boolean
  canCollect: boolean
  why: string
  /** Before the bill is split, what the policy says the patient will owe (null when the policy gives nothing to go on). */
  expectedPatientShare: number | null
  /** The part of the bill above the insurer's limit. */
  beyondCover: number
  limitBasis: string
  limit: number | null
}

export function billView(c: ComprehensiveClaimRecord, b: ClaimRecord): BillView {
  const total = Math.max(0, b.totalAmount || 0)
  const paid = Math.max(0, b.amountPaid || 0)
  const due = Math.max(0, (b.patientPortion || 0) - paid)
  const running = !!b.runningAdmissionId
  const billed = !!b.tpa?.billedAt
  const terms: CoverTerms = { approved: c.approvedPreAuthAmount, balance: c.policy.balanceAvailable, sumInsured: c.policy.sumInsured, copayPct: c.policy.copayPercentage }
  const lim = coverLimit(terms)
  const expected = !billed && hasPolicyTerms(terms) && total > 0 ? total - policyShare(total, total, terms) : null
  const insurerShare = Math.max(0, b.insurancePortion || 0)
  const beyondCover = lim.cap !== null ? Math.max(0, (billed ? insurerShare : total) - lim.cap) : 0
  let why = ""
  if (b.status === "Voided") why = "This bill was voided."
  else if (running) why = "The patient is still admitted. The final bill is raised at discharge and the patient's share is collected then."
  else if (!billed) why = "The final bill has not been handed to insurance yet, so the patient's share is not fixed. Use Bill to insurance at the IP counter first."
  else if (due <= 0) why = paid > 0 ? "The patient has paid their share in full." : "The patient owes nothing on this bill."
  return { total, insurerShare, patientShare: Math.max(0, b.patientPortion || 0), paid, due, running, billed, canCollect: !running && billed && due > 0 && b.status !== "Voided", why, expectedPatientShare: expected, beyondCover, limitBasis: lim.basis, limit: lim.cap }
}

export type BillingTab = "collect" | "waiting" | "admitted" | "cleared" | "all"

/** Which tab a row belongs to. A row can be in "all" and exactly one other. */
export function tabOf(a: Approval, v: BillView): Exclude<BillingTab, "all"> {
  if (v.running) return "admitted"
  if (v.canCollect) return "collect"
  if (a.kind === "waiting" || a.kind === "none" || !v.billed) return "waiting"
  return "cleared"
}
