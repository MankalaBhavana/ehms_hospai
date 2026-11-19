import { SHORTFALL_KINDS, type ClaimSettlementRecord, type ShortfallEntry } from "../types/insurance"

/**
 * The money trail of one insurance claim, in one place (used by the engine, the Settlement screen, the Payment Gaps
 * register and the tests).
 *
 *   bill claimed  ->  insurer approved (the cut is itemised at approval)  ->  insurer paid (bank credits)  ->  gap
 *
 * The gap (approved - received) is what this is about: ₹5,00,000 approved but ₹4,00,000 received leaves ₹1,00,000
 * that must be explained as TDS / accepted disallowance / write-off / charged to patient (closed), or chased
 * (insurer to pay later / disputed). Nothing is left "unexplained" when a claim is reconciled.
 */
export type SettlementState = "none" | "awaiting" | "partly_paid" | "settled" | "short_unexplained" | "short_followup" | "short_explained" | "excess"

export interface Position {
  claimed: number
  approved: number
  /** Claimed but not approved (itemised as deductions when the decision was recorded). */
  insurerCut: number
  received: number
  /** approved - received; negative means more arrived than was approved. */
  gap: number
  /** Part of the gap explained for good (TDS, accepted cut, write-off, charged to patient). */
  closed: number
  /** Part of the gap still owed and being chased. */
  followUp: number
  /** Part of the gap nobody has explained yet. */
  unexplained: number
  excess: number
  /** Still to be received from the insurer: follow-up + unexplained. */
  outstanding: number
  /** Everything not yet in the bank and not written off: approved - received - settled-for-good. */
  toCollect: number
  state: SettlementState
}

type Src = {
  finalClaimAmount?: number
  approvedClaimAmount?: number
  settlement?: Pick<ClaimSettlementRecord, "expectedAmount" | "receivedAmount" | "shortfalls"> | undefined
}

const isClosed = (e: ShortfallEntry) => SHORTFALL_KINDS.find((k) => k.kind === e.kind)?.closed ?? false

export function settlementPosition(c: Src): Position {
  const s = c.settlement
  const claimed = Math.max(0, c.finalClaimAmount || 0)
  const approved = Math.max(0, s?.expectedAmount ?? c.approvedClaimAmount ?? 0)
  const received = Math.max(0, s?.receivedAmount ?? 0)
  const entries = s?.shortfalls ?? []
  const gap = approved - received
  const owed = Math.max(0, gap)
  const closed = Math.min(
    entries.filter(isClosed).reduce((a, e) => a + e.amount, 0),
    owed,
  )
  const followUp = Math.min(
    entries.filter((e) => !isClosed(e)).reduce((a, e) => a + e.amount, 0),
    owed - closed,
  )
  // Nothing paid yet is "awaiting payment", not a gap that needs explaining.
  const unexplained = received > 0 ? owed - closed - followUp : 0
  const excess = Math.max(0, -gap)
  let state: SettlementState
  if (!s || approved <= 0) state = "none"
  else if (received <= 0) state = "awaiting"
  else if (excess > 0) state = "excess"
  else if (gap === 0) state = "settled"
  else if (unexplained > 0) state = "short_unexplained"
  else if (followUp > 0) state = "short_followup"
  else state = "short_explained"
  return { claimed, approved, insurerCut: approved > 0 ? Math.max(0, claimed - approved) : 0, received, gap, closed, followUp, unexplained, excess, outstanding: followUp + unexplained, toCollect: Math.max(0, gap - closed), state }
}

export const STATE_LABEL: Record<SettlementState, string> = {
  none: "Not approved yet",
  awaiting: "Awaiting payment",
  partly_paid: "Partly paid",
  settled: "Paid in full",
  short_unexplained: "Short — needs explanation",
  short_followup: "Short — being chased",
  short_explained: "Short — explained",
  excess: "More than approved",
}

/** Tone used for the state tag. */
export const STATE_TONE: Record<SettlementState, "slate" | "amber" | "emerald" | "rose" | "blue" | "violet"> = {
  none: "slate",
  awaiting: "blue",
  partly_paid: "amber",
  settled: "emerald",
  short_unexplained: "rose",
  short_followup: "amber",
  short_explained: "violet",
  excess: "amber",
}

/** Whole days since an ISO date (0 when missing). */
export const ageDays = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0)
