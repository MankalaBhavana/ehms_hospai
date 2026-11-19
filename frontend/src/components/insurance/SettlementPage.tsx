import { useEffect, useMemo, useState } from "react"
import { InsuranceEngineService as E } from "../../services/insuranceDb"
import type { ComprehensiveClaimRecord } from "../../types/insurance"
import { toCsv } from "../../utils/policyCsv"
import { STATE_LABEL, STATE_TONE, settlementPosition } from "../../utils/settlementMath"
import { PaymentReceivedStep, PaymentForm, SettlementAdviceForm, ShortfallList } from "./forms"
import { MoneyTrail, PaymentsLedger } from "./widgets"
import { Drawer, Empty, KV, PageHeader, StatusPill, Tag, attempt, btn, daysUntil, fieldBase, fmtDate, inr, useCases, useNotify } from "./ui"


type Nav = (module: string, caseId?: string) => void
type Step = "advice" | "expected" | "reconcile" | "reconciled" | "closed"

const STEPS: { id: Step; label: string; sub: string; match: (c: ComprehensiveClaimRecord) => boolean }[] = [
  { id: "advice", label: "Awaiting advice", sub: "Approved; waiting for the insurer's settlement advice", match: (c) => c.status === "APPROVED" || c.status === "PARTIALLY_APPROVED" },
  { id: "expected", label: "Payment expected", sub: "Advice received; waiting for the bank credit", match: (c) => c.status === "SETTLEMENT_PENDING" },
  { id: "reconcile", label: "To reconcile", sub: "Money received; match it and explain any gap", match: (c) => c.status === "PAYMENT_RECEIVED" },
  { id: "reconciled", label: "Reconciled", sub: "Matched with the bank statement", match: (c) => c.status === "RECONCILED" },
  { id: "closed", label: "Closed", sub: "Finished and archived", match: (c) => c.status === "CLOSED" && !!c.settlement },
]

/** What the insurer approved (the amount expected in the bank). */
export const expectedOf = (c: ComprehensiveClaimRecord) => c.settlement?.expectedAmount ?? c.approvedClaimAmount ?? 0

const CSV_HEAD = ["Claim", "Patient", "UMR", "Insurer", "TPA", "Claimed", "Approved", "Insurer cut", "Received", "Gap", "Explained (closed)", "Being chased", "Unexplained", "State", "Status", "Last UTR", "Last payment date"]

export default function SettlementPage({ onNavigate, initialCaseId }: { onNavigate: Nav; initialCaseId?: string }) {
  const cases = useCases()
  const { notify, toastNode } = useNotify()
  const [step, setStep] = useState<Step>("reconcile")
  const [open, setOpen] = useState<string | undefined>(initialCaseId)
  const [q, setQ] = useState("")
  const [insurer, setInsurer] = useState("")

  useEffect(() => {
    const c = initialCaseId && cases.find((x) => x.id === initialCaseId)
    const s = c && STEPS.find((x) => x.match(c))
    if (s) setStep(s.id)
    setOpen(initialCaseId)
  }, [initialCaseId])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return cases
      .filter(STEPS.find((s) => s.id === step)!.match)
      .filter((c) => !insurer || c.policy.insurerName === insurer)
      .filter(
        (c) =>
          !t ||
          [c.patientName, c.id, c.patientId, c.policy.insurerName, c.settlement?.paymentReferenceNo, c.settlement?.settlementAdviceNo, ...(c.settlement?.payments ?? []).map((p) => p.utr)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(t),
      )
  }, [cases, step, q, insurer])

  const current = open ? cases.find((c) => c.id === open) : undefined
  const insurers = useMemo(() => [...new Set(cases.map((c) => c.policy.insurerName))].filter(Boolean).sort(), [cases])

  const totals = useMemo(() => {
    const live = cases.filter((c) => c.settlement && ["APPROVED", "PARTIALLY_APPROVED", "SETTLEMENT_PENDING", "PAYMENT_RECEIVED"].includes(c.status))
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    const monthReceived = cases.reduce((a, c) => {
      const pays = c.settlement?.payments ?? (c.settlement?.receivedAmount ? [{ amount: c.settlement.receivedAmount, paymentDate: c.settlement.paymentDate }] : [])
      return a + pays.filter((p) => p.paymentDate && new Date(p.paymentDate).getTime() >= monthStart).reduce((x, p) => x + p.amount, 0)
    }, 0)
    const overdue = cases.filter((c) => c.status === "SETTLEMENT_PENDING" && c.settlement?.expectedBy && daysUntil(c.settlement.expectedBy) < 0)
    const unexplained = cases.filter((c) => settlementPosition(c).unexplained > 0 && c.status === "PAYMENT_RECEIVED")
    return {
      toCollect: live.reduce((a, c) => a + Math.max(0, settlementPosition(c).gap - settlementPosition(c).closed), 0),
      liveCount: live.length,
      monthReceived,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((a, c) => a + expectedOf(c), 0),
      unexplainedAmount: unexplained.reduce((a, c) => a + settlementPosition(c).unexplained, 0),
      unexplainedCount: unexplained.length,
    }
  }, [cases])

  const exportCsv = () => {
    const lines = rows.map((c) => {
      const p = settlementPosition(c)
      return [c.id, c.patientName, c.patientId, c.policy.insurerName, c.policy.tpaName || "", p.claimed, p.approved, p.insurerCut, p.received, p.gap, p.closed, p.followUp, p.unexplained, STATE_LABEL[p.state], c.status, c.settlement?.paymentReferenceNo || "", c.settlement?.paymentDate || ""]
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([toCsv(CSV_HEAD, lines)], { type: "text/csv;charset=utf-8" }))
    a.download = `insurance-settlements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    notify(`${lines.length} claim${lines.length === 1 ? "" : "s"} exported.`)
  }

  const kpi = (label: string, value: string, sub: string, tone = "text-slate-900", onClick?: () => void) => (
    <button type="button" onClick={onClick} className={`text-left min-w-0 bg-white border border-slate-200 p-3.5 ${onClick ? "cursor-pointer hover:border-slate-400" : "cursor-default"}`}>
      <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums leading-tight mt-1 truncate ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-slate-400 mt-0.5 truncate">{sub}</div>
    </button>
  )

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {toastNode}
      <PageHeader
        title="Settlement & Reconciliation"
        subtitle="Approved claims to money in the bank. Record each payment, explain any gap, then reconcile."
        actions={
          <>
            <button type="button" className={btn.plain} onClick={() => onNavigate("insurance_gaps")}>
              Payment gaps report
            </button>
            <button type="button" className={btn.plain} onClick={exportCsv} disabled={!rows.length}>
              Export ({rows.length})
            </button>
          </>
        }
      />
      {current && <SettlementDrawer c={current} notify={notify} onClose={() => setOpen(undefined)} onOpenClaim={() => onNavigate("insurance_claims", current.id)} />}

      <div className="p-6 space-y-4 max-w-[1500px] mx-auto">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {kpi("Still to collect", inr(totals.toCollect), `${totals.liveCount} approved claim${totals.liveCount === 1 ? "" : "s"} not fully paid`)}
          {kpi("Received this month", inr(totals.monthReceived), "bank credits recorded", "text-emerald-700")}
          {kpi("Overdue", inr(totals.overdueAmount), `${totals.overdueCount} past the expected date`, totals.overdueCount ? "text-rose-700" : "text-slate-900")}
          {kpi("Gap with no reason", inr(totals.unexplainedAmount), totals.unexplainedCount ? `${totals.unexplainedCount} claim${totals.unexplainedCount > 1 ? "s" : ""} — open the gaps report` : "nothing unexplained", totals.unexplainedAmount ? "text-rose-700" : "text-slate-900", () => onNavigate("insurance_gaps"))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {STEPS.map((s) => {
            const active = step === s.id
            return (
              <button key={s.id} type="button" onClick={() => setStep(s.id)} className={`text-left p-3 border cursor-pointer transition-colors ${active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 hover:border-slate-400 text-slate-800"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{s.label}</span>
                  <span className={`text-[12px] font-bold tabular-nums ${active ? "text-white" : "text-slate-500"}`}>{cases.filter(s.match).length}</span>
                </div>
                <p className={`text-[11.5px] mt-1 truncate ${active ? "text-slate-300" : "text-slate-400"}`}>{s.sub}</p>
              </button>
            )
          })}
        </div>

        <div className="bg-white border border-slate-200 p-3 flex flex-wrap items-center gap-3">
          <input className={`${fieldBase} flex-1 min-w-[240px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient, claim, UTR, advice number or insurer" aria-label="Search" />
          <select className={`${fieldBase} w-[220px]`} value={insurer} onChange={(e) => setInsurer(e.target.value)} aria-label="Insurer">
            <option value="">All insurers</option>
            {insurers.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <span className="text-[12.5px] text-slate-500 ml-auto">
            <span className="font-semibold text-slate-900 tabular-nums">{rows.length}</span> claim{rows.length === 1 ? "" : "s"} at this stage
          </span>
        </div>

        <div className="bg-white border border-slate-200 overflow-x-auto">
          {rows.length === 0 ? (
            <Empty title="No claims at this stage" hint="Pick another stage above or clear the filters." />
          ) : (
            <table className="w-full min-w-[1100px] table-fixed text-[13px]">
              <colgroup>
                <col style={{ width: "19%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "8%" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Patient / claim</th>
                  <th className="px-4 py-2.5">Insurer</th>
                  <th className="px-4 py-2.5 text-right">Claimed</th>
                  <th className="px-4 py-2.5 text-right">Approved</th>
                  <th className="px-4 py-2.5 text-right">Received</th>
                  <th className="px-4 py-2.5">Gap</th>
                  <th className="px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const p = settlementPosition(c)
                  const late = c.status === "SETTLEMENT_PENDING" && c.settlement?.expectedBy && daysUntil(c.settlement.expectedBy) < 0
                  return (
                    <tr key={c.id} onClick={() => setOpen(c.id)} className="border-b border-slate-100 last:border-0 hover:bg-teal-50/40 cursor-pointer align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 truncate">{c.patientName}</div>
                        <div className="text-[12px] text-slate-500 tabular-nums truncate">
                          {c.id} · {c.encounterType}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="truncate text-slate-900">{c.policy.insurerName}</div>
                        <div className="text-[12px] text-slate-500 truncate">{c.policy.tpaName || "Direct"}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{inr(p.claimed)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                        {inr(p.approved)}
                        {p.insurerCut > 0 && <div className="text-[11.5px] font-normal text-violet-700">cut {inr(p.insurerCut)}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{p.received ? inr(p.received) : "—"}</td>
                      <td className="px-4 py-3">
                        {p.received > 0 ? (
                          <>
                            <div className={`tabular-nums font-semibold ${p.gap > 0 ? "text-rose-700" : p.gap < 0 ? "text-amber-700" : "text-emerald-700"}`}>{p.gap > 0 ? inr(p.gap) : p.gap < 0 ? `+${inr(-p.gap)}` : "Matched"}</div>
                            <Tag tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Tag>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.settlement?.paymentReferenceNo ? (
                          <>
                            <div className="tabular-nums text-slate-900 truncate">{c.settlement.paymentReferenceNo}</div>
                            <div className="text-[12px] text-slate-500">{c.settlement.paymentDate ? fmtDate(c.settlement.paymentDate) : ""}{(c.settlement.payments?.length ?? 0) > 1 ? ` · ${c.settlement.payments!.length} payments` : ""}</div>
                          </>
                        ) : c.settlement?.settlementAdviceNo ? (
                          <>
                            <div className="tabular-nums text-slate-900 truncate">{c.settlement.settlementAdviceNo}</div>
                            <div className={`text-[12px] ${late ? "text-rose-700 font-semibold" : "text-slate-500"}`}>{c.settlement.expectedBy ? `${late ? "overdue · " : "due "}${fmtDate(c.settlement.expectedBy)}` : "advice"}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">No advice yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={btn.link}>{step === "advice" ? "Advice" : step === "expected" ? "Payment" : step === "reconcile" ? "Reconcile" : "View"}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function SettlementDrawer({ c, notify, onClose, onOpenClaim }: { c: ComprehensiveClaimRecord; notify: ReturnType<typeof useNotify>["notify"]; onClose: () => void; onOpenClaim: () => void }) {
  const s = c.settlement
  const h = "text-[11.5px] font-semibold uppercase tracking-wider text-slate-500 mb-1"
  return (
    <Drawer
      title={c.patientName}
      subtitle={`${c.id} · ${c.policy.insurerName}${c.policy.tpaName ? ` · ${c.policy.tpaName}` : ""}`}
      onClose={onClose}
      footer={
        <button type="button" className={btn.plain} onClick={onOpenClaim}>
          Open the claim
        </button>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <StatusPill status={c.status} />
          <span className="text-[12.5px] text-slate-500 tabular-nums">{c.patientId}</span>
        </div>

        <MoneyTrail c={c} />

        {!!s?.deductionReasons?.length && (
          <section>
            <div className={h}>Cut by the insurer at approval ({inr(s.deductionsAmount)})</div>
            <ul className="border border-slate-200 divide-y divide-slate-100">
              {s.deductionReasons.map((d) => (
                <li key={d.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-slate-700">
                    {d.category}
                    {d.remark ? ` — ${d.remark}` : ""}
                  </span>
                  <span className="tabular-nums font-semibold text-slate-900">{inr(d.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(c.status === "RECONCILED" || c.status === "CLOSED" || c.status === "SETTLEMENT_PENDING") && (
          <>
            <PaymentsLedger c={c} />
            <ShortfallList c={c} notify={notify} />
          </>
        )}

        <section>
          <div className={h}>Identifiers</div>
          <div className="divide-y divide-slate-100">
            <KV k="Settlement advice no." v={s?.settlementAdviceNo || "—"} mono />
            <KV k="Expected by" v={s?.expectedBy ? fmtDate(s.expectedBy) : "—"} />
            <KV k="Last UTR" v={s?.paymentReferenceNo || "—"} mono />
            <KV k="Reconciliation" v={s?.reconciliationStatus ?? "—"} />
            {s?.reconciledAt && <KV k="Reconciled" v={`${fmtDate(s.reconciledAt)} by ${s.reconciledBy || "—"}`} />}
          </div>
        </section>

        <section className="border-t border-slate-200 pt-5">
          {(c.status === "APPROVED" || c.status === "PARTIALLY_APPROVED") && (
            <div className="space-y-3">
              <h4 className="text-[13px] font-semibold text-slate-900">Step 1 · Record the insurer's settlement advice</h4>
              <SettlementAdviceForm c={c} notify={notify} />
            </div>
          )}
          {c.status === "SETTLEMENT_PENDING" && (
            <div className="space-y-3">
              <h4 className="text-[13px] font-semibold text-slate-900">Step 2 · Record the payment that reached the bank</h4>
              <PaymentForm c={c} notify={notify} />
            </div>
          )}
          {c.status === "PAYMENT_RECEIVED" && (
            <div className="space-y-3">
              <h4 className="text-[13px] font-semibold text-slate-900">Step 3 · Account for every rupee, then reconcile</h4>
              <PaymentReceivedStep c={c} notify={notify} />
            </div>
          )}
          {c.status === "RECONCILED" && (
            <button type="button" className={`${btn.success} w-full`} onClick={() => attempt(notify, () => E.closeClaim(c.id), "Claim closed.")}>
              Close and archive this claim
            </button>
          )}
          {c.status === "CLOSED" && <p className="text-[13px] text-emerald-700 font-semibold">This claim is fully reconciled and closed.</p>}
        </section>
      </div>
    </Drawer>
  )
}
