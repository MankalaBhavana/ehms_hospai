import { useMemo, useState } from "react"
import { SHORTFALL_KINDS, type ComprehensiveClaimRecord } from "../../types/insurance"
import { toCsv } from "../../utils/policyCsv"
import { STATE_LABEL, STATE_TONE, ageDays, settlementPosition, type Position } from "../../utils/settlementMath"
import { Empty, PageHeader, Tag, btn, daysUntil, fieldBase, fmtDate, inr, useCases, useNotify } from "./ui"

/**
 * Payment Gaps: every approved claim whose bank credits do not match what the insurer approved. One row per claim,
 * with the money trail (claimed -> approved -> received), what is explained (TDS, accepted cut, write-off, charged to
 * the patient), what is still being chased, and what nobody has explained yet. The page the finance head opens to
 * answer "approved ₹5,00,000 but ₹4,00,000 arrived — where is the rest?".
 */

type Nav = (module: string, caseId?: string) => void
type View = "action" | "awaiting" | "explained" | "paid" | "rejected" | "all"

interface Row {
  c: ComprehensiveClaimRecord
  p: Position
  lastPaid: string
  age: number
  reasons: string[]
}

const lastPayment = (c: ComprehensiveClaimRecord) => {
  const pays = c.settlement?.payments ?? []
  return pays.length ? pays[pays.length - 1].paymentDate : c.settlement?.paymentDate || ""
}

const HEAD = ["Claim", "Patient", "UMR", "Insurer", "TPA", "Claimed", "Cut by insurer", "Approved", "Received", "Gap", "Explained (settled)", "Being chased", "Not explained", "State", "Reasons", "Days since last payment", "Status"]

export default function PaymentGapsPage({ onNavigate }: { onNavigate: Nav }) {
  const cases = useCases()
  const { notify, toastNode } = useNotify()
  const [view, setView] = useState<View>("action")
  const [q, setQ] = useState("")
  const [insurer, setInsurer] = useState("")

  const all: Row[] = useMemo(
    () =>
      cases
        .filter((c) => c.settlement && settlementPosition(c).approved > 0)
        .map((c) => {
          const p = settlementPosition(c)
          const lastPaid = lastPayment(c)
          const base = lastPaid || c.settlement?.expectedBy || c.updatedAt
          return { c, p, lastPaid, age: ageDays(base), reasons: [...new Set((c.settlement?.shortfalls ?? []).map((e) => e.kind))] }
        }),
    [cases],
  )

  // Claims the insurer rejected: money that will not arrive unless the appeal succeeds.
  const rejected = useMemo(
    () =>
      cases
        .filter((c) => c.status === "REJECTED" || c.closure?.kind?.startsWith("Rejected"))
        .map((c) => {
          const note = c.auditTrail.find((a) => /reject/i.test(a.action) && a.comments)?.comments || ""
          return { c, amount: c.finalClaimAmount || 0, open: c.status === "REJECTED", reason: c.closure?.reason || note, bearer: c.closure?.kind === "Rejected - charged to patient" ? "Charged to patient" : c.closure ? "Written off" : "Appeal or close" }
        }),
    [cases],
  )
  const needsAction = (r: Row) => r.p.unexplained > 0 || r.p.followUp > 0
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all
      .filter((r) => (view === "action" ? needsAction(r) : view === "awaiting" ? r.p.state === "awaiting" : view === "explained" ? r.p.state === "short_explained" : view === "paid" ? r.p.state === "settled" : true))
      .filter((r) => !insurer || r.c.policy.insurerName === insurer)
      .filter((r) => !t || [r.c.patientName, r.c.id, r.c.patientId, r.c.policy.insurerName, ...(r.c.settlement?.payments ?? []).map((x) => x.utr)].filter(Boolean).join(" ").toLowerCase().includes(t))
      .sort((a, b) => b.p.unexplained + b.p.followUp - (a.p.unexplained + a.p.followUp) || b.age - a.age)
  }, [all, view, q, insurer])

  const sum = (f: (r: Row) => number) => all.reduce((a, r) => a + f(r), 0)
  const kpi = {
    unexplained: sum((r) => r.p.unexplained),
    unexplainedN: all.filter((r) => r.p.unexplained > 0).length,
    followUp: sum((r) => r.p.followUp),
    followUpN: all.filter((r) => r.p.followUp > 0).length,
    awaiting: sum((r) => (r.p.state === "awaiting" ? r.p.approved : 0)),
    awaitingN: all.filter((r) => r.p.state === "awaiting").length,
    overdueN: all.filter((r) => r.p.state === "awaiting" && r.c.settlement?.expectedBy && daysUntil(r.c.settlement.expectedBy) < 0).length,
    closed: sum((r) => r.p.closed),
    cut: sum((r) => r.p.insurerCut),
    rejectedOpen: rejected.filter((r) => r.open).reduce((a, r) => a + r.amount, 0),
    rejectedOpenN: rejected.filter((r) => r.open).length,
    rejectedLost: rejected.filter((r) => !r.open && r.bearer === "Written off").reduce((a, r) => a + r.amount, 0),
  }

  const byInsurer = useMemo(() => {
    const m = new Map<string, { n: number; approved: number; received: number; open: number }>()
    all.forEach((r) => {
      const k = r.c.policy.insurerName || "—"
      const x = m.get(k) ?? { n: 0, approved: 0, received: 0, open: 0 }
      x.n++
      x.approved += r.p.approved
      x.received += r.p.received
      x.open += r.p.toCollect
      m.set(k, x)
    })
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open)
  }, [all])

  const byReason = useMemo(() => {
    const m = new Map<string, number>()
    all.forEach((r) => (r.c.settlement?.shortfalls ?? []).forEach((e) => m.set(e.kind, (m.get(e.kind) ?? 0) + Math.min(e.amount, r.p.gap > 0 ? e.amount : 0))))
    const cuts = new Map<string, number>()
    all.forEach((r) => (r.c.settlement?.deductionReasons ?? []).forEach((d) => cuts.set(d.category, (cuts.get(d.category) ?? 0) + d.amount)))
    return { shortfall: [...m.entries()].sort((a, b) => b[1] - a[1]), cuts: [...cuts.entries()].sort((a, b) => b[1] - a[1]) }
  }, [all])

  const insurers = useMemo(() => [...new Set(all.map((r) => r.c.policy.insurerName))].filter(Boolean).sort(), [all])

  const exportCsv = () => {
    const lines = rows.map((r) => [r.c.id, r.c.patientName, r.c.patientId, r.c.policy.insurerName, r.c.policy.tpaName || "", r.p.claimed, r.p.insurerCut, r.p.approved, r.p.received, r.p.gap, r.p.closed, r.p.followUp, r.p.unexplained, STATE_LABEL[r.p.state], (r.c.settlement?.shortfalls ?? []).map((e) => `${e.kind} ₹${e.amount}${e.remark ? ` (${e.remark})` : ""}`).join("; "), r.lastPaid ? r.age : "", r.c.status])
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([toCsv(HEAD, lines)], { type: "text/csv;charset=utf-8" }))
    a.download = `insurance-payment-gaps-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    notify(`${lines.length} claim${lines.length === 1 ? "" : "s"} exported.`)
  }

  const tile = (label: string, value: string, sub: string, tone: string, v?: View) => (
    <button type="button" onClick={() => v && setView(v)} className={`text-left min-w-0 bg-white border p-3.5 ${v && view === v ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"} ${v ? "cursor-pointer hover:border-slate-400" : "cursor-default"}`}>
      <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums leading-tight mt-1 truncate ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-slate-400 mt-0.5 truncate">{sub}</div>
    </button>
  )
  const chip = (v: View, label: string, n: number) => (
    <button key={v} type="button" onClick={() => setView(v)} className={`h-8 px-3 text-[12.5px] font-semibold border cursor-pointer transition-colors ${view === v ? "bg-teal-700 border-teal-700 text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
      {label} <span className="tabular-nums opacity-80">({n})</span>
    </button>
  )
  const th = "px-4 py-2.5"

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {toastNode}
      <PageHeader
        title="Payment Gaps"
        subtitle="Approved by the insurer but not received. See what is missing, the reason, and who is chasing it. Open a row to fix it."
        actions={
          <>
            <button type="button" className={btn.plain} onClick={() => onNavigate("insurance_settlement")}>
              Settlement desk
            </button>
            <button type="button" className={btn.plain} onClick={exportCsv} disabled={!rows.length}>
              Export ({rows.length})
            </button>
          </>
        }
      />

      <div className="p-6 space-y-4 max-w-[1500px] mx-auto">
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
          {tile("Not explained", inr(kpi.unexplained), kpi.unexplainedN ? `${kpi.unexplainedN} claim${kpi.unexplainedN > 1 ? "s" : ""} short with no reason` : "nothing unexplained", kpi.unexplained ? "text-rose-700" : "text-slate-900", "action")}
          {tile("Insurer still to pay", inr(kpi.followUp), kpi.followUpN ? `${kpi.followUpN} claim${kpi.followUpN > 1 ? "s" : ""} being chased` : "nothing being chased", kpi.followUp ? "text-amber-700" : "text-slate-900", "action")}
          {tile("Awaiting first payment", inr(kpi.awaiting), `${kpi.awaitingN} claim${kpi.awaitingN === 1 ? "" : "s"}${kpi.overdueN ? ` · ${kpi.overdueN} overdue` : ""}`, "text-slate-900", "awaiting")}
          {tile("Short, but explained", inr(kpi.closed), "TDS, accepted cuts, write-offs, patient", "text-violet-700", "explained")}
          {tile("Cut at approval", inr(kpi.cut), "claimed minus approved", "text-slate-900")}
          {tile("Rejected claims", inr(kpi.rejectedOpen), kpi.rejectedOpenN ? `${kpi.rejectedOpenN} to appeal or close${kpi.rejectedLost ? ` · ${inr(kpi.rejectedLost)} written off` : ""}` : kpi.rejectedLost ? `${inr(kpi.rejectedLost)} written off so far` : "none rejected", kpi.rejectedOpen ? "text-rose-700" : "text-slate-900", "rejected")}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section className="bg-white border border-slate-200">
            <h3 className="px-4 py-2.5 border-b border-slate-200 text-[13px] font-semibold text-slate-900">By insurer</h3>
            {byInsurer.length === 0 ? (
              <Empty title="No approved claims yet" />
            ) : (
              <table className="w-full table-fixed text-[12.5px]">
                <colgroup>
                  <col />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "21%" }} />
                </colgroup>
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2">Insurer</th>
                    <th className="px-2 py-2 text-right">Claims</th>
                    <th className="px-2 py-2 text-right">Approved</th>
                    <th className="px-2 py-2 text-right">Received</th>
                    <th className="px-4 py-2 text-right">Still open</th>
                  </tr>
                </thead>
                <tbody>
                  {byInsurer.map(([name, x]) => (
                    <tr key={name} onClick={() => setInsurer(name)} className="border-b border-slate-100 last:border-0 hover:bg-teal-50/40 cursor-pointer">
                      <td className="px-4 py-2 truncate text-slate-900">{name}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{x.n}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{inr(x.approved)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{inr(x.received)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${x.open ? "text-rose-700" : "text-slate-400"}`}>{x.open ? inr(x.open) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-white border border-slate-200">
            <h3 className="px-4 py-2.5 border-b border-slate-200 text-[13px] font-semibold text-slate-900">Why money is missing</h3>
            {byReason.shortfall.length === 0 && byReason.cuts.length === 0 ? (
              <Empty title="No reasons recorded yet" hint="They appear here as short payments and insurer cuts are recorded." />
            ) : (
              <table className="w-full table-fixed text-[12.5px]">
                <colgroup>
                  <col />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "24%" }} />
                </colgroup>
                <tbody>
                  {byReason.shortfall.map(([k, n]) => (
                    <tr key={k} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-900">{k}</td>
                      <td className="px-2 py-2 text-[11px] uppercase tracking-wider font-semibold text-slate-500">short payment</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{inr(n)}</td>
                    </tr>
                  ))}
                  {byReason.cuts.map(([k, n]) => (
                    <tr key={k} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-900">{k}</td>
                      <td className="px-2 py-2 text-[11px] uppercase tracking-wider font-semibold text-slate-500">cut at approval</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{inr(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="bg-white border border-slate-200 p-3 flex flex-wrap items-center gap-3">
          <div className="flex">
            {chip("action", "Needs action", all.filter(needsAction).length)}
            {chip("awaiting", "Awaiting payment", all.filter((r) => r.p.state === "awaiting").length)}
            {chip("explained", "Explained", all.filter((r) => r.p.state === "short_explained").length)}
            {chip("paid", "Paid in full", all.filter((r) => r.p.state === "settled").length)}
            {chip("rejected", "Rejected", rejected.length)}
            {chip("all", "All", all.length)}
          </div>
          <input className={`${fieldBase} flex-1 min-w-[220px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient, claim, UTR or insurer" aria-label="Search" />
          <select className={`${fieldBase} w-[210px]`} value={insurer} onChange={(e) => setInsurer(e.target.value)} aria-label="Insurer">
            <option value="">All insurers</option>
            {insurers.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          {insurer && (
            <button type="button" className={btn.link} onClick={() => setInsurer("")}>
              Clear insurer
            </button>
          )}
        </div>

        {view === "rejected" && (
          <div className="bg-white border border-slate-200 overflow-x-auto">
            {rejected.length === 0 ? (
              <Empty title="No rejected claims" hint="Claims the insurer rejects appear here until they are appealed or closed." />
            ) : (
              <table className="w-full min-w-[900px] table-fixed text-[13px]">
                <colgroup>
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "14%" }} />
                  <col />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "7%" }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className={th}>Patient / claim</th>
                    <th className={th}>Insurer</th>
                    <th className={`${th} text-right`}>Rejected</th>
                    <th className={th}>Reason</th>
                    <th className={th}>Outcome</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((r) => (
                    <tr key={r.c.id} onClick={() => onNavigate("insurance_claims", r.c.id)} className="border-b border-slate-100 last:border-0 hover:bg-teal-50/40 cursor-pointer align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 truncate">{r.c.patientName}</div>
                        <div className="text-[12px] text-slate-500 tabular-nums truncate">{r.c.id}</div>
                      </td>
                      <td className="px-4 py-3 truncate">{r.c.policy.insurerName}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-rose-700">{inr(r.amount)}</td>
                      <td className="px-4 py-3 text-slate-700">{r.reason || <span className="text-slate-400">No reason recorded</span>}</td>
                      <td className="px-4 py-3">
                        <Tag tone={r.open ? "rose" : r.bearer === "Written off" ? "violet" : "amber"}>{r.bearer}</Tag>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={btn.link}>{r.open ? "Decide" : "Open"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className={`bg-white border border-slate-200 overflow-x-auto ${view === "rejected" ? "hidden" : ""}`}>
          {rows.length === 0 ? (
            <Empty
              title={view === "action" ? "No payment gaps need action" : "No claims here"}
              hint={view === "action" ? "Every approved amount that was received is matched, or its shortfall is explained." : "Choose another tab or clear the filters."}
            />
          ) : (
            <table className="w-full min-w-[1100px] table-fixed text-[13px]">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "6%" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className={th}>Patient / claim</th>
                  <th className={th}>Insurer</th>
                  <th className={`${th} text-right`}>Approved</th>
                  <th className={`${th} text-right`}>Received</th>
                  <th className={`${th} text-right`}>Still open</th>
                  <th className={th}>Reason</th>
                  <th className={`${th} text-right`}>Days</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.c.id} onClick={() => onNavigate("insurance_settlement", r.c.id)} className="border-b border-slate-100 last:border-0 hover:bg-teal-50/40 cursor-pointer align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 truncate">{r.c.patientName}</div>
                      <div className="text-[12px] text-slate-500 tabular-nums truncate">{r.c.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="truncate text-slate-900">{r.c.policy.insurerName}</div>
                      <div className="text-[12px] text-slate-500 truncate">{r.c.policy.tpaName || "Direct"}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {inr(r.p.approved)}
                      {r.p.insurerCut > 0 && <div className="text-[11.5px] text-violet-700">cut {inr(r.p.insurerCut)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-semibold">{r.p.received ? inr(r.p.received) : "—"}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${r.p.outstanding ? "text-rose-700" : r.p.excess ? "text-amber-700" : "text-slate-400"}`}>
                      {r.p.outstanding ? inr(r.p.outstanding) : r.p.excess ? `+${inr(r.p.excess)}` : r.p.state === "awaiting" ? inr(r.p.approved) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Tag tone={STATE_TONE[r.p.state]}>{STATE_LABEL[r.p.state]}</Tag>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        {r.p.unexplained > 0 && r.p.received > 0 ? <span className="text-rose-700">{inr(r.p.unexplained)} — no reason recorded</span> : r.reasons.length ? r.reasons.join(", ") : r.p.state === "awaiting" && r.c.settlement?.expectedBy ? `due ${fmtDate(r.c.settlement.expectedBy)}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.lastPaid || r.c.settlement?.expectedBy ? r.age : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={btn.link}>{r.p.state === "short_unexplained" ? "Explain" : "Open"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[12px] text-slate-500">
          Days = since the last payment (or since the expected date while nothing has arrived). Reasons settled for good: {SHORTFALL_KINDS.filter((k) => k.closed).map((k) => k.kind.toLowerCase()).join(", ")}. Kept open and chased: {SHORTFALL_KINDS.filter((k) => !k.closed).map((k) => k.kind.toLowerCase()).join(", ")}.
        </p>
      </div>
    </div>
  )
}
