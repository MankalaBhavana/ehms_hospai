/**
 * How much of a bill the patient's policy can actually be asked to pay, so the insurer's share at the billing counter
 * starts from the policy and not from a fixed preset. Without this, a ₹6,00,000 bill on a ₹5,00,000 approval goes to the
 * insurer as ₹6,00,000, the insurer pays ₹5,00,000 and ₹1,00,000 is written off by default.
 */
export interface CoverTerms {
  /** Pre-authorisation amount approved by the insurer (0 = none). */
  approved?: number
  /** Balance left on the policy as last verified (0 = unknown / not recorded). */
  balance?: number
  /** Sum insured on the policy (0 = not recorded). */
  sumInsured?: number
  /** Co-pay % the patient bears on every claim. */
  copayPct?: number
}

export interface CoverLimit {
  /** The most the insurer is expected to pay, or null when the policy gives no limit. */
  cap: number | null
  /** Where the limit comes from, in words for the screen. */
  basis: string
}

export function coverLimit(t: CoverTerms): CoverLimit {
  if ((t.approved ?? 0) > 0) return { cap: t.approved!, basis: "approved pre-authorisation" }
  if ((t.balance ?? 0) > 0) return { cap: t.balance!, basis: "balance available on the policy" }
  if ((t.sumInsured ?? 0) > 0) return { cap: t.sumInsured!, basis: "sum insured" }
  return { cap: null, basis: "" }
}

/** The insurer's share for a bill: the bill less the co-pay, never above the limit or what the patient has not already paid. */
export function policyShare(total: number, maxCover: number, t: CoverTerms): number {
  const afterCopay = Math.round(total * (1 - Math.min(100, Math.max(0, t.copayPct ?? 0)) / 100))
  const { cap } = coverLimit(t)
  return Math.max(0, Math.min(maxCover, afterCopay, cap ?? Number.POSITIVE_INFINITY))
}

/** True when the policy gives something to start the split from. */
export const hasPolicyTerms = (t: CoverTerms) => coverLimit(t).cap !== null || (t.copayPct ?? 0) > 0
