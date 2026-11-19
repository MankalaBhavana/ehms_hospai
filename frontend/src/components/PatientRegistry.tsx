import { Fragment, useEffect, useMemo, useState } from "react"
import { db, type DBPatient, type DBOPEncounter } from "../services/db"
import { BillingDatabase, type ClaimRecord } from "../services/billingDb"
import { ErDatabase } from "../services/erDb"
import { BedDatabase } from "../services/bedDb"
import { apiFetch } from "../lib/api"
import { aadhaarDigits, aadhaarState, formatAadhaar, type AadhaarMatch } from "../utils/aadhaar"
import PatientJourneyModal from "./PatientJourneyModal"
import { openJourneyForCode } from "./opcard/JourneyScan"
import { opCardDataFor, printOpCard } from "./opcard/OpCard"
import { getBranding } from "../lib/branding"

/**
 * Reception > Registry: every patient on record, in one place. One row per patient (by UMR) with how often they have
 * visited, where they are right now (OP today / ER / admitted), what they still owe, and one click to open the full
 * record, the clinical journey, the chart or to print the OP card. Filters, sorting, CSV export; the Aadhaar box finds
 * a returning patient straight from their Aadhaar number (the number itself is never stored in the browser).
 */

type Where = "OP" | "ER" | "IP"
const PAGE = 25

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
const dayOf = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "")
const fmtDay = (d: string) => {
  if (!d) return "—"
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}
const norm = (u?: string | null) => String(u || "").trim().toUpperCase()

interface Row {
  p: DBPatient
  visits: DBOPEncounter[]
  last?: DBOPEncounter
  lastDay: string
  where: Where[]
  due: number
  bills: ClaimRecord[]
}

export default function PatientRegistry({ onRegister, onOpenChart }: { onRegister: () => void; onOpenChart: (umr: string) => void }) {
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | "today" | "er" | "ip" | "dues" | "never">("all")
  const [gender, setGender] = useState("All")
  const [age, setAge] = useState("All")
  const [dept, setDept] = useState("All")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sort, setSort] = useState<"recent" | "name" | "visits" | "due" | "registered">("registered")
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [journey, setJourney] = useState<DBOPEncounter | null>(null)
  const [aadhaar, setAadhaar] = useState("")
  const [aHit, setAHit] = useState<AadhaarMatch | null | "none">(null)
  const [msg, setMsg] = useState("")

  // Live: any change to patients, encounters, bills, ER or beds redraws the registry.
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const offs = [db.subscribe(bump), BillingDatabase.onUpdate(bump)]
    window.addEventListener("storage", bump)
    const t = window.setInterval(bump, 15000)
    return () => {
      offs.forEach((o) => o?.())
      window.removeEventListener("storage", bump)
      window.clearInterval(t)
    }
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const { rows, depts, totals } = useMemo(() => {
    const patients = db.getPatients()
    const encounters = db.getEncounters()
    const claims = (() => {
      try {
        return BillingDatabase.getClaims()
      } catch {
        return [] as ClaimRecord[]
      }
    })()
    const erNow = new Set<string>()
    try {
      ErDatabase.getVisits("active").forEach((v) => v.patient_id && erNow.add(norm(v.patient_id)))
    } catch {
      /* no ER data yet */
    }
    const ipNow = new Set<string>()
    try {
      BedDatabase.getBeds().forEach((b) => b.status === "Occupied" && b.patient_id && ipNow.add(norm(b.patient_id)))
    } catch {
      /* no bed data yet */
    }
    const visitsBy = new Map<string, DBOPEncounter[]>()
    encounters.forEach((e) => {
      const k = norm(e.umr)
      visitsBy.set(k, [...(visitsBy.get(k) || []), e])
    })
    const billsBy = new Map<string, ClaimRecord[]>()
    claims.forEach((c) => {
      if (c.status === "Voided" || c.erSentToBilling === false) return // an ER bill not yet sent to billing is not owed to a counter
      const k = norm(c.patientId)
      billsBy.set(k, [...(billsBy.get(k) || []), c])
    })
    const deptSet = new Set<string>()
    const rows: Row[] = patients.map((p) => {
      const k = norm(p.umr)
      const visits = (visitsBy.get(k) || []).slice().sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")))
      visits.forEach((v) => v.dept && deptSet.add(v.dept))
      const last = visits[0]
      const bills = billsBy.get(k) || []
      const where: Where[] = []
      if (visits.some((v) => dayOf(v.createdAt || v.date) === today && v.status !== "OP Completed")) where.push("OP")
      if (erNow.has(k)) where.push("ER")
      if (ipNow.has(k)) where.push("IP")
      return {
        p,
        visits,
        last,
        lastDay: dayOf(last?.createdAt || last?.date),
        where,
        due: bills.reduce((s, c) => s + Math.max(0, Number(c.balanceDue) || 0), 0),
        bills,
      }
    })
    const totals = {
      all: rows.length,
      newToday: rows.filter((r) => dayOf(r.p.createdAt) === today).length,
      visitsToday: encounters.filter((e) => dayOf(e.createdAt || e.date) === today).length,
      inHospital: rows.filter((r) => r.where.includes("ER") || r.where.includes("IP")).length,
      withDues: rows.filter((r) => r.due > 0).length,
      dues: rows.reduce((s, r) => s + r.due, 0),
    }
    return { rows, depts: [...deptSet].sort(), totals }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, today])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (query) {
        const hay = [r.p.name, r.p.umr, r.p.phone, r.p.address, r.p.bloodGroup, ...r.visits.flatMap((v) => [v.opNumber, v.dept, v.assignedDoctor, v.diagnosis])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!hay.includes(query)) return false
      }
      if (gender !== "All" && (r.p.sex || "").toLowerCase() !== gender.toLowerCase()) return false
      const a = Number(r.p.age) || 0
      if (age === "Child" && a >= 18) return false
      if (age === "Adult" && (a < 18 || a >= 60)) return false
      if (age === "Senior" && a < 60) return false
      if (dept !== "All" && !r.visits.some((v) => v.dept === dept)) return false
      const reg = dayOf(r.p.createdAt)
      if (from && reg < from) return false
      if (to && reg > to) return false
      if (status === "today" && !(r.lastDay === today)) return false
      if (status === "er" && !r.where.includes("ER")) return false
      if (status === "ip" && !r.where.includes("IP")) return false
      if (status === "dues" && !(r.due > 0)) return false
      if (status === "never" && r.visits.length > 0) return false
      return true
    })
    const by: Record<typeof sort, (a: Row, b: Row) => number> = {
      recent: (a, b) => b.lastDay.localeCompare(a.lastDay),
      name: (a, b) => (a.p.name || "").localeCompare(b.p.name || ""),
      visits: (a, b) => b.visits.length - a.visits.length,
      due: (a, b) => b.due - a.due,
      registered: (a, b) => String(b.p.createdAt || "").localeCompare(String(a.p.createdAt || "")),
    }
    return out.sort(by[sort])
  }, [rows, q, status, gender, age, dept, from, to, sort, today])

  useEffect(() => setPage(0), [q, status, gender, age, dept, from, to, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)

  // Aadhaar lookup: asks the server, which holds only a keyed hash of the number.
  useEffect(() => {
    if (aadhaarState(aadhaar) !== "valid") {
      setAHit(null)
      return
    }
    let live = true
    apiFetch<{ found: boolean; patient: AadhaarMatch | null }>(`/api/patients/by-aadhaar?number=${aadhaarDigits(aadhaar)}`)
      .then((res) => live && setAHit(res?.found && res.patient ? res.patient : "none"))
      .catch(() => live && setAHit("none"))
    return () => {
      live = false
    }
  }, [aadhaar])

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const head = ["UMR", "Name", "Age", "Sex", "Phone", "Blood group", "Registered on", "OP visits", "Last visit", "Last department", "Last doctor", "Now", "Amount due"]
    const lines = filtered.map((r) =>
      [r.p.umr, r.p.name, r.p.age, r.p.sex, r.p.phone, r.p.bloodGroup, dayOf(r.p.createdAt), r.visits.length, r.lastDay, r.last?.dept, r.last?.assignedDoctor, r.where.join("/"), Math.round(r.due)].map(esc).join(","),
    )
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `patient-registry-${today}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const printCard = async (r: Row) => {
    try {
      const res = await printOpCard(opCardDataFor(r.p.umr, { patientName: r.p.name, age: r.p.age, sex: r.p.sex, phone: r.p.phone, bloodGroup: r.p.bloodGroup }), getBranding())
      setMsg(res.withQr ? `OP card for ${r.p.name} sent to the printer.` : `OP card for ${r.p.name} printed without a QR code (server link unavailable).`)
    } catch {
      setMsg("The OP card could not be printed.")
    }
    window.setTimeout(() => setMsg(""), 4000)
  }

  const Tile = ({ label, value, sub, onClick, active }: { label: string; value: string | number; sub?: string; onClick?: () => void; active?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white border p-3 transition ${active ? "border-[#1B4FD8] ring-1 ring-[#1B4FD8]" : "border-[#DDE2EC] hover:border-[#94A3B8]"} ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">{label}</div>
      <div className="text-xl font-bold text-gray-900 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-[#94A3B8]">{sub}</div>}
    </button>
  )

  const sel = "h-8 px-2 border border-[#CBD5E1] bg-white text-[12.5px] rounded-none focus:outline-none focus:border-[#1B4FD8]"

  return (
    <div className="flex-1 overflow-y-auto bg-[#F0F2F5]">
      <div className="bg-white border-b border-[#DDE2EC] px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Patient Registry</h1>
          <p className="text-[11.5px] text-[#64748B]">Every patient on record in one place · {totals.all} registered · search, filter, open the record or print the OP card</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="h-8 px-3 border border-[#CBD5E1] bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
            ⬇ Export CSV ({filtered.length})
          </button>
          <button type="button" onClick={onRegister} className="h-8 px-3 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12px] font-semibold cursor-pointer">
            + Register patient
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile label="All patients" value={totals.all} onClick={() => setStatus("all")} active={status === "all"} />
          <Tile label="New today" value={totals.newToday} sub={`${totals.visitsToday} visit(s) today`} onClick={() => setStatus("today")} active={status === "today"} />
          <Tile label="In hospital now" value={totals.inHospital} sub="ER + admitted" onClick={() => setStatus("ip")} active={status === "ip"} />
          <Tile label="In ER now" value={rows.filter((r) => r.where.includes("ER")).length} onClick={() => setStatus("er")} active={status === "er"} />
          <Tile label="With dues" value={totals.withDues} sub={totals.dues > 0 ? `${inr(totals.dues)} outstanding` : "nothing outstanding"} onClick={() => setStatus("dues")} active={status === "dues"} />
        </div>

        <div className="bg-white border border-[#DDE2EC] p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[220px]">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Search</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, UMR, phone, OP number, doctor, diagnosis…" className={`${sel} w-full block mt-0.5`} />
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Aadhaar number</span>
              <input value={formatAadhaar(aadhaar)} onChange={(e) => setAadhaar(aadhaarDigits(e.target.value))} inputMode="numeric" placeholder="XXXX XXXX XXXX" className={`${sel} w-[170px] block mt-0.5 font-mono`} />
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Gender</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={`${sel} block mt-0.5`}>
                {["All", "Male", "Female", "Other"].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Age</span>
              <select value={age} onChange={(e) => setAge(e.target.value)} className={`${sel} block mt-0.5`}>
                <option value="All">All</option>
                <option value="Child">Under 18</option>
                <option value="Adult">18 – 59</option>
                <option value="Senior">60 and over</option>
              </select>
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Department</span>
              <select value={dept} onChange={(e) => setDept(e.target.value)} className={`${sel} block mt-0.5 max-w-[170px]`}>
                <option value="All">All</option>
                {depts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Registered from</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${sel} block mt-0.5`} />
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${sel} block mt-0.5`} />
            </label>
            <label>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B]">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${sel} block mt-0.5`}>
                <option value="registered">Newest registered</option>
                <option value="recent">Latest visit</option>
                <option value="name">Name A–Z</option>
                <option value="visits">Most visits</option>
                <option value="due">Highest due</option>
              </select>
            </label>
            {(q || gender !== "All" || age !== "All" || dept !== "All" || from || to || status !== "all") && (
              <button
                type="button"
                className="h-8 px-3 text-[12px] font-semibold text-[#1B4FD8] hover:underline cursor-pointer"
                onClick={() => {
                  setQ("")
                  setGender("All")
                  setAge("All")
                  setDept("All")
                  setFrom("")
                  setTo("")
                  setStatus("all")
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {aadhaarState(aadhaar) === "invalid" && <div className="text-[12px] text-rose-700">That is not a valid Aadhaar number — check the digits.</div>}
          {aHit === "none" && <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">No patient is registered with that Aadhaar number.</div>}
          {aHit && aHit !== "none" && (
            <div className="text-[12.5px] bg-emerald-50 border border-emerald-200 px-3 py-2 flex flex-wrap items-center gap-3">
              <span>
                <strong>{aHit.full_name}</strong> · <span className="font-mono">{aHit.patient_id}</span>
                {aHit.age != null && ` · ${aHit.age} yrs`}
                {aHit.gender && ` · ${aHit.gender}`}
                {aHit.phone && ` · ${aHit.phone}`}
                {aHit.aadhar_masked && ` · Aadhaar ${aHit.aadhar_masked}`}
              </span>
              <button type="button" className="font-bold text-[#1B4FD8] hover:underline cursor-pointer" onClick={() => setQ(aHit.patient_id)}>
                Show in registry
              </button>
              <button type="button" className="font-bold text-[#1B4FD8] hover:underline cursor-pointer" onClick={() => openJourneyForCode(aHit.patient_id)}>
                Open record →
              </button>
            </div>
          )}
        </div>

        {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] px-3 py-2 font-semibold">{msg}</div>}

        <div className="bg-white border border-[#DDE2EC] overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[980px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-[#64748B] bg-[#F8FAFC] border-b border-[#DDE2EC]">
                <th className="px-3 py-2">UMR</th>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2 text-right">Visits</th>
                <th className="px-3 py-2">Last visit</th>
                <th className="px-3 py-2">Now</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.p.umr
                return (
                  <Fragment key={r.p.umr}>
                    <tr className={`border-b border-[#F1F5F9] hover:bg-[#F8FAFF] ${isOpen ? "bg-[#F4F7FF]" : ""}`}>
                      <td className="px-3 py-2 font-mono font-bold text-[#1B4FD8] whitespace-nowrap">{r.p.umr}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-gray-900">{r.p.name}</div>
                        <div className="text-[11.5px] text-[#64748B]">
                          {r.p.age} yrs · {r.p.sex}
                          {r.p.bloodGroup ? ` · ${r.p.bloodGroup}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.p.phone || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDay(dayOf(r.p.createdAt))}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.visits.length}</td>
                      <td className="px-3 py-2">
                        {r.last ? (
                          <>
                            <div className="whitespace-nowrap">
                              {fmtDay(r.lastDay)} · <span className="font-mono">{r.last.opNumber}</span>
                            </div>
                            <div className="text-[11.5px] text-[#64748B]">{[r.last.dept, r.last.assignedDoctor].filter(Boolean).join(" · ") || "—"}</div>
                          </>
                        ) : (
                          <span className="text-[#94A3B8]">No visit yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.where.length === 0 ? (
                          <span className="text-[#94A3B8]">—</span>
                        ) : (
                          r.where.map((w) => (
                            <span key={w} className={`inline-block mr-1 px-1.5 py-0.5 text-[10.5px] font-bold border ${w === "ER" ? "bg-red-50 text-red-700 border-red-200" : w === "IP" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                              {w === "OP" ? "OP today" : w === "ER" ? "In ER" : "Admitted"}
                            </span>
                          ))
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${r.due > 0 ? "text-rose-700 font-bold" : "text-[#94A3B8]"}`}>{r.due > 0 ? inr(r.due) : "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" className="text-[12px] font-semibold text-[#1B4FD8] hover:underline mr-3 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.p.umr)}>
                          {isOpen ? "Hide" : "Details"}
                        </button>
                        <button type="button" className="text-[12px] font-semibold text-[#1B4FD8] hover:underline cursor-pointer" onClick={() => openJourneyForCode(norm(r.p.umr))} title="Opens the patient's complete record (same as scanning the OP card)">
                          Record →
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-[#E2E8F0] bg-[#FAFCFF]">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex flex-wrap gap-2 mb-3">
                            <button type="button" className="h-8 px-3 border border-[#CBD5E1] bg-white text-[12px] font-semibold hover:bg-gray-50 cursor-pointer" onClick={() => onOpenChart(r.p.umr)}>
                              📋 Clinical chart
                            </button>
                            {r.last && (
                              <button type="button" className="h-8 px-3 border border-[#CBD5E1] bg-white text-[12px] font-semibold hover:bg-gray-50 cursor-pointer" onClick={() => setJourney(r.last!)}>
                                ✨ Latest OP journey
                              </button>
                            )}
                            <button type="button" className="h-8 px-3 border border-[#CBD5E1] bg-white text-[12px] font-semibold hover:bg-gray-50 cursor-pointer" onClick={() => printCard(r)}>
                              🖨 Print OP card
                            </button>
                          </div>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B] mb-1">Visits ({r.visits.length})</div>
                              {r.visits.length === 0 ? (
                                <div className="text-[12px] text-[#94A3B8]">No OP visit recorded.</div>
                              ) : (
                                <table className="w-full text-[12px]">
                                  <tbody>
                                    {r.visits.slice(0, 12).map((v) => (
                                      <tr key={v.id} className="border-b border-[#F1F5F9] cursor-pointer hover:bg-white" onClick={() => setJourney(v)} title="Open this visit's journey">
                                        <td className="py-1 pr-2 whitespace-nowrap">{fmtDay(dayOf(v.createdAt || v.date))}</td>
                                        <td className="py-1 pr-2 font-mono">{v.opNumber}</td>
                                        <td className="py-1 pr-2">{[v.dept, v.assignedDoctor].filter(Boolean).join(" · ")}</td>
                                        <td className="py-1 text-[#64748B]">{v.status}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {r.visits.length > 12 && <div className="text-[11px] text-[#94A3B8] mt-1">+ {r.visits.length - 12} earlier visits (open the record to see all)</div>}
                            </div>
                            <div>
                              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#64748B] mb-1">Bills ({r.bills.length})</div>
                              {r.bills.length === 0 ? (
                                <div className="text-[12px] text-[#94A3B8]">No bills yet.</div>
                              ) : (
                                <table className="w-full text-[12px]">
                                  <tbody>
                                    {r.bills.slice(0, 12).map((c) => (
                                      <tr key={c.id} className="border-b border-[#F1F5F9]">
                                        <td className="py-1 pr-2 whitespace-nowrap">{fmtDay(dayOf(c.dateOfService))}</td>
                                        <td className="py-1 pr-2 font-mono">{c.invoiceNo}</td>
                                        <td className="py-1 pr-2">{c.department}</td>
                                        <td className="py-1 pr-2 text-right font-mono">{inr(c.totalAmount || 0)}</td>
                                        <td className={`py-1 text-right font-mono ${(c.balanceDue || 0) > 0 ? "text-rose-700 font-bold" : "text-emerald-700"}`}>{(c.balanceDue || 0) > 0 ? `due ${inr(c.balanceDue)}` : "paid"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                          <div className="text-[11.5px] text-[#64748B] mt-3">
                            {r.p.address ? `Address: ${r.p.address}` : "No address on record"} · Registered {fmtDay(dayOf(r.p.createdAt))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-[#64748B]">
                    {rows.length === 0 ? "No patients are registered yet." : "No patient matches these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-[12px] text-[#64748B]">
          <span>
            Showing {filtered.length === 0 ? 0 : page * PAGE + 1}–{Math.min(filtered.length, page * PAGE + PAGE)} of {filtered.length}
            {filtered.length !== rows.length && ` (filtered from ${rows.length})`}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((n) => n - 1)} className="h-7 px-3 border border-[#CBD5E1] bg-white disabled:opacity-40 cursor-pointer">
              ‹ Prev
            </button>
            <span>
              Page {page + 1} / {pages}
            </span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)} className="h-7 px-3 border border-[#CBD5E1] bg-white disabled:opacity-40 cursor-pointer">
              Next ›
            </button>
          </span>
        </div>
      </div>

      {journey && <PatientJourneyModal encounter={journey} onClose={() => setJourney(null)} />}
    </div>
  )
}

