import { useState } from "react"
import { InsuranceEngineService as E, STATUS_META } from "../../services/insuranceDb"
import { BillingDatabase } from "../../services/billingDb"
import type { ComprehensiveClaimRecord } from "../../types/insurance"
import { STATE_LABEL, STATE_TONE, settlementPosition } from "../../utils/settlementMath"
import { Tag, attempt, btn, fieldCls, fmtDate, fmtDateTime, inr, type Notify } from "./ui"

// Small read-outs shared by the claim screen and the HMS integrations.

/** What still stands between this case and a clean insurance claim at discharge. */
export function Readiness({ c }: { c: ComprehensiveClaimRecord }) {
  if (["APPROVED", "PARTIALLY_APPROVED", "SETTLEMENT_PENDING", "PAYMENT_RECEIVED", "RECONCILED", "CLOSED", "CLAIM_SUBMITTED", "CLAIM_QUERY_RAISED"].includes(c.status)) return null
  const r = E.dischargeReadiness(c)
  return (
    <div className="rounded-[8px] border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${r.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span className="text-[13px] font-semibold text-slate-900">{r.ready ? "Ready for the insurance claim" : "Before the claim can be sent"}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {r.items.map((i) => (
          <li key={i.key} className="px-4 py-2 flex items-center gap-3 text-[13px]">
            <span className={`w-4 text-center font-semibold ${i.ok ? "text-emerald-600" : "text-slate-300"}`}>{i.ok ? "✓" : "○"}</span>
            <span className={i.ok ? "text-slate-700" : "text-slate-900 font-medium"}>{i.label}</span>
            <span className="ml-auto text-[12.5px] text-slate-500">{i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Approved vs used, the continuous comparison during treatment. */
export function Consumption({ c }: { c: ComprehensiveClaimRecord }) {
  const approved = c.approvedPreAuthAmount
  const used = c.consumedBillAmount
  const pct = approved ? Math.min(100, Math.round((used / approved) * 100)) : 0
  const bar = !approved ? "bg-slate-300" : pct >= 100 ? "bg-rose-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500"
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 text-[13px]">
        <span className="text-slate-500">
          Approved <strong className="text-slate-900 tabular-nums">{inr(approved)}</strong>
        </span>
        <span className="text-slate-500">
          Used <strong className="text-slate-900 tabular-nums">{inr(used)}</strong>
        </span>
        <span className="text-slate-500">
          Remaining <strong className={`tabular-nums ${approved - used < 0 ? "text-rose-600" : "text-slate-900"}`}>{inr(approved - used)}</strong>
        </span>
        <span className="ml-auto text-slate-500 tabular-nums">{approved ? `${pct}% used` : "No approval yet"}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** The bill's charges grouped by head -- every department's charges as billing raised them. */
export function BillLines({ c }: { c: ComprehensiveClaimRecord }) {
  const bill = c.billingClaimId ? BillingDatabase.getClaimById(c.billingClaimId) : undefined
  if (!bill) return <p className="text-[13px] text-slate-500">No bill has been raised for this encounter yet. Ward, ICU, OT, pharmacy and lab charges appear here once billing raises it.</p>
  const byHead = new Map<string, { total: number ;ins: number ;pat: number }>()
  for (const it of bill.items) {
    const k = it.category || "Other"
    const e = byHead.get(k) ?? { total: 0, ins: 0, pat: 0 }
    e.total += Number(it.total || 0)
    e.ins += Number(it.insuranceCovered || 0)
    e.pat += Number(it.patientPayable || 0)
    byHead.set(k, e)
  }
  const row = (l: string, v: number, strong = false, tone = "text-slate-900") => (
    <div className={`flex justify-between py-1.5 text-[13px] ${strong ? "font-semibold border-t border-slate-200 mt-1 pt-2" : ""}`}>
      <span className={strong ? "text-slate-900" : "text-slate-600"}>{l}</span>
      <span className={`tabular-nums ${tone}`}>{inr(v)}</span>
    </div>
  )
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <div className="text-[12px] text-slate-500 mb-1">
          Charges on {bill.invoiceNo} ({bill.items.length} lines)
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-slate-500 border-b border-slate-200">
              <th className="py-1.5 text-left font-medium">Charge</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
              <th className="py-1.5 text-right font-medium">Insurance</th>
              <th className="py-1.5 text-right font-medium">Patient</th>
            </tr>
          </thead>
          <tbody>
            {[...byHead.entries()].map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100">
                <td className="py-1.5 text-slate-800">{k}</td>
                <td className="py-1.5 text-right tabular-nums">{inr(v.total)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{inr(v.ins)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{inr(v.pat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-[12px] text-slate-500 mb-1">From bill to claim</div>
        {row("Hospital bill", c.totalHospitalBill)}
        {row("Package charges (pre-auth)", c.packageBaseAmount)}
        {row("Non-payable items", c.nonPayableAmount)}
        {row("Patient share", c.patientShareAmount)}
        {row("Claim amount", c.finalClaimAmount, true, "text-blue-700")}
      </div>
    </div>
  )
}

export function AuditTable({ c, notify }: { c: ComprehensiveClaimRecord ;notify: Notify }) {
  const [note, setNote] = useState("")
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className={fieldCls} placeholder="Add a note to this claim" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className={btn.plain} onClick={() => attempt(notify, () => E.addNote(c.id, note), "Note added.") && setNote("")}>
          Add note
        </button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[12px] text-slate-500 border-b border-slate-200">
            {["When", "Who", "What happened", "Status", "Device"].map((h) => (
              <th key={h} className="py-2 pr-4 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.auditTrail.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 align-top">
              <td className="py-2 pr-4 whitespace-nowrap text-slate-500">{fmtDateTime(a.timestamp)}</td>
              <td className="py-2 pr-4 whitespace-nowrap text-slate-800">{a.user}</td>
              <td className="py-2 pr-4 text-slate-900">
                {a.action}
                {a.comments && <div className="text-[12.5px] text-slate-500">{a.comments}</div>}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-[12.5px] text-slate-500">
                {a.newStatus ? `${a.oldStatus ? STATUS_META[a.oldStatus as keyof typeof STATUS_META]?.label ?? a.oldStatus : "—"} → ${STATUS_META[a.newStatus as keyof typeof STATUS_META]?.label ?? a.newStatus}` : ""}
              </td>
              <td className="py-2 whitespace-nowrap text-[12.5px] text-slate-400">{a.device}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Where the money stands: claimed -> approved -> received -> gap ───────────

/** The money trail of one claim. Square, flat, and plain: each box is one number; the bar below shows the gap. */
export function MoneyTrail({ c }: { c: ComprehensiveClaimRecord }) {
  const p = settlementPosition(c)
  if (p.state === "none") return null
  const pct = (n: number) => (p.approved > 0 ? Math.min(100, (n / p.approved) * 100) : 0)
  const seg = [
    { label: "Received", n: Math.min(p.received, p.approved), cls: "bg-emerald-600" },
    { label: "Explained (TDS / cut / write-off / patient)", n: p.closed, cls: "bg-violet-500" },
    { label: "Insurer still to pay", n: p.followUp, cls: "bg-amber-500" },
    { label: "Not explained yet", n: p.unexplained, cls: "bg-rose-600" },
  ]
  const box = "border border-slate-200 bg-white px-3 py-2.5 min-w-0"
  const lab = "text-[11px] font-semibold uppercase tracking-wider text-slate-500"
  const val = "text-[17px] font-bold tabular-nums text-slate-900 mt-0.5 truncate"
  return (
    <section className="border border-slate-200 bg-slate-50">
      <header className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-slate-900">Where the money stands</h4>
        <Tag tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Tag>
      </header>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className={box}>
            <div className={lab}>1 · Claimed</div>
            <div className={val}>{inr(p.claimed)}</div>
            <div className="text-[11.5px] text-slate-500">hospital bill sent to insurer</div>
          </div>
          <div className={box}>
            <div className={lab}>2 · Approved</div>
            <div className={val}>{inr(p.approved)}</div>
            <div className="text-[11.5px] text-slate-500">{p.insurerCut > 0 ? `${inr(p.insurerCut)} cut by insurer` : "nothing cut"}</div>
          </div>
          <div className={box}>
            <div className={lab}>3 · Received</div>
            <div className={`${val} text-emerald-700`}>{p.received ? inr(p.received) : "—"}</div>
            <div className="text-[11.5px] text-slate-500">{c.settlement?.payments?.length ? `${c.settlement.payments.length} payment${c.settlement.payments.length > 1 ? "s" : ""} in bank` : "no payment yet"}</div>
          </div>
          <div className={`${box} ${p.gap > 0 && p.unexplained > 0 ? "border-rose-300 bg-rose-50" : ""}`}>
            <div className={lab}>4 · Gap (2 − 3)</div>
            <div className={`${val} ${p.gap > 0 ? "text-rose-700" : p.gap < 0 ? "text-amber-700" : ""}`}>{p.received ? (p.gap < 0 ? `+${inr(-p.gap)}` : inr(p.gap)) : "—"}</div>
            <div className="text-[11.5px] text-slate-500">{p.received ? (p.gap > 0 ? "approved but not received" : p.gap < 0 ? "more than approved" : "matches the approval") : "waiting for payment"}</div>
          </div>
        </div>

        {p.approved > 0 && p.received > 0 && (
          <div>
            <div className="flex h-3 w-full border border-slate-300 bg-white" role="img" aria-label="How the approved amount is accounted for">
              {seg.map((x) => x.n > 0 && <div key={x.label} className={x.cls} style={{ width: `${pct(x.n)}%` }} title={`${x.label}: ${inr(x.n)}`} />)}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
              {seg.map((x) => (
                <li key={x.label} className="inline-flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 ${x.cls}`} />
                  {x.label}: <span className="tabular-nums font-semibold text-slate-900">{inr(x.n)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {p.unexplained > 0 && p.received > 0 && (
          <p className="text-[12.5px] text-rose-800 bg-rose-50 border border-rose-200 px-3 py-2">
            <strong>{inr(p.unexplained)}</strong> was approved but has not arrived and nobody has said why. Record it below (TDS, accepted cut, write-off, charge to patient, or still to be paid) so the claim can be reconciled.
          </p>
        )}
        {p.excess > 0 && <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2">The insurer paid <strong>{inr(p.excess)}</strong> more than it approved. Explain it when you reconcile (for example, a refund due).</p>}
      </div>
    </section>
  )
}

/** Every bank credit on the claim, with its own UTR. */
export function PaymentsLedger({ c }: { c: ComprehensiveClaimRecord }) {
  const pays = c.settlement?.payments ?? (c.settlement?.receivedAmount ? [{ id: "PAY-1", amount: c.settlement.receivedAmount, utr: c.settlement.paymentReferenceNo, paymentDate: c.settlement.paymentDate, bankAccount: c.settlement.bankAccountName, recordedBy: "" }] : [])
  if (!pays.length) return null
  return (
    <section>
      <h4 className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Payments received ({pays.length})</h4>
      <table className="w-full table-fixed text-[12.5px] border border-slate-200">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col />
          <col style={{ width: "26%" }} />
        </colgroup>
        <tbody>
          {pays.map((x) => (
            <tr key={x.id} className="border-t border-slate-100 first:border-0">
              <td className="px-3 py-2 tabular-nums text-slate-600">{x.paymentDate ? fmtDate(x.paymentDate) : "—"}</td>
              <td className="px-3 py-2 truncate">
                <span className="tabular-nums font-medium text-slate-900">{x.utr}</span>
                <span className="text-slate-500"> · {x.bankAccount || "bank"}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{inr(x.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
