import { coverLimit, type CoverTerms } from "./coverLimit"

/**
 * What a patient's policy gives for one hospital stay, line by line: the bed against the policy's daily limit, the
 * other charges, the co-pay clause and the insurer's overall limit. Pure (no storage, no UI) so it can be tested.
 *
 * The rule applied is the plain one: rent above the daily limit is the patient's; the rest (bed within the limit plus all
 * other charges) is covered less the co-pay %; and the insurer never pays more than its limit (approved pre-auth, else
 * the policy balance, else the sum insured). Insurers that cut other charges in proportion to an over-limit room are not
 * modelled; the final claim decision always governs.
 */
export interface PolicyTerms extends CoverTerms {
  /** ₹ per day the policy pays for a normal room; 0 / undefined = no cap. */
  roomRentPerDay?: number
  /** ₹ per day the policy pays for an ICU bed; 0 / undefined = no cap. */
  icuRentPerDay?: number
}

export interface BedStay {
  kind: "room" | "icu"
  label: string
  perDay: number
  days: number
}

export interface BedLine extends BedStay {
  /** The policy's daily limit for this kind of bed, or null when there is no cap. */
  limitPerDay: number | null
  allowedPerDay: number
  excessPerDay: number
  coveredTotal: number
  excessTotal: number
}

export interface StayBenefit {
  beds: BedLine[]
  otherCharges: number
  billTotal: number
  /** Bed within the limit plus other charges, before the co-pay. */
  coveredBeforeCopay: number
  /** Bed rent above the daily limit. */
  bedExcess: number
  copayPct: number
  copayAmount: number
  /** The part above the insurer's overall limit. */
  beyondLimit: number
  limit: number | null
  limitBasis: string
  insurerShare: number
  patientShare: number
}

export function stayBenefit(input: { beds: BedStay[]; otherCharges: number; terms: PolicyTerms }): StayBenefit {
  const { terms } = input
  const beds: BedLine[] = input.beds
    .filter((b) => b.days > 0 && b.perDay > 0)
    .map((b) => {
      const cap = b.kind === "icu" ? terms.icuRentPerDay : terms.roomRentPerDay
      const limitPerDay = cap && cap > 0 ? cap : null
      const allowedPerDay = limitPerDay !== null ? Math.min(b.perDay, limitPerDay) : b.perDay
      const excessPerDay = b.perDay - allowedPerDay
      return { ...b, limitPerDay, allowedPerDay, excessPerDay, coveredTotal: allowedPerDay * b.days, excessTotal: excessPerDay * b.days }
    })
  const other = Math.max(0, input.otherCharges)
  const bedTotal = beds.reduce((a, b) => a + b.perDay * b.days, 0)
  const bedExcess = beds.reduce((a, b) => a + b.excessTotal, 0)
  const coveredBeforeCopay = beds.reduce((a, b) => a + b.coveredTotal, 0) + other
  const pct = Math.min(100, Math.max(0, terms.copayPct ?? 0))
  const copayAmount = Math.round((coveredBeforeCopay * pct) / 100)
  const afterCopay = coveredBeforeCopay - copayAmount
  const lim = coverLimit(terms)
  const insurerShare = Math.max(0, Math.min(afterCopay, lim.cap ?? Number.POSITIVE_INFINITY))
  const billTotal = bedTotal + other
  return { beds, otherCharges: other, billTotal, coveredBeforeCopay, bedExcess, copayPct: pct, copayAmount, beyondLimit: afterCopay - insurerShare, limit: lim.cap, limitBasis: lim.basis, insurerShare, patientShare: billTotal - insurerShare }
}
