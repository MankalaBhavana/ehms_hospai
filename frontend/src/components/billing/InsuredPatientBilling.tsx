import { useEffect, useMemo, useRef, useState } from "react"
import { BedDouble, Download, Hourglass, IndianRupee, Search, ShieldCheck, Users, X } from "lucide-react"
import { BillingDatabase, type ClaimRecord, type PaymentRecord } from "../../services/billingDb"
import { BedDatabase, type BedRecord } from "../../services/bedDb"
import { ErDatabase } from "../../services/erDb"
import { db, type DBOPEncounter } from "../../services/db"
import { InsuranceEngineService as E, STATUS_META } from "../../services/insuranceDb"
import type { ComprehensiveClaimRecord, PatientPolicy } from "../../types/insurance"
import { toCsv } from "../../utils/policyCsv"
import { approvalOf, billView, type Approval, type BillView } from "../../utils/insuredBilling"
import { stayBenefit, type BedStay, type PolicyTerms, type StayBenefit } from "../../utils/policyBenefits"
import { daysUntil, fmtDate, fmtDateTime, inr, useCases, useNotify } from "../insurance/ui"
import { BillingHeader, KpiTile, PanelTitle, headerBtnSoft } from "./BillingChrome"

/**
 * Billing > Patients & Insurance, in the Billing house style (the same header, tinted KPI tiles and queue + workspace
 * split as IP Billing). Left: every patient with where they are, their insurance and what they owe. Right: the selected
 * patient's workspace - the policy and what it pays for the bed, what the policy gives for this stay, where the claim
 * stands, the bill, and the payment form.
 */

type Setting = "all" | "ip" | "icu" | "er" | "op" | "out"
type InsFilter = "all" | "insured" | "selfpay" | "approved" | "waiting" | "expired" | "due"

export interface Row {
  key: string
  umr: string
  name: string
  age?: number
  sex?: string
  phone?: string
  address?: string
  bloodGroup?: string
  registered?: string
  visits: number
  er: boolean
  bed: BedRecord | null
  icu: boolean
  op: DBOPEncounter | null
  policies: PatientPolicy[]
  policy?: PatientPolicy
  c?: ComprehensiveClaimRecord
  b?: ClaimRecord
  a?: Approval
  v?: BillView
  expired: boolean
}

const METHODS: PaymentRecord["paymentMethod"][] = ["Cash", "UPI / Digital", "Debit Card", "Credit Card", "Bank Transfer", "Cheque"]
const norm = (s?: string | null) => String(s || "").trim().toUpperCase()
const mono = "font-mono"

type Tone = "emerald" | "blue" | "amber" | "rose" | "slate" | "purple" | "sky"
const BADGE: Record<Tone, string> = {
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  amber: "bg-amber-100 text-amber-900 border-amber-200",
  rose: "bg-rose-100 text-rose-800 border-rose-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  purple: "bg-purple-100 text-purple-800 border-purple-200",
  sky: "bg-sky-100 text-sky-800 border-sky-200",
}
const Badge = ({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) => (
  <span className={`inline-block text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 border whitespace-nowrap ${BADGE[tone]}`}>{children}</span>
)
const APPROVAL_TONE: Record<Approval["kind"], Tone> = { claim: "emerald", preauth: "blue", waiting: "amber", none: "slate", rejected: "rose" }

const who = () => {
  try {
    const u = JSON.parse(localStorage.getItem("hospai_current_user") || "null")
    return String(u?.name || u?.user || "Billing Counter")
  } catch {
    return "Billing Counter"
  }
}

const validity = (p: PatientPolicy): { tone: Tone; text: string; expired: boolean } => {
  if (p.status === "Inactive") return { tone: "slate", text: "Inactive", expired: true }
  if (!p.validUntil || Number.isNaN(new Date(p.validUntil).getTime())) return { tone: "slate", text: "No end date", expired: false }
  const d = daysUntil(p.validUntil)
  return d < 0 ? { tone: "rose", text: "Expired", expired: true } : d <= 30 ? { tone: "amber", text: "Expiring soon", expired: false } : { tone: "emerald", text: "Valid", expired: false }
}

const dayCount = (iso?: string | null) => (iso ? Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 1)
const bedLabel = (b: BedRecord) => [b.ward, b.room_no && `Room ${b.room_no}`, b.bed_no && `Bed ${b.bed_no}`].filter(Boolean).join(" · ")
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")

/** The five stages of a cashless claim, for the progress tracker. */
const STAGES = ["Eligibility", "Pre-Auth", "Treatment", "Claim", "Settlement"] as const

export default function InsuredPatientBilling({ onOpenBill, onOpenInsurance, initialUmr }: { onOpenBill?: (billId: string) => void; onOpenInsurance?: (caseId: string) => void; initialUmr?: string }) {
  const cases = useCases()
  const { notify, toastNode } = useNotify()
  const [tick, setTick] = useState(0)
  const [setting, setSetting] = useState<Setting>("all")
  const [ins, setIns] = useState<InsFilter>("all")
  const [q, setQ] = useState("")
  const [sel, setSel] = useState<string | null>(initialUmr ? norm(initialUmr) : null)

  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const offs = [BillingDatabase.onUpdate(bump), db.subscribe(bump)]
    window.addEventListener("storage", bump)
    const t = window.setInterval(bump, 20000)
    return () => {
      offs.forEach((o) => o?.())
      window.removeEventListener("storage", bump)
      window.clearInterval(t)
    }
  }, [])

  const rows: Row[] = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const patients = db.getPatients()
    const encounters = db.getEncounters()
    const erNow = new Set<string>()
    try {
      ErDatabase.getVisits("active").forEach((v) => v.patient_id && erNow.add(norm(v.patient_id)))
    } catch {
      /* no ER data */
    }
    const bedOf = new Map<string, BedRecord>()
    try {
      BedDatabase.getBeds().forEach((b) => b.status === "Occupied" && b.patient_id && bedOf.set(norm(b.patient_id), b))
    } catch {
      /* no bed data */
    }
    const policiesBy = new Map<string, PatientPolicy[]>()
    E.getAllPatientPolicies().forEach((p) => policiesBy.set(norm(p.patientId), [...(policiesBy.get(norm(p.patientId)) || []), p]))
    const caseBy = new Map<string, ComprehensiveClaimRecord>()
    const caseList = [...cases].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    for (const c of caseList) for (const id of [norm(c.patientId), norm(c.mrn)]) if (id && (!caseBy.has(id) || (caseBy.get(id)!.status === "CLOSED" && c.status !== "CLOSED"))) caseBy.set(id, c)
    const bills = new Map(BillingDatabase.getClaims().map((b) => [b.id, b]))
    const visitsBy = new Map<string, DBOPEncounter[]>()
    encounters.forEach((e) => visitsBy.set(norm(e.umr), [...(visitsBy.get(norm(e.umr)) || []), e]))

    const out: Row[] = []
    const seen = new Set<string>()
    const add = (umr: string, base: Partial<Row>) => {
      const k = norm(umr)
      if (!k || seen.has(k)) return
      seen.add(k)
      const visits = visitsBy.get(k) || []
      const opToday = visits.find((e) => String(e.createdAt || e.date || "").slice(0, 10) === today && e.status !== "OP Completed") || null
      const bed = bedOf.get(k) || null
      const policies = policiesBy.get(k) || []
      const c = caseBy.get(k)
      const b = c?.billingClaimId ? bills.get(c.billingClaimId) : undefined
      const used = c ? policies.find((p) => p.policyNumber === c.policy.policyNumber) : undefined
      const policy = used || policies.find((p) => p.status === "Active") || policies[0]
      const a = c ? approvalOf(c) : undefined
      const v = c && b && b.status !== "Voided" ? billView(c, b) : undefined
      out.push({
        key: k, umr, name: base.name || "Unknown", age: base.age, sex: base.sex, phone: base.phone, address: base.address, bloodGroup: base.bloodGroup, registered: base.registered,
        visits: visits.length, er: erNow.has(k), bed, icu: !!bed && (bed.bed_type === "ICU" || /icu/i.test(bed.ward || "")), op: opToday,
        policies, policy, c, b: v ? b : undefined, a, v, expired: policies.length > 0 && policies.every((p) => validity(p).expired),
      })
    }
    patients.forEach((p) => add(p.umr, { name: p.name, age: p.age, sex: p.sex, phone: p.phone, address: p.address, bloodGroup: p.bloodGroup, registered: p.createdAt }))
    caseList.forEach((c) => add(c.patientId, { name: c.patientName, age: c.age, sex: c.gender, phone: c.phone }))
    bedOf.forEach((b) => add(b.patient_id!, { name: [b.patient_name, b.patient_last_name].filter(Boolean).join(" "), age: b.patient_age ?? undefined, sex: b.patient_gender ?? undefined, phone: b.patient_phone ?? undefined }))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, tick])

  const inSetting = (r: Row, s: Setting) => (s === "all" ? true : s === "ip" ? !!r.bed && !r.icu : s === "icu" ? r.icu : s === "er" ? r.er : s === "op" ? !!r.op : !r.er && !r.bed && !r.op)
  const insured = (r: Row) => r.policies.length > 0 || !!r.c
  const inIns = (r: Row, f: InsFilter) =>
    f === "all" ? true : f === "insured" ? insured(r) : f === "selfpay" ? !insured(r) : f === "approved" ? (r.a?.amount ?? 0) > 0 : f === "waiting" ? r.a?.kind === "waiting" || (!!r.c && r.a?.kind === "none") : f === "expired" ? r.expired : !!r.v?.canCollect

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows
      .filter((r) => inSetting(r, setting) && inIns(r, ins))
      .filter((r) => !t || [r.name, r.umr, r.phone, r.policy?.insurerName, r.policy?.policyNumber, r.policy?.memberId, r.b?.invoiceNo, r.bed?.bed_no, r.bed?.ward].filter(Boolean).join(" ").toLowerCase().includes(t))
      .sort((a, b) => (b.v?.due ?? 0) - (a.v?.due ?? 0) || Number(!!b.bed || b.er) - Number(!!a.bed || a.er) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, setting, ins, q])

  // Always have a patient open: the first in the list when nothing (or something filtered out) is selected.
  useEffect(() => {
    if (!shown.length) return setSel(null)
    if (!sel || !shown.some((r) => r.key === sel)) setSel(shown[0].key)
  }, [shown, sel])
  const open = sel ? rows.find((r) => r.key === sel) : undefined

  const totals = useMemo(() => {
    const inHosp = rows.filter((r) => r.er || r.bed)
    return {
      all: rows.length,
      inHosp: inHosp.length,
      er: rows.filter((r) => r.er).length,
      ip: rows.filter((r) => r.bed && !r.icu).length,
      icu: rows.filter((r) => r.icu).length,
      op: rows.filter((r) => r.op).length,
      out: rows.filter((r) => inSetting(r, "out")).length,
      insuredIn: inHosp.filter(insured).length,
      approved: rows.reduce((a, r) => a + (r.a?.amount ?? 0), 0),
      approvedN: rows.filter((r) => (r.a?.amount ?? 0) > 0).length,
      due: rows.reduce((a, r) => a + (r.v?.canCollect ? r.v.due : 0), 0),
      dueN: rows.filter((r) => r.v?.canCollect).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const exportCsv = () => {
    const head = ["Patient", "UMR", "Age", "Sex", "Phone", "Where now", "Insurer", "TPA", "Policy number", "Member ID", "Valid until", "Bed limit per day", "ICU limit per day", "Co-pay %", "Sum insured", "Balance", "Approval", "Approved amount", "Due now"]
    const lines = shown.map((r) => [r.name, r.umr, r.age ?? "", r.sex ?? "", r.phone ?? "", r.er ? "ER" : r.bed ? bedLabel(r.bed) : r.op ? "OP today" : "", r.policy?.insurerName ?? "", r.policy?.tpaName ?? "", r.policy?.policyNumber ?? "", r.policy?.memberId ?? "", r.policy?.validUntil?.slice(0, 10) ?? "", r.policy?.roomRentPerDay || "", r.policy?.icuRentPerDay || "", r.policy?.copayPercentage || "", r.policy?.sumInsured || "", r.policy?.balanceAvailable || "", r.a?.label ?? "", r.a?.amount || "", r.v?.canCollect ? r.v.due : ""])
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([toCsv(head, lines)], { type: "text/csv;charset=utf-8" }))
    a.download = `patients-and-insurance-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    notify(`${lines.length} patient${lines.length === 1 ? "" : "s"} exported.`)
  }

  const pill = (on: boolean) => `px-2.5 py-1 text-[11px] font-bold border transition-colors cursor-pointer ${on ? "bg-blue-600 border-blue-700 text-white" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"}`
  const SETTINGS: [Setting, string, number][] = [["all", "All", totals.all], ["ip", "Ward", totals.ip], ["icu", "ICU", totals.icu], ["er", "ER", totals.er], ["op", "OP today", totals.op], ["out", "Not in hospital", totals.out]]
  const INS: [InsFilter, string][] = [["all", "Everyone"], ["insured", "Insured"], ["selfpay", "Self-pay"], ["approved", "Approved"], ["waiting", "Waiting"], ["expired", "Policy expired"], ["due", "Owes a share"]]

  return (
    <div className="flex flex-col h-full bg-[#F1F5F9] text-slate-900 overflow-hidden">
      {toastNode}
      <BillingHeader
        icon={Users}
        title="Patients & Insurance"
        pill="All patients"
        subtitle="Where each patient is, their insurance policy and what it pays, what the insurer approved, and what the patient owes."
        actions={
          <button type="button" onClick={exportCsv} disabled={!shown.length} className={`${headerBtnSoft} disabled:opacity-40`}>
            <Download size={13} /> Export CSV
          </button>
        }
      />

      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile tone="blue" icon={Users} label="Patients on record" value={totals.all} sub={`${totals.insuredIn} insured in hospital`} onClick={() => (setSetting("all"), setIns("all"))} />
          <KpiTile tone="sky" icon={BedDouble} label="In hospital now" value={totals.inHosp} sub={`ER ${totals.er} · Ward ${totals.ip} · ICU ${totals.icu}`} onClick={() => setSetting("ip")} />
          <KpiTile tone="purple" icon={ShieldCheck} label="Approved by insurers" value={inr(totals.approved)} sub={`${totals.approvedN} patient${totals.approvedN === 1 ? "" : "s"}`} onClick={() => setIns("approved")} />
          <KpiTile tone="amber" icon={Hourglass} label="Patients owe" value={inr(totals.due)} sub={`${totals.dueN} patient${totals.dueN === 1 ? "" : "s"} to collect from`} onClick={() => setIns("due")} />
        </div>

        {/* Search + filters */}
        <div className="bg-white border border-[#CBD5E1] shadow-2xs p-3 space-y-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[13px] font-bold text-slate-900 shrink-0">
              <Search size={17} className="text-blue-600" /> Patient Search
            </div>
            <div className="relative flex-1">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, UMR, phone, insurer, policy number, bed or invoice…"
                aria-label="Search patients"
                className="w-full pl-8 pr-8 h-9 bg-slate-50 border border-[#CBD5E1] text-[12.5px] font-medium text-slate-900 focus:bg-white focus:outline-none focus:border-blue-600 shadow-2xs"
              />
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              {q && (
                <button type="button" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mr-1">Where:</span>
              {SETTINGS.map(([v, l, n]) => (
                <button key={v} type="button" onClick={() => setSetting(v)} className={pill(setting === v)}>
                  {l} <span className="font-mono opacity-80">{n}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mr-1">Insurance:</span>
              {INS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setIns(v)} className={pill(ins === v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Queue + workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-4 bg-white border border-[#CBD5E1] shadow-2xs flex flex-col lg:max-h-[calc(100vh-330px)] overflow-hidden">
            <PanelTitle title="Patients" count={shown.length} />
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {shown.length === 0 && <div className="p-6 text-center text-[12px] text-slate-500">{rows.length === 0 ? "No patients yet." : "No patient matches these filters."}</div>}
              {shown.map((r) => (
                <QueueCard key={r.key} r={r} active={r.key === sel} onClick={() => setSel(r.key)} />
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 min-w-0">
            {open ? (
              <PatientWorkspace r={open} notify={notify} onOpenBill={onOpenBill} onOpenInsurance={onOpenInsurance} />
            ) : (
              <div className="bg-white border border-[#CBD5E1] p-12 text-center shadow-2xs">
                <Users size={34} className="mx-auto text-slate-300 mb-3" />
                <h3 className="font-bold text-slate-800 text-base">No patient selected</h3>
                <p className="text-slate-500 text-xs mt-1">Pick a patient from the list to see their policy, approval and bill.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── a patient in the queue ───────────────────────────────────────────────────────────────────────────

function QueueCard({ r, active, onClick }: { r: Row; active: boolean; onClick: () => void }) {
  const val = r.policy ? validity(r.policy) : null
  const bal = r.v?.canCollect ? r.v.due : 0
  return (
    <div onClick={onClick} className={`p-3 cursor-pointer transition-colors border-l-4 ${active ? "bg-blue-50/80 border-blue-600" : "border-transparent hover:bg-slate-50"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-bold text-[13px] text-slate-900 truncate" title={r.name}>
          {r.name}
        </span>
        <span className="flex gap-1 shrink-0">
          {r.er && <Badge tone="rose">ER</Badge>}
          {r.bed && <Badge tone={r.icu ? "purple" : "blue"}>{r.icu ? "ICU" : "Ward"}</Badge>}
          {r.op && !r.bed && !r.er && <Badge>OP</Badge>}
        </span>
      </div>
      <div className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
        {r.umr}
        {r.age ? ` · ${r.age}y` : ""}
        {r.sex ? ` · ${r.sex[0]}` : ""}
        {r.phone ? ` · ${r.phone}` : ""}
      </div>
      {r.bed && (
        <div className="text-[10.5px] text-indigo-900 font-medium mt-0.5 flex items-center gap-1 truncate">
          <BedDouble size={11} className="text-indigo-600 shrink-0" />
          {bedLabel(r.bed)} · day {dayCount(r.bed.admission_date)}
        </div>
      )}
      {r.policy ? (
        <div className="text-[10.5px] text-purple-900 font-medium mt-0.5 flex items-center gap-1 truncate">
          <ShieldCheck size={11} className="text-purple-600 shrink-0" />
          {r.policy.insurerName} · {r.policy.policyNumber}
          {val && val.tone !== "emerald" && <span className={val.tone === "rose" ? "text-rose-700" : "text-amber-700"}>· {val.text}</span>}
        </div>
      ) : (
        <div className="text-[10.5px] text-slate-500 mt-0.5">Self-pay · no insurance on record</div>
      )}
      {r.policy && (
        <div className="text-[10.5px] text-slate-500 mt-0.5 truncate">
          {r.policy.roomRentPerDay ? `Bed ${inr(r.policy.roomRentPerDay)}/day` : "Bed no cap"}
          {r.policy.copayPercentage ? ` · Co-pay ${r.policy.copayPercentage}%` : ""}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{r.a ? <span className={r.a.amount ? "text-slate-700" : ""}>{r.a.amount ? `Approved ${inr(r.a.amount)}` : r.a.label}</span> : "—"}</span>
        <span className={`font-mono font-bold text-[12.5px] ${bal > 0 ? "text-amber-900" : "text-slate-400"}`}>{bal > 0 ? inr(bal) : r.v?.running ? "at discharge" : r.v?.billed ? "Settled" : r.v ? "Not billed yet" : ""}</span>
      </div>
    </div>
  )
}

// ── the selected patient ─────────────────────────────────────────────────────────────────────────────

const Fact = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => (
  <div className="px-4 py-3 border-r border-b border-[#E2E8F0] min-w-0">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-[13.5px] font-bold text-slate-900 mt-0.5 truncate" title={typeof value === "string" ? value : undefined}>
      {value}
    </div>
    {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
  </div>
)

const Cell = ({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "key" }) => (
  <div className={`px-4 py-2.5 border-r border-b border-[#E2E8F0] min-w-0 ${tone === "key" ? "bg-blue-50/60" : ""}`}>
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-[13px] font-semibold text-slate-900 mt-0.5 truncate">{children}</div>
  </div>
)

export function PatientWorkspace({ r, notify, onOpenBill, onOpenInsurance }: { r: Row; notify: ReturnType<typeof useNotify>["notify"]; onOpenBill?: (id: string) => void; onOpenInsurance?: (id: string) => void }) {
  const { c, b, a, v } = r
  const [polKey, setPolKey] = useState<string | null>(null)
  const pol = r.policies.find((p) => p.id === polKey) || r.policy
  const val = pol ? validity(pol) : null

  // The stay, from the bill's room lines when there is a bill, else from the bed the patient is in now.
  const stay = useMemo(() => {
    if (!pol && !c) return null
    const bill = b ?? (c?.billingClaimId ? BillingDatabase.getClaimById(c.billingClaimId) : undefined)
    const beds: BedStay[] = []
    let other = 0
    if (bill && bill.items.length) {
      for (const it of bill.items) {
        if (/room|bed/i.test(String(it.category))) {
          const days = Math.max(1, Number(it.quantity) || 1)
          const icu = /icu|ccu|nicu|picu|hdu/i.test(`${it.description} ${it.category}`)
          beds.push({ kind: icu ? "icu" : "room", label: it.description, perDay: Math.round((Number(it.total) || 0) / days), days })
        } else other += Number(it.total) || 0
      }
    } else if (r.bed) {
      beds.push({ kind: r.icu ? "icu" : "room", label: bedLabel(r.bed), perDay: Number(r.bed.daily_rate) || 0, days: dayCount(r.bed.admission_date) })
    }
    if (!beds.length && other === 0) return null
    const terms: PolicyTerms = { roomRentPerDay: pol?.roomRentPerDay ?? c?.policy.roomRentPerDay, icuRentPerDay: pol?.icuRentPerDay ?? c?.policy.icuRentPerDay, copayPct: pol?.copayPercentage ?? c?.policy.copayPercentage, approved: c?.approvedPreAuthAmount, balance: pol?.balanceAvailable ?? c?.policy.balanceAvailable, sumInsured: pol?.sumInsured ?? c?.policy.sumInsured }
    return { benefit: stayBenefit({ beds, otherCharges: other, terms }), fromBill: !!bill }
  }, [r, c, b, pol])

  const stageIdx = c ? Math.min(4, STAGES.indexOf(STATUS_META[c.status].group as (typeof STAGES)[number])) : -1
  const closed = c?.status === "CLOSED"

  return (
    <div className="space-y-4">
      {/* Patient + amount owed */}
      <section className="bg-white border border-[#CBD5E1] shadow-2xs">
        <div className="px-5 py-4 flex flex-wrap items-start gap-4">
          <div className="w-12 h-12 bg-blue-600 text-white flex items-center justify-center text-[15px] font-bold shrink-0">{initials(r.name)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[19px] font-bold text-slate-900 leading-tight">{r.name}</h2>
              <span className="font-mono text-[11.5px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-slate-700">{r.umr}</span>
              {r.er && <Badge tone="rose">In ER</Badge>}
              {r.bed && <Badge tone={r.icu ? "purple" : "blue"}>{r.icu ? "ICU" : "Ward"}</Badge>}
              {r.op && !r.bed && !r.er && <Badge>OP today</Badge>}
              {!r.er && !r.bed && !r.op && <Badge>Not in hospital</Badge>}
            </div>
            <div className="text-[12.5px] text-slate-600 mt-1">
              {[r.age ? `${r.age} yrs` : "", r.sex, r.bloodGroup, r.phone].filter(Boolean).join(" · ")}
              {r.address ? <span className="text-slate-500"> · {r.address}</span> : null}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Patient owes</div>
            <div className={`font-mono text-[28px] font-bold leading-tight ${v?.canCollect ? "text-amber-700" : "text-slate-400"}`}>{v?.canCollect ? inr(v.due) : v?.running ? "At discharge" : v ? "Nil" : "—"}</div>
            <div className="flex gap-2 justify-end mt-2">
              {c && onOpenInsurance && (
                <button type="button" onClick={() => onOpenInsurance(c.id)} className="px-3 h-8 bg-white border border-[#CBD5E1] hover:border-blue-600 hover:text-blue-700 text-slate-700 text-[12px] font-bold cursor-pointer inline-flex items-center gap-1.5">
                  <ShieldCheck size={13} /> Insurance case
                </button>
              )}
              {b && onOpenBill && (
                <button type="button" onClick={() => onOpenBill(b.id)} className="px-3 h-8 bg-white border border-[#CBD5E1] hover:border-blue-600 hover:text-blue-700 text-slate-700 text-[12px] font-bold cursor-pointer inline-flex items-center gap-1.5">
                  <IndianRupee size={13} /> Open bill
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border-t border-[#E2E8F0] bg-slate-50/60">
          <Fact label="Now" value={r.er ? "In ER" : r.bed ? (r.icu ? "ICU" : "Ward") : r.op ? "OP visit" : "—"} sub={r.bed ? bedLabel(r.bed) : r.op?.dept} />
          <Fact label="Admitted" value={r.bed?.admission_date ? fmtDate(r.bed.admission_date) : "—"} sub={r.bed ? `Day ${dayCount(r.bed.admission_date)}` : undefined} />
          <Fact label="Doctor" value={c?.attendingDoctor || r.op?.assignedDoctor || "—"} />
          <Fact label="Insurer" value={pol?.insurerName || "Self-pay"} sub={pol?.tpaName} />
          <Fact label="Approved" value={a?.amount ? inr(a.amount) : "—"} sub={a?.label} />
          <Fact label="OP visits" value={String(r.visits)} sub={r.registered ? `since ${fmtDate(r.registered)}` : undefined} />
        </div>
      </section>

      {/* Policy */}
      <section className="bg-white border border-[#CBD5E1] shadow-2xs">
        <PanelTitle
          title="Insurance policy"
          count={r.policies.length}
          actions={
            r.policies.length > 1 ? (
              <div className="flex gap-1">
                {r.policies.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPolKey(p.id)} className={`px-2 py-0.5 text-[10.5px] font-bold border cursor-pointer ${pol?.id === p.id ? "bg-blue-600 border-blue-700 text-white" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"}`}>
                    {p.insurerName}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
        {!pol ? (
          <div className="px-5 py-6 text-[13px] text-slate-600">No insurance policy is on record for this patient. They pay the bill themselves (self-pay).</div>
        ) : (
          <>
            <div className="px-5 pt-3 pb-2 flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-bold text-slate-900">{pol.insurerName}</span>
              {pol.tpaName && <span className="text-[12px] text-slate-500">via {pol.tpaName}</span>}
              {val && <Badge tone={val.tone}>{val.text}</Badge>}
              {c && pol.policyNumber === c.policy.policyNumber && <Badge tone="blue">Used for this admission</Badge>}
              {pol.lastVerification ? <Badge tone={pol.lastVerification.status === "Eligible" ? "emerald" : "amber"}>{pol.lastVerification.status}</Badge> : <Badge tone="amber">Not verified</Badge>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border-t border-[#E2E8F0]">
              <Cell label="Policy no.">
                <span className={mono}>{pol.policyNumber}</span>
              </Cell>
              <Cell label="Member ID">
                <span className={mono}>{pol.memberId || "—"}</span>
              </Cell>
              <Cell label="Policy holder">
                {pol.policyHolderName || pol.patientName} ({pol.relationship})
              </Cell>
              <Cell label="Valid until">{pol.validUntil ? fmtDate(pol.validUntil) : "—"}</Cell>
            </div>
            <div className="border-t border-[#E2E8F0]">
              <div className="px-4 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-blue-900">What this policy pays</div>
              <div className="grid grid-cols-2 md:grid-cols-4">
                <Cell label="Bed (room) rent / day" tone="key">
                  <span className={mono}>{pol.roomRentPerDay ? inr(pol.roomRentPerDay) : "No cap"}</span>
                </Cell>
                <Cell label="ICU rent / day" tone="key">
                  <span className={mono}>{pol.icuRentPerDay ? inr(pol.icuRentPerDay) : "No cap"}</span>
                </Cell>
                <Cell label="Patient's co-pay" tone="key">
                  <span className={mono}>{pol.copayPercentage ? `${pol.copayPercentage}%` : "None"}</span>
                </Cell>
                <Cell label="Sum insured / balance" tone="key">
                  <span className={mono}>{pol.sumInsured ? `${inr(pol.sumInsured)} / ${inr(pol.balanceAvailable)}` : "—"}</span>
                </Cell>
              </div>
            </div>
          </>
        )}
      </section>

      {/* What the policy gives for this stay */}
      {stay && <StayCard benefit={stay.benefit} fromBill={stay.fromBill} />}

      {/* Where the claim stands */}
      {c && a && (
        <section className="bg-white border border-[#CBD5E1] shadow-2xs">
          <PanelTitle title="Insurer approval" actions={<Badge tone={APPROVAL_TONE[a.kind]}>{a.label}</Badge>} />
          <div className="px-5 pt-4">
            <div className="flex gap-1">
              {STAGES.map((s, i) => (
                <div key={s} className="flex-1 min-w-0">
                  <div className={`h-1.5 ${closed || i < stageIdx ? "bg-emerald-600" : i === stageIdx ? "bg-blue-600" : "bg-slate-200"}`} />
                  <div className={`text-[11px] mt-1 truncate ${closed || i < stageIdx ? "text-emerald-700 font-semibold" : i === stageIdx ? "text-blue-700 font-bold" : "text-slate-400"}`}>
                    {closed || i < stageIdx ? "✓ " : ""}
                    {s}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[12px] text-slate-600 mt-2">
              Now: <strong className="text-slate-900">{STATUS_META[c.status].label}</strong>. {a.detail}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 mt-3 border-t border-[#E2E8F0]">
            <Cell label="Approved amount">
              <span className={`${mono} text-[15px]`}>{a.amount ? inr(a.amount) : "—"}</span>
            </Cell>
            <Cell label="Approval code">
              <span className={mono}>{a.code || "—"}</span>
            </Cell>
            <Cell label="Requested">
              <span className={mono}>{c.preAuth?.requestedAmount ? inr(c.preAuth.requestedAmount) : "—"}</span>
            </Cell>
            <Cell label="Enhancements">{c.preAuth?.enhancements?.length ? c.preAuth.enhancements.map((e) => `${inr(e.amount)} ${e.status.toLowerCase()}`).join(", ") : "None"}</Cell>
          </div>
        </section>
      )}

      {/* Bill + payment */}
      {b && v ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <section className="bg-white border border-[#CBD5E1] shadow-2xs">
            <PanelTitle title={`Bill ${b.invoiceNo || ""}`} />
            <div className="divide-y divide-slate-100 px-5">
              {[
                ["Bill total", inr(v.total), ""],
                ["Insurer pays", v.billed ? inr(v.insurerShare) : "Not split yet", "text-blue-800"],
                ["Patient's share", v.billed ? inr(v.patientShare) : v.expectedPatientShare !== null ? `~${inr(v.expectedPatientShare)} (estimate)` : "—", ""],
                ["Already paid", inr(v.paid), "text-emerald-700"],
                ["Due now", v.canCollect ? inr(v.due) : v.running ? "At discharge" : "Nil", v.canCollect ? "text-amber-800 text-[15px]" : ""],
              ].map(([k, val, cls]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="text-[12.5px] text-slate-500">{k}</span>
                  <span className={`font-mono font-bold text-[13px] text-slate-900 ${cls}`}>{val}</span>
                </div>
              ))}
            </div>
            {v.beyondCover > 0 && (
              <p className="mx-5 mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2">
                {inr(v.beyondCover)} of this bill is above the insurer's limit ({v.limitBasis}). The insurer will not pay it; make sure it is in the patient's share.
              </p>
            )}
            {(b.payments?.length ?? 0) > 0 && (
              <div className="border-t border-[#E2E8F0]">
                <div className="px-5 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Payments taken ({b.payments.length})</div>
                <ul className="divide-y divide-slate-100 px-5 pb-2">
                  {b.payments.map((p) => (
                    <li key={p.id} className="py-2 flex items-center gap-3 text-[12.5px]">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-slate-900">{p.receiptNo}</div>
                        <div className="text-slate-500 truncate">
                          {fmtDateTime(p.paymentDate)} · {p.paymentMethod}
                          {p.collectedBy ? ` · ${p.collectedBy}` : ""}
                        </div>
                      </div>
                      <span className={`font-mono font-bold ${p.amount < 0 ? "text-rose-700" : "text-emerald-700"}`}>{inr(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="bg-white border border-[#CBD5E1] shadow-2xs">
            <PanelTitle title="Take payment" />
            <div className="p-5">{v.canCollect ? <CollectForm b={b} due={v.due} notify={notify} /> : <p className="text-[12.5px] text-slate-600 bg-slate-50 border border-slate-200 px-3 py-2">{v.why || "Nothing to collect on this bill."}</p>}</div>
          </section>
        </div>
      ) : (
        !r.bed &&
        !r.er &&
        r.policies.length > 0 && <p className="text-[12.5px] text-slate-600 bg-white border border-[#CBD5E1] px-4 py-3 shadow-2xs">Insurance applies to admissions. OP visits are paid by the patient at the OP counter.</p>
      )}
    </div>
  )
}

// ── what the policy gives for this stay: a bar plus the line-by-line table ─────────────────────────────

function StayCard({ benefit, fromBill }: { benefit: StayBenefit; fromBill: boolean }) {
  const total = Math.max(1, benefit.billTotal)
  const parts = [
    { label: "Insurer pays", n: benefit.insurerShare, cls: "bg-blue-600", text: "text-blue-800" },
    { label: "Bed above the daily limit", n: benefit.bedExcess, cls: "bg-rose-500", text: "text-rose-700" },
    { label: `Co-pay (${benefit.copayPct}%)`, n: benefit.copayAmount, cls: "bg-amber-500", text: "text-amber-800" },
    { label: "Above the insurer's limit", n: benefit.beyondLimit, cls: "bg-purple-500", text: "text-purple-800" },
  ].filter((p) => p.n > 0)
  return (
    <section className="bg-white border border-[#CBD5E1] shadow-2xs">
      <PanelTitle title="What the policy gives for this stay" />
      <div className="px-5 pt-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Insurer pays</div>
            <div className="font-mono text-[22px] font-bold text-blue-800 leading-tight">{inr(benefit.insurerShare)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Patient pays</div>
            <div className="font-mono text-[22px] font-bold text-amber-700 leading-tight">{inr(benefit.patientShare)}</div>
          </div>
        </div>
        <div className="flex h-3 w-full border border-slate-300 bg-slate-100 mt-2" role="img" aria-label="Split of the bill between insurer and patient">
          {parts.map((p) => (
            <div key={p.label} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${inr(p.n)}`} />
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-slate-600">
          {parts.map((p) => (
            <li key={p.label} className="inline-flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 ${p.cls}`} />
              {p.label}: <span className={`font-mono font-bold ${p.text}`}>{inr(p.n)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 border-t border-[#E2E8F0] overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[520px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 border-b border-[#E2E8F0]">
              <th className="px-5 py-2">Charge</th>
              <th className="px-3 py-2 text-right">Charged</th>
              <th className="px-3 py-2 text-right">Insurer pays</th>
              <th className="px-5 py-2 text-right">Patient pays</th>
            </tr>
          </thead>
          <tbody>
            {benefit.beds.map((bd, i) => (
              <tr key={i} className="border-b border-slate-100 align-top">
                <td className="px-5 py-2.5">
                  <div className="font-semibold text-slate-900">{bd.kind === "icu" ? "ICU bed" : "Bed / room"}</div>
                  <div className="text-[11.5px] text-slate-500">
                    <span className="font-mono">{inr(bd.perDay)}</span>/day × {bd.days} day{bd.days === 1 ? "" : "s"}
                  </div>
                  <div className={`text-[11.5px] ${bd.excessPerDay > 0 ? "text-rose-700 font-bold" : "text-slate-500"}`}>{bd.limitPerDay !== null ? `Policy allows ${inr(bd.limitPerDay)}/day${bd.excessPerDay > 0 ? ` — ${inr(bd.excessPerDay)}/day above` : ""}` : "No daily cap on this policy"}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{inr(bd.perDay * bd.days)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-blue-800">{inr(bd.coveredTotal)}</td>
                <td className="px-5 py-2.5 text-right font-mono">{bd.excessTotal > 0 ? <span className="text-rose-700 font-bold">{inr(bd.excessTotal)}</span> : "—"}</td>
              </tr>
            ))}
            <tr className="border-b border-slate-100">
              <td className="px-5 py-2.5 text-slate-900">Investigations, procedures, medicines and the rest</td>
              <td className="px-3 py-2.5 text-right font-mono">{inr(benefit.otherCharges)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-blue-800">{inr(benefit.otherCharges)}</td>
              <td className="px-5 py-2.5 text-right text-slate-400">—</td>
            </tr>
            {benefit.copayAmount > 0 && (
              <tr className="border-b border-slate-100">
                <td className="px-5 py-2.5 text-slate-900">Co-pay clause ({benefit.copayPct}%)</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right font-mono text-blue-800">−{inr(benefit.copayAmount)}</td>
                <td className="px-5 py-2.5 text-right font-mono text-amber-800 font-bold">{inr(benefit.copayAmount)}</td>
              </tr>
            )}
            {benefit.beyondLimit > 0 && (
              <tr className="border-b border-slate-100">
                <td className="px-5 py-2.5 text-slate-900">
                  Above the insurer's limit
                  <div className="text-[11.5px] text-slate-500">
                    {inr(benefit.limit ?? 0)} ({benefit.limitBasis})
                  </div>
                </td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right font-mono text-blue-800">−{inr(benefit.beyondLimit)}</td>
                <td className="px-5 py-2.5 text-right font-mono text-purple-800 font-bold">{inr(benefit.beyondLimit)}</td>
              </tr>
            )}
            <tr className="bg-slate-50 font-bold">
              <td className="px-5 py-3 text-slate-900">Total</td>
              <td className="px-3 py-3 text-right font-mono">{inr(benefit.billTotal)}</td>
              <td className="px-3 py-3 text-right font-mono text-blue-800">{inr(benefit.insurerShare)}</td>
              <td className="px-5 py-3 text-right font-mono text-amber-800">{inr(benefit.patientShare)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-5 py-2.5 text-[11.5px] text-slate-500 border-t border-[#E2E8F0]">
        {fromBill ? "Worked out from the charges on the patient's bill." : "Worked out from the bed the patient is in now; other charges are added as the bill grows."} An estimate from the policy terms; the insurer's decision on the claim governs.
      </p>
    </section>
  )
}

// ── payment ──────────────────────────────────────────────────────────────────────────────────────────

const inputCls = "w-full h-9 px-3 bg-white border border-[#CBD5E1] text-[13px] text-slate-900 focus:outline-none focus:border-blue-600 shadow-2xs"
const lbl = "block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1"

function CollectForm({ b, due, notify }: { b: ClaimRecord; due: number; notify: ReturnType<typeof useNotify>["notify"] }) {
  const [amount, setAmount] = useState(due)
  const [method, setMethod] = useState<PaymentRecord["paymentMethod"]>("Cash")
  const [ref, setRef] = useState("")
  const [note, setNote] = useState("")
  const [done, setDone] = useState<{ receipt: string; amount: number; left: number } | null>(null)
  const key = useRef(`ins-${b.id}-${Date.now()}`) // the same collection cannot be recorded twice (double click)
  const needsRef = method !== "Cash"

  useEffect(() => {
    setAmount(due)
  }, [due])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (needsRef && !ref.trim()) return notify(`Enter the ${method === "Cheque" ? "cheque number" : "transaction reference"}.`, "error")
    try {
      const { claim, payment } = BillingDatabase.recordPayment(b.id, { amount, paymentMethod: method, transactionRef: ref.trim() || undefined, collectedBy: who(), notes: note.trim() || undefined, idempotencyKey: key.current })
      // Fully settled: tell the laboratory / radiology the patient has cleared, as the other counters do.
      if ((claim.balanceDue || 0) <= 0) {
        try {
          const st = BillingDatabase.getDepartmentClearanceStatus(claim.patientName, claim)
          if (st.hasLabOrders) BillingDatabase.dispatchClearanceToDepartment(claim.patientName, "Laboratory", payment.receiptNo, st.labTestNames.join(" + "))
          if (st.hasRadStudies) BillingDatabase.dispatchClearanceToDepartment(claim.patientName, "Radiology", payment.receiptNo, st.radStudyNames.join(" + "))
        } catch {
          /* clearance is a courtesy to the departments; the payment itself is recorded */
        }
      }
      setDone({ receipt: payment.receiptNo, amount: payment.amount, left: Math.max(0, claim.balanceDue || 0) })
      key.current = `ins-${b.id}-${Date.now()}`
      setRef("")
      setNote("")
      notify(`${inr(payment.amount)} received. Receipt ${payment.receiptNo}.`)
    } catch (err) {
      notify((err as Error).message || "The payment could not be recorded.", "error")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {done && (
        <div className="text-[12.5px] text-emerald-900 bg-emerald-50 border border-emerald-200 px-3 py-2">
          Receipt <strong className="font-mono">{done.receipt}</strong> issued for {inr(done.amount)}. {done.left > 0 ? `${inr(done.left)} is still due.` : "The patient's share is paid in full."}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Amount (₹)</label>
          <input type="number" min={1} max={due} className={`${inputCls} font-mono`} value={amount || ""} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} />
          <div className="text-[11px] text-slate-500 mt-1">
            Due now <span className="font-mono">{inr(due)}</span>
          </div>
        </div>
        <div>
          <label className={lbl}>Paid by</label>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentRecord["paymentMethod"])}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        {needsRef && (
          <div className="col-span-2">
            <label className={lbl}>{method === "Cheque" ? "Cheque number *" : "Transaction reference *"}</label>
            <input className={`${inputCls} font-mono`} value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
        )}
        <div className="col-span-2">
          <label className={lbl}>Note (optional)</label>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <button type="submit" disabled={!(amount > 0) || amount > due} className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-white text-[13px] font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        Receive {amount > 0 ? inr(amount) : "payment"}
      </button>
    </form>
  )
}
