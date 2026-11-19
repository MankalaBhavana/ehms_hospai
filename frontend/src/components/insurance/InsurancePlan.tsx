import { useMemo, useState } from "react"
import { CheckCircle2, Circle, ChevronDown, ArrowRight, Search, Printer, MinusCircle, Flag } from "lucide-react"
import { DESK_STEPS, stepEvidence, stepOf } from "./deskGuide"
import { PLAN, type ItemState, type PlanItem, type PlanStage } from "./planSteps"
import { StatusPill, useCases } from "./ui"
import { printPage } from "../../utils/insurancePrint"
import type { ComprehensiveClaimRecord } from "../../types/insurance"

type Nav = (module: string, caseId?: string) => void

interface Evaluated {
  stage: PlanStage
  stageIndex: number
  items: { item: PlanItem; state: ItemState; live?: string }[]
  done: number
  total: number
  isCurrent: boolean
  isBehind: boolean
}

function evaluate(c: ComprehensiveClaimRecord): Evaluated[] {
  const current = DESK_STEPS.findIndex((s) => s.id === stepOf(c).id)
  return PLAN.map((stage, i) => {
    const items = stage.items.map((item) => {
      const state = item.check(c)
      return { item, state, live: state === "todo" ? item.live?.(c) : undefined }
    })
    const counted = items.filter((x) => x.state !== "na")
    return {
      stage,
      stageIndex: i,
      items,
      done: counted.filter((x) => x.state === "done").length,
      total: counted.length,
      isCurrent: i === current,
      isBehind: i < current,
    }
  })
}

const stateIcon = (s: ItemState) =>
  s === "done" ? <CheckCircle2 size={17} className="text-emerald-500 shrink-0" /> : s === "na" ? <MinusCircle size={17} className="text-slate-300 shrink-0" /> : <Circle size={17} className="text-slate-300 shrink-0" />

/**
 * Step-by-step procedure for the insurance department. Pick a patient and every step is
 * ticked from that case's real data (documents verified, eligibility recorded, mails sent...),
 * with the next thing to do highlighted. With no patient picked it is the full procedure
 * plus a live count of how many cases are at each stage.
 */
export default function InsurancePlan({ onNavigate, initialCaseId }: { onNavigate?: Nav; initialCaseId?: string }) {
  const cases = useCases()
  const [picked, setPicked] = useState<string | undefined>(initialCaseId)
  const [search, setSearch] = useState("")
  const [openItem, setOpenItem] = useState<string>("")
  const [expandStage, setExpandStage] = useState<Record<string, boolean>>({})
  const [printAll, setPrintAll] = useState(false)

  const c = picked ? cases.find((x) => x.id === picked) : undefined
  const ev = useMemo(() => (c ? evaluate(c) : null), [c])

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    cases.forEach((x) => {
      const id = stepOf(x).id
      m[id] = (m[id] || 0) + 1
    })
    return m
  }, [cases])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cases
      .filter((x) => !q || `${x.patientName} ${x.id} ${x.patientId} ${x.policy.insurerName}`.toLowerCase().includes(q))
      .slice(0, 60)
  }, [cases, search])

  // The first undone step in order = "do this now".
  const next = useMemo(() => {
    if (!ev) return null
    for (const s of ev) for (const x of s.items) if (x.state === "todo") return { stage: s.stage, ...x }
    return null
  }, [ev])

  const totals = ev ? ev.reduce((a, s) => ({ done: a.done + s.done, total: a.total + s.total }), { done: 0, total: 0 }) : { done: 0, total: 0 }
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0

  const stageOpen = (s: Evaluated | PlanStage, i: number) => {
    const id = "stage" in s ? s.stage.id : s.id
    if (printAll) return true
    if (expandStage[id] !== undefined) return expandStage[id]
    return ev ? ev[i].isCurrent : i === 0
  }

  const renderItem = (item: PlanItem, state: ItemState | null, live?: string, isNext?: boolean) => {
    const key = item.id
    const open = printAll || openItem === key
    return (
      <li key={key} className={`rounded-xl border ${isNext ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200" : "border-slate-200 bg-white"}`}>
        <button type="button" onClick={() => setOpenItem(open && !printAll ? "" : key)} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer" aria-expanded={open}>
          {state ? stateIcon(state) : <Circle size={17} className="text-slate-300 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold ${state === "done" ? "text-slate-500 line-through decoration-slate-300" : state === "na" ? "text-slate-400" : "text-slate-900"}`}>{item.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{item.what}</div>
            {live && <div className="text-xs font-semibold text-amber-700 mt-1">{live}</div>}
            {state === "na" && <div className="text-[11px] text-slate-400 mt-0.5">Does not apply to this case.</div>}
          </div>
          {isNext && <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-600 text-white px-2 py-0.5 rounded-full shrink-0">Do this now</span>}
          <ChevronDown size={15} className={`text-slate-400 mt-0.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="px-3 pb-3 pl-[38px] space-y-2.5">
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">How to do it</div>
              <ol className="list-decimal pl-4 mt-1 space-y-1 text-[13px] text-slate-700 leading-relaxed">{item.how.map((h) => <li key={h}>{h}</li>)}</ol>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"><span className="font-bold text-slate-500">Who: </span>{item.who}</div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"><span className="font-bold text-slate-500">Where: </span>{item.where}</div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"><span className="font-bold text-slate-500">Why: </span>{item.why}</div>
            </div>
            {onNavigate && (
              <div className="flex flex-wrap gap-2" data-no-print>
                {c && (
                  <button type="button" onClick={() => onNavigate("insurance_claims", c.id)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                    Open this case <ArrowRight size={13} />
                  </button>
                )}
                {item.go && (
                  <button type="button" onClick={() => onNavigate(item.go!.module, c?.id)} className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg cursor-pointer">
                    {item.go.label}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]" data-print-root="insurance-plan">
      <div className="max-w-6xl mx-auto px-5 py-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Insurance step-by-step plan</h1>
            <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">
              The whole procedure in small steps. Pick a patient and each step is ticked from that case's real records, with the next action highlighted. Click any step for the exact clicks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrintAll(true)
              setTimeout(() => {
                printPage(c ? `Insurance plan - ${c.patientName} (${c.id})` : "Insurance step-by-step plan")
                setPrintAll(false)
              }, 150)
            }}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
            data-no-print
          >
            <Printer size={13} /> Print {c ? "this plan" : "procedure"}
          </button>
        </div>

        <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
          {/* ── patient picker ── */}
          <aside className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5 lg:sticky lg:top-3" data-no-print>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a patient or claim no." className="w-full pl-8 pr-2 h-9 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
            </div>
            <button
              type="button"
              onClick={() => setPicked(undefined)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${!picked ? "bg-slate-900 text-white" : "hover:bg-slate-50 text-slate-700"}`}
            >
              Whole procedure (no patient)
            </button>
            <div className="max-h-[56vh] overflow-y-auto space-y-1">
              {list.length === 0 && <div className="text-xs text-slate-400 px-2 py-4 text-center">No insurance cases yet. Open one under Intake &amp; Eligibility.</div>}
              {list.map((x) => {
                const e = evaluate(x)
                const t = e.reduce((a, s) => ({ d: a.d + s.done, t: a.t + s.total }), { d: 0, t: 0 })
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setPicked(x.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border cursor-pointer ${picked === x.id ? "border-blue-500 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}
                  >
                    <div className="text-xs font-bold text-slate-900 truncate">{x.patientName}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{x.id}</div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <StatusPill status={x.status} />
                      <span className="text-[10.5px] text-slate-400">{t.d}/{t.t} steps</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ── plan ── */}
          <main className="space-y-4 min-w-0">
            {c && ev ? (
              <>
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-base font-bold text-slate-900">{c.patientName}</div>
                      <div className="text-xs text-slate-500 font-mono">{c.id} · {c.policy.insurerName} · {c.claimType || "Cashless"}</div>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>{totals.done} of {totals.total} steps done</span>
                      <span className="font-bold text-slate-800">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
                  </div>
                  {next ? (
                    <div className="mt-3 flex items-start gap-2 text-sm bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                      <Flag size={15} className="text-blue-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-bold text-blue-900">Next: </span>
                        <span className="text-blue-900">{next.item.title}</span>
                        <span className="text-blue-700/80"> ({next.stage.title.replace(/^\d+\.\s*/, "")})</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2">Every step for this case is complete.</div>
                  )}
                </div>

                {ev.map((s, i) => {
                  const open = stageOpen(s, i)
                  const behindMissing = s.isBehind && !stepEvidence(c, s.stage.id)
                  return (
                    <section key={s.stage.id} className={`bg-white border rounded-2xl overflow-hidden ${s.isCurrent ? "border-blue-400" : "border-slate-200"}`}>
                      <button type="button" onClick={() => setExpandStage({ ...expandStage, [s.stage.id]: !open })} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-50" aria-expanded={open}>
                        <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${s.done === s.total && s.total > 0 ? "bg-emerald-500 text-white" : behindMissing ? "bg-amber-400 text-white" : s.isCurrent ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                          {s.done === s.total && s.total > 0 ? "✓" : behindMissing ? "!" : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-900">{s.stage.title}{s.isCurrent && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-blue-700">you are here</span>}</div>
                          <div className="text-xs text-slate-500">{s.stage.goal}</div>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{s.done}/{s.total}</span>
                        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 space-y-2">
                          {behindMissing && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">A later stage was reached before this one was fully recorded. Complete the open steps below.</div>}
                          <ul className="space-y-2">
                            {s.items.map((x) => renderItem(x.item, x.state, x.live, next?.item.id === x.item.id))}
                          </ul>
                          <div className="text-xs text-slate-500 pt-1"><span className="font-bold">To leave this stage:</span> {s.stage.exit}</div>
                        </div>
                      )}
                    </section>
                  )
                })}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" data-no-print>
                  {DESK_STEPS.map((s) => (
                    <div key={s.id} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Stage {s.n}</div>
                      <div className="text-xs font-bold text-slate-900 leading-tight">{s.title}</div>
                      <div className="text-lg font-extrabold text-slate-900 mt-1">{counts[s.id] || 0}<span className="text-xs font-medium text-slate-400 ml-1">case{(counts[s.id] || 0) === 1 ? "" : "s"} now</span></div>
                    </div>
                  ))}
                </div>
                {PLAN.map((stage, i) => {
                  const open = stageOpen(stage, i)
                  return (
                    <section key={stage.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                      <button type="button" onClick={() => setExpandStage({ ...expandStage, [stage.id]: !open })} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-50" aria-expanded={open}>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-900">{stage.title}</div>
                          <div className="text-xs text-slate-500">{stage.goal}</div>
                        </div>
                        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 space-y-2">
                          <ul className="space-y-2">{stage.items.map((item) => renderItem(item, null))}</ul>
                          <div className="text-xs text-slate-500 pt-1"><span className="font-bold">To leave this stage:</span> {stage.exit}</div>
                        </div>
                      )}
                    </section>
                  )
                })}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
