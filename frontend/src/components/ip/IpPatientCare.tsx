import { useEffect, useMemo, useState } from "react"
import { db } from "../../services/db"
import { ErDatabase } from "../../services/erDb"
import { LabOrderDatabase } from "../../services/labOrdersDb"
import { PharmacyDatabase } from "../../services/pharmacyDb"
import { BillingDatabase } from "../../services/billingDb"
import { apiFetch } from "../../lib/api"
import {
  IpCare,
  dayOfStay,
  vitalsTimeline,
  type IpCase,
  type IpNote,
  type IpOrder,
  type Vitals,
} from "../../services/ipCare"
import type { DoctorAccount } from "../../services/doctorPortalDb"
import ConcernDoctorPicker from "./ConcernDoctorPicker"
import { VoiceTextarea } from "../voice/VoiceMic"
import { InvestigationOrder, MedicineOrder } from "./IpClinicalOrders"

/**
 * One admitted patient, everything the care team needs on one screen: monitoring (latest vitals and trend), the doctor
 * notes and nurse notes written during the stay (by typing or by dictation), orders from the doctor to the nurses,
 * the patient's investigations and medicines, and the hand-over between doctors / between nursing shifts.
 *
 * Used in the concern doctor's workspace (mode "doctor") and on the nurses' ward list (mode "nurse"). Nothing here is
 * pre-filled with invented text: a note starts empty and says only what its author says.
 */
type Tab = "monitor" | "doctor" | "nurse" | "orders" | "investigations" | "handover"

export interface Actor {
  id: string
  name: string
  role: string
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

const VITAL_FIELDS: { key: keyof Vitals; label: string; placeholder: string; min?: number; max?: number }[] = [
  { key: "bp", label: "BP", placeholder: "120/80" },
  { key: "pulse", label: "Pulse /min", placeholder: "72", min: 20, max: 250 },
  { key: "temperature", label: "Temp", placeholder: "98.6", min: 30, max: 110 },
  { key: "spo2", label: "SpO₂ %", placeholder: "98", min: 40, max: 100 },
  { key: "rr", label: "RR /min", placeholder: "16", min: 4, max: 80 },
  { key: "sugar", label: "Sugar mg/dL", placeholder: "110", min: 10, max: 1000 },
  { key: "pain", label: "Pain 0-10", placeholder: "2", min: 0, max: 10 },
]

/** A typed value that cannot be right (a slipped digit) is flagged before saving; nothing else is judged. */
function vitalProblems(v: Vitals): string[] {
  const out: string[] = []
  for (const f of VITAL_FIELDS) {
    const raw = String(v[f.key] ?? "").trim()
    if (!raw) continue
    if (f.key === "bp") {
      const m = raw.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/)
      if (!m || Number(m[1]) < Number(m[2]) || Number(m[1]) > 300 || Number(m[2]) < 20) out.push("BP should look like 120/80")
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) out.push(`${f.label}: ${raw} does not look right`)
  }
  return out
}

function Spark({ values, label, unit }: { values: number[]; label: string; unit?: string }) {
  if (values.length < 2) return null
  const w = 120
  const h = 32
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ")
  return (
    <div className="border border-slate-200 bg-white p-2">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <svg width={w} height={h} className="block" aria-label={`${label} trend`}>
        <polyline fill="none" stroke="#1B4FD8" strokeWidth="1.8" points={pts} />
      </svg>
      <div className="text-[11px] text-slate-500 font-mono">
        {values[values.length - 1]}
        {unit} now · {min}-{max}
      </div>
    </div>
  )
}

function VitalsFields({ value, onChange }: { value: Vitals; onChange: (v: Vitals) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {VITAL_FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{f.label}</span>
          <input
            value={value[f.key] ?? ""}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            inputMode={f.key === "bp" ? "text" : "decimal"}
            placeholder={f.placeholder}
            className="mt-0.5 w-full h-8 px-2 border border-slate-300 text-[13px] font-mono rounded-none focus:outline-none focus:border-blue-700"
          />
        </label>
      ))}
    </div>
  )
}

export default function IpPatientCare({
  ipCase,
  mode,
  actor,
  doctor,
  canWrite = true,
}: {
  ipCase: IpCase
  mode: "doctor" | "nurse"
  actor: Actor
  /** The signed-in doctor (doctor mode): authorship and hand-over use it. */
  doctor?: DoctorAccount
  canWrite?: boolean
}) {
  const [tab, setTab] = useState<Tab>("monitor")
  const [rev, setRev] = useState(0)
  useEffect(() => IpCare.subscribe(() => setRev((n) => n + 1)), [])
  useEffect(() => {
    const t = window.setInterval(() => setRev((n) => n + 1), 20000)
    return () => window.clearInterval(t)
  }, [])

  const pid = ipCase.patientId
  const notes = useMemo(() => IpCare.notes(pid), [pid, rev])
  const orders = useMemo(() => IpCare.orders(pid), [pid, rev])
  const timeline = useMemo(() => vitalsTimeline(pid), [pid, rev])
  const patient = db.getPatientByUmr(pid)
  const doctorNotes = notes.filter((n) => n.kind === "doctor")
  const nurseNotes = notes.filter((n) => n.kind === "nurse")
  const handovers = notes.filter((n) => n.kind === "handover")
  const pendingOrders = orders.filter((o) => o.status !== "done")

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "monitor", label: "Monitoring" },
    { id: "doctor", label: "Doctor notes", badge: doctorNotes.length },
    { id: "nurse", label: "Nurse notes", badge: nurseNotes.length },
    { id: "orders", label: "Orders", badge: pendingOrders.length },
    { id: "investigations", label: "Investigations & medicines" },
    { id: "handover", label: "Handover" },
  ]

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="bg-white border border-slate-200 p-3 flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-[220px]">
          <div className="text-[16px] font-bold text-slate-900">{ipCase.patientName}</div>
          <div className="text-[12px] text-slate-600">
            <span className="font-mono">{ipCase.patientId}</span>
            {patient ? ` · ${patient.age} yrs · ${patient.sex}` : ""}
            {patient?.bloodGroup ? ` · ${patient.bloodGroup}` : ""}
          </div>
          {patient?.phone && <div className="text-[12px] text-slate-500">{patient.phone}</div>}
        </div>
        <div className="text-[12.5px]">
          <div className="font-semibold text-slate-800">
            {ipCase.ward} · Room {ipCase.roomNo} · Bed {ipCase.bedNo}
          </div>
          <div className="text-slate-600">
            Day {dayOfStay(ipCase.admittedAt)} · admitted {when(ipCase.admittedAt)} · {ipCase.source === "ER" ? "from the ER" : "direct admission"}
          </div>
        </div>
        <div className="text-[12.5px]">
          <div className="text-slate-500 text-[11px] uppercase font-bold tracking-wide">Concern doctor</div>
          <div className="font-semibold text-slate-800">{ipCase.attendingDoctorName || "—"}</div>
          {ipCase.specialty && <div className="text-slate-500 text-[11.5px]">{ipCase.specialty}</div>}
        </div>
        {ipCase.reason && (
          <div className="text-[12.5px] max-w-md">
            <div className="text-slate-500 text-[11px] uppercase font-bold tracking-wide">Reason for admission</div>
            <div className="text-slate-800">{ipCase.reason}</div>
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[12.5px] whitespace-nowrap border-b-2 cursor-pointer ${tab === t.id ? "border-[#1B4FD8] text-[#1B4FD8] font-bold" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 text-[11px] bg-slate-100 px-1.5 font-mono">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "monitor" && <Monitoring ipCase={ipCase} timeline={timeline} pendingOrders={pendingOrders} onTab={setTab} />}
      {tab === "doctor" && <DoctorNotes ipCase={ipCase} notes={doctorNotes} actor={actor} canWrite={canWrite && mode === "doctor"} doctor={doctor} />}
      {tab === "nurse" && <NurseNotes ipCase={ipCase} notes={nurseNotes} actor={actor} canWrite={canWrite && mode === "nurse"} />}
      {tab === "orders" && <Orders ipCase={ipCase} orders={orders} actor={actor} mode={mode} canWrite={canWrite} doctor={doctor} />}
      {tab === "investigations" && <Investigations ipCase={ipCase} doctor={doctor} canOrder={canWrite && mode === "doctor"} />}
      {tab === "handover" && <Handover ipCase={ipCase} handovers={handovers} actor={actor} mode={mode} canWrite={canWrite} doctor={doctor} />}
    </div>
  )
}

// ── monitoring ───────────────────────────────────────────────────────────────

function Monitoring({ ipCase, timeline, pendingOrders, onTab }: { ipCase: IpCase; timeline: ReturnType<typeof vitalsTimeline>; pendingOrders: IpOrder[]; onTab: (t: Tab) => void }) {
  const latest = timeline[0]
  const chrono = [...timeline].reverse().slice(-20)
  const series = (k: keyof Vitals) => chrono.map((r) => Number(r.v[k])).filter((n) => Number.isFinite(n))
  const sys = chrono.map((r) => Number(String(r.v.bp || "").split("/")[0])).filter((n) => Number.isFinite(n) && n > 0)
  const er = useMemo(() => {
    try {
      return ErDatabase.getVisits("all").find((v) => (ipCase.erVisitNo && v.visit_no === ipCase.erVisitNo) || (v.patient_id && v.patient_id === ipCase.patientId))
    } catch {
      return undefined
    }
  }, [ipCase.erVisitNo, ipCase.patientId])

  return (
    <div className="space-y-3">
      {pendingOrders.length > 0 && (
        <button type="button" onClick={() => onTab("orders")} className="w-full text-left bg-amber-50 border border-amber-300 px-3 py-2 text-[12.5px] font-semibold text-amber-900 cursor-pointer">
          {pendingOrders.length} order{pendingOrders.length > 1 ? "s" : ""} waiting for the nurses
          {pendingOrders.some((o) => o.priority === "stat") ? " — includes a STAT order" : ""} →
        </button>
      )}

      {latest ? (
        <div className="bg-white border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            Latest vitals · {when(latest.at)} · {latest.by}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
            {VITAL_FIELDS.filter((f) => latest.v[f.key]).map((f) => (
              <div key={f.key}>
                <span className="text-[11px] text-slate-500 mr-1">{f.label}</span>
                <span className="font-mono font-bold text-slate-900">{latest.v[f.key]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-300 p-4 text-[12.5px] text-slate-600">No vitals recorded for this stay yet. Nurses record them under <strong>Nurse notes</strong>.</div>
      )}

      {chrono.length >= 2 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Spark values={series("pulse")} label="Pulse" unit="/min" />
          <Spark values={sys} label="Systolic BP" unit="" />
          <Spark values={series("spo2")} label="SpO₂" unit="%" />
          <Spark values={series("temperature")} label="Temperature" unit="" />
        </div>
      )}

      {timeline.length > 0 && (
        <div className="bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[620px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-1.5">Time</th>
                {VITAL_FIELDS.map((f) => (
                  <th key={f.key} className="px-2 py-1.5">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-1.5">By</th>
              </tr>
            </thead>
            <tbody>
              {timeline.slice(0, 15).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-1 whitespace-nowrap">{when(r.at)}</td>
                  {VITAL_FIELDS.map((f) => (
                    <td key={f.key} className="px-2 py-1 font-mono">
                      {r.v[f.key] || "—"}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-slate-600">{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {er && (
        <div className="bg-white border border-slate-200 p-3 text-[12.5px] space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">From the emergency department · {er.visit_no}</div>
          <div>
            Arrived {er.arrival_at ? when(er.arrival_at) : "—"}
            {er.triage_category ? ` · triage ${er.triage_category}` : ""}
            {er.assigned_doctor_name ? ` · seen by ${er.assigned_doctor_name}` : ""}
          </div>
          {er.complaints?.length > 0 && <div>Complaints: {er.complaints.map((c) => c.complaint).join("; ")}</div>}
          {er.vitals?.length > 0 && (
            <div className="font-mono text-[12px]">
              ER vitals: {[er.vitals[er.vitals.length - 1].bp_systolic && `BP ${er.vitals[er.vitals.length - 1].bp_systolic}/${er.vitals[er.vitals.length - 1].bp_diastolic}`, er.vitals[er.vitals.length - 1].heart_rate && `HR ${er.vitals[er.vitals.length - 1].heart_rate}`, er.vitals[er.vitals.length - 1].spo2 && `SpO₂ ${er.vitals[er.vitals.length - 1].spo2}%`, er.vitals[er.vitals.length - 1].temperature && `T ${er.vitals[er.vitals.length - 1].temperature}`].filter(Boolean).join(" · ") || "—"}
            </div>
          )}
          {er.disposition?.clinical_reason && <div>Admission decision: {er.disposition.clinical_reason}</div>}
        </div>
      )}
    </div>
  )
}

// ── notes ────────────────────────────────────────────────────────────────────

async function mirrorToChart(ipCase: IpCase, actor: Actor, body: { note: string; plan?: string; vitals?: Vitals; role: "doctor" | "nurse" }) {
  // Best effort: the clinical chart reads notes from the server, so a note written here also appears there.
  try {
    await apiFetch(`/api/patients/${ipCase.patientId}/notes`, {
      method: "POST",
      body: JSON.stringify({
        admission_id: ipCase.admissionId ?? undefined,
        doctor_name: actor.name,
        note: body.note,
        treatment_plan: body.plan || undefined,
        role: body.role,
        vitals: body.vitals
          ? { bp: body.vitals.bp, pulse: body.vitals.pulse, temperature: body.vitals.temperature, spo2: body.vitals.spo2, respiratory_rate: body.vitals.rr }
          : undefined,
      }),
    })
  } catch {
    /* the note is saved here either way */
  }
}

function NoteList({ notes, empty }: { notes: IpNote[]; empty: string }) {
  if (notes.length === 0) return <div className="bg-slate-50 border border-dashed border-slate-300 p-4 text-[12.5px] text-slate-600">{empty}</div>
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n.id} className="bg-white border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
            <span>
              <strong className="text-slate-800">{n.byName}</strong> · {n.byRole.replace(/^ROLE_/, "").replace(/_/g, " ").toLowerCase()}
            </span>
            <span>
              {when(n.at)}
              {n.voice ? " · 🎤 dictated" : ""}
            </span>
          </div>
          {n.text && <div className="text-[13px] text-slate-900 whitespace-pre-wrap mt-1">{n.text}</div>}
          {n.plan && (
            <div className="text-[12.5px] text-slate-800 whitespace-pre-wrap mt-1.5 border-l-2 border-blue-300 pl-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700">Plan </span>
              {n.plan}
            </div>
          )}
          {n.vitals && Object.values(n.vitals).some((x) => String(x ?? "").trim()) && (
            <div className="text-[12px] font-mono text-slate-700 mt-1.5">{VITAL_FIELDS.filter((f) => n.vitals?.[f.key]).map((f) => `${f.label} ${n.vitals?.[f.key]}`).join(" · ")}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function DoctorNotes({ ipCase, notes, actor, canWrite, doctor }: { ipCase: IpCase; notes: IpNote[]; actor: Actor; canWrite: boolean; doctor?: DoctorAccount }) {
  const [text, setText] = useState("")
  const [plan, setPlan] = useState("")
  const [vitals, setVitals] = useState<Vitals>({})
  const [showVitals, setShowVitals] = useState(false)
  const [voice, setVoice] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const save = async () => {
    setErr("")
    const problems = showVitals ? vitalProblems(vitals) : []
    if (problems.length) return setErr(problems.join(" · "))
    if (!text.trim() && !plan.trim()) return setErr("Write the note first (type it or press Dictate).")
    const v = showVitals && Object.values(vitals).some((x) => String(x ?? "").trim()) ? vitals : undefined
    try {
      IpCare.addNote({ patientId: ipCase.patientId, caseId: ipCase.id, kind: "doctor", text: text.trim(), plan: plan.trim() || undefined, vitals: v, byId: doctor?.id || actor.id, byName: doctor?.name || actor.name, byRole: "doctor", voice })
      void mirrorToChart(ipCase, { ...actor, name: doctor?.name || actor.name }, { note: text.trim() || plan.trim(), plan: text.trim() ? plan.trim() : undefined, vitals: v, role: "doctor" })
      setText("")
      setPlan("")
      setVitals({})
      setVoice(false)
      setMsg("Note saved.")
      window.setTimeout(() => setMsg(""), 3000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The note could not be saved.")
    }
  }

  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="bg-white border border-slate-200 p-3 space-y-3">
          <div className="text-[12.5px] font-bold text-slate-900">New doctor note · {doctor?.name || actor.name}</div>
          <VoiceTextarea label="Round note / progress" value={text} onChange={setText} onVoiceUsed={() => setVoice(true)} rows={4} placeholder="Examination, progress, response to treatment…  Type it, or press Dictate and speak." />
          <VoiceTextarea label="Plan / orders" value={plan} onChange={setPlan} onVoiceUsed={() => setVoice(true)} rows={2} placeholder="What happens next: investigations, medicines, review, discharge plan…" />
          <button type="button" onClick={() => setShowVitals((v) => !v)} className="text-[12px] font-semibold text-[#1B4FD8] hover:underline cursor-pointer">
            {showVitals ? "− Hide vitals" : "+ Add vitals measured at this round"}
          </button>
          {showVitals && <VitalsFields value={vitals} onChange={setVitals} />}
          {err && <div className="text-[12.5px] text-red-700">{err}</div>}
          {msg && <div className="text-[12.5px] text-emerald-700 font-semibold">✓ {msg}</div>}
          <button type="button" onClick={save} className="h-9 px-5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-bold cursor-pointer">
            Save note
          </button>
        </div>
      ) : (
        <div className="text-[12px] text-slate-500">Doctor notes are written by the concern doctor.</div>
      )}
      <NoteList notes={notes} empty="No doctor notes yet for this admission." />
    </div>
  )
}

function NurseNotes({ ipCase, notes, actor, canWrite }: { ipCase: IpCase; notes: IpNote[]; actor: Actor; canWrite: boolean }) {
  const [text, setText] = useState("")
  const [vitals, setVitals] = useState<Vitals>({})
  const [voice, setVoice] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const save = async () => {
    setErr("")
    const problems = vitalProblems(vitals)
    if (problems.length) return setErr(problems.join(" · "))
    const has = Object.values(vitals).some((x) => String(x ?? "").trim())
    if (!text.trim() && !has) return setErr("Enter vitals or write a note (type it or press Dictate).")
    try {
      IpCare.addNote({ patientId: ipCase.patientId, caseId: ipCase.id, kind: "nurse", text: text.trim(), vitals: has ? vitals : undefined, byId: actor.id, byName: actor.name, byRole: actor.role || "nurse", voice })
      void mirrorToChart(ipCase, actor, { note: text.trim() || "Vitals recorded", vitals: has ? vitals : undefined, role: "nurse" })
      setText("")
      setVitals({})
      setVoice(false)
      setMsg("Saved.")
      window.setTimeout(() => setMsg(""), 3000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not be saved.")
    }
  }

  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="bg-white border border-slate-200 p-3 space-y-3">
          <div className="text-[12.5px] font-bold text-slate-900">New nursing entry · {actor.name}</div>
          <VitalsFields value={vitals} onChange={setVitals} />
          <VoiceTextarea label="Nursing note" value={text} onChange={setText} onVoiceUsed={() => setVoice(true)} rows={3} placeholder="Condition, care given, patient response, anything the doctor should know… Type it, or press Dictate." />
          {err && <div className="text-[12.5px] text-red-700">{err}</div>}
          {msg && <div className="text-[12.5px] text-emerald-700 font-semibold">✓ {msg}</div>}
          <button type="button" onClick={save} className="h-9 px-5 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[12.5px] font-bold cursor-pointer">
            Save entry
          </button>
        </div>
      ) : (
        <div className="text-[12px] text-slate-500">Nursing notes are written by the nurses on the ward.</div>
      )}
      <NoteList notes={notes} empty="No nursing notes yet for this admission." />
    </div>
  )
}

// ── orders to the nurses ─────────────────────────────────────────────────────

function Orders({ ipCase, orders, actor, mode, canWrite, doctor }: { ipCase: IpCase; orders: IpOrder[]; actor: Actor; mode: "doctor" | "nurse"; canWrite: boolean; doctor?: DoctorAccount }) {
  const [text, setText] = useState("")
  const [priority, setPriority] = useState<IpOrder["priority"]>("routine")
  const [err, setErr] = useState("")
  const [doneId, setDoneId] = useState<string | null>(null)
  const [doneNote, setDoneNote] = useState("")

  const add = () => {
    setErr("")
    try {
      IpCare.addOrder({ patientId: ipCase.patientId, caseId: ipCase.id, text: text.trim(), priority, byDoctorId: doctor?.id || actor.id, byDoctorName: doctor?.name || actor.name })
      setText("")
      setPriority("routine")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The order could not be saved.")
    }
  }

  return (
    <div className="space-y-3">
      {mode === "doctor" && canWrite && (
        <div className="bg-white border border-slate-200 p-3 space-y-2">
          <div className="text-[12.5px] font-bold text-slate-900">New order for the nurses</div>
          <VoiceTextarea value={text} onChange={setText} rows={2} placeholder="e.g. Inj. Pantoprazole 40 mg IV now, then 12 hourly. Strict I/O chart. Inform me if SpO₂ falls below 92." />
          <div className="flex flex-wrap items-center gap-3">
            <select value={priority} onChange={(e) => setPriority(e.target.value as IpOrder["priority"])} className="h-8 px-2 border border-slate-300 text-[12.5px] bg-white rounded-none">
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="stat">STAT</option>
            </select>
            <button type="button" onClick={add} className="h-8 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold cursor-pointer">
              Send to nurses
            </button>
            {err && <span className="text-[12.5px] text-red-700">{err}</span>}
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-300 p-4 text-[12.5px] text-slate-600">No orders for this admission.</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className={`bg-white border p-3 ${o.status !== "done" && o.priority !== "routine" ? "border-red-300" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
                <span>
                  <strong className="text-slate-800">{o.byDoctorName}</strong> · {when(o.at)}
                  {o.priority !== "routine" && <span className="ml-2 px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 font-bold uppercase">{o.priority}</span>}
                </span>
                <span className={`font-bold ${o.status === "done" ? "text-emerald-700" : o.status === "acknowledged" ? "text-blue-700" : "text-amber-700"}`}>
                  {o.status === "done" ? `Done · ${o.doneBy}` : o.status === "acknowledged" ? `Acknowledged · ${o.ackBy}` : "Waiting"}
                </span>
              </div>
              <div className="text-[13px] text-slate-900 whitespace-pre-wrap mt-1">{o.text}</div>
              {o.doneNote && <div className="text-[12px] text-slate-600 mt-1">Nurse: {o.doneNote}</div>}
              {mode === "nurse" && canWrite && o.status !== "done" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {o.status === "pending" && (
                    <button type="button" onClick={() => IpCare.updateOrder(o.id, "acknowledged", actor.name)} className="h-7 px-3 border border-blue-300 text-blue-800 bg-blue-50 text-[12px] font-bold cursor-pointer">
                      Acknowledge
                    </button>
                  )}
                  {doneId === o.id ? (
                    <>
                      <input value={doneNote} onChange={(e) => setDoneNote(e.target.value)} placeholder="Note (optional)" className="h-7 px-2 border border-slate-300 text-[12px] w-56 rounded-none" />
                      <button
                        type="button"
                        onClick={() => {
                          IpCare.updateOrder(o.id, "done", actor.name, doneNote)
                          setDoneId(null)
                          setDoneNote("")
                        }}
                        className="h-7 px-3 bg-emerald-600 text-white text-[12px] font-bold cursor-pointer"
                      >
                        Confirm done
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setDoneId(o.id)} className="h-7 px-3 border border-emerald-300 text-emerald-800 bg-emerald-50 text-[12px] font-bold cursor-pointer">
                      ✓ Mark done
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── investigations and medicines ─────────────────────────────────────────────

function Investigations({ ipCase, doctor, canOrder }: { ipCase: IpCase; doctor?: DoctorAccount; canOrder: boolean }) {
  const pid = ipCase.patientId.toUpperCase()
  const [rev, setRev] = useState(0)
  const [msg, setMsg] = useState("")
  const done = (m: string) => {
    setMsg(m)
    setRev((n) => n + 1)
    window.setTimeout(() => setMsg(""), 8000)
  }
  const labs = useMemo(() => {
    try {
      return LabOrderDatabase.getOrders().filter((o) => String(o.umr || "").toUpperCase() === pid)
    } catch {
      return []
    }
  }, [pid, rev])
  const rads = useMemo(() => {
    try {
      return BillingDatabase.getRadiologyStudies().filter((r: any) => String(r.umr || r.mrn || "").toUpperCase() === pid)
    } catch {
      return []
    }
  }, [pid, rev])
  const rx = useMemo(() => {
    try {
      return PharmacyDatabase.getPrescriptions().filter((p) => String(p.patientId || "").toUpperCase() === pid)
    } catch {
      return []
    }
  }, [pid, rev])

  const Box = ({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) => (
    <div className="bg-white border border-slate-200 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">{title}</div>
      {empty ? <div className="text-[12.5px] text-slate-500">None for this patient.</div> : children}
    </div>
  )

  return (
    <div className="space-y-3">
      {msg && <div className="text-[12.5px] text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-2">✓ {msg}</div>}
      {canOrder && (
        <div className="grid lg:grid-cols-2 gap-3">
          <InvestigationOrder ipCase={ipCase} doctor={doctor} onDone={done} />
          <MedicineOrder ipCase={ipCase} doctor={doctor} onDone={done} />
        </div>
      )}
    <div className="grid md:grid-cols-3 gap-3">
      <Box title={`Laboratory (${labs.length})`} empty={labs.length === 0}>
        {labs.slice(0, 10).map((o) => (
          <div key={o.id} className="border-b border-slate-100 py-1.5 text-[12.5px]">
            <div className="flex justify-between gap-2">
              <span className="font-mono text-slate-600">{o.id}</span>
              <span className="font-semibold text-slate-800">{o.status}</span>
            </div>
            <div className="text-slate-700">{o.tests.map((t) => t.name).join(", ")}</div>
          </div>
        ))}
      </Box>
      <Box title={`Radiology (${rads.length})`} empty={rads.length === 0}>
        {rads.slice(0, 10).map((r: any) => (
          <div key={r.id} className="border-b border-slate-100 py-1.5 text-[12.5px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-800">{r.study}</span>
              <span className="font-semibold text-slate-800">{r.status}</span>
            </div>
          </div>
        ))}
      </Box>
      <Box title={`Medicines (${rx.length})`} empty={rx.length === 0}>
        {rx.slice(0, 10).map((p) => (
          <div key={p.id} className="border-b border-slate-100 py-1.5 text-[12.5px]">
            <div className="flex justify-between gap-2">
              <span className="font-mono text-slate-600">{p.id}</span>
              <span className="font-semibold text-slate-800">{p.dispensingStatus}</span>
            </div>
            <div className="text-slate-700">{p.items.map((i) => i.medicineName).join(", ")}</div>
          </div>
        ))}
      </Box>
    </div>
    </div>
  )
}

// ── handover ─────────────────────────────────────────────────────────────────

function Handover({ ipCase, handovers, actor, mode, canWrite, doctor }: { ipCase: IpCase; handovers: IpNote[]; actor: Actor; mode: "doctor" | "nurse"; canWrite: boolean; doctor?: DoctorAccount }) {
  const [to, setTo] = useState<DoctorAccount | null>(null)
  const [reason, setReason] = useState("")
  const [text, setText] = useState("")
  const [voice, setVoice] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")

  const handOver = () => {
    setErr("")
    if (!to) return setErr("Choose the doctor who takes over.")
    if (!reason.trim()) return setErr("Say why (leave, shift, specialty change…).")
    IpCare.assignAttending(ipCase.id, to, doctor?.name || actor.name, reason.trim())
    setMsg(`${ipCase.patientName} is now under ${to.name}. They have been told.`)
    setTo(null)
    setReason("")
  }
  const saveShift = () => {
    setErr("")
    if (!text.trim()) return setErr("Write the handover note first (type it or press Dictate).")
    IpCare.addNote({ patientId: ipCase.patientId, caseId: ipCase.id, kind: "handover", text: text.trim(), byId: actor.id, byName: actor.name, byRole: actor.role || "nurse", voice })
    setText("")
    setVoice(false)
    setMsg("Handover note saved.")
  }

  return (
    <div className="space-y-3">
      {msg && <div className="text-[12.5px] text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-2">✓ {msg}</div>}
      {err && <div className="text-[12.5px] text-red-700">{err}</div>}

      {mode === "doctor" && canWrite && (
        <div className="bg-white border border-slate-200 p-3 space-y-2">
          <div className="text-[12.5px] font-bold text-slate-900">Hand this patient over to another doctor</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <ConcernDoctorPicker label="New concern doctor" value={to?.id || ""} onChange={setTo} exceptId={ipCase.attendingDoctorId} specialtyHint={ipCase.specialty} />
            <label className="block">
              <span className="text-[11.5px] font-semibold text-slate-700">Reason</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. going on leave, needs cardiology care" className="mt-1 w-full h-9 px-2 border border-slate-300 text-[13px] rounded-none" />
            </label>
          </div>
          <button type="button" onClick={handOver} className="h-9 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold cursor-pointer">
            Hand over
          </button>
        </div>
      )}

      {mode === "nurse" && canWrite && (
        <div className="bg-white border border-slate-200 p-3 space-y-2">
          <div className="text-[12.5px] font-bold text-slate-900">Shift handover note</div>
          <VoiceTextarea value={text} onChange={setText} onVoiceUsed={() => setVoice(true)} rows={3} placeholder="Condition, what is pending, medicines due, what the next shift must watch… Type it, or press Dictate." />
          <button type="button" onClick={saveShift} className="h-9 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold cursor-pointer">
            Save handover note
          </button>
        </div>
      )}

      {ipCase.handovers.length > 0 && (
        <div className="bg-white border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Doctor handovers</div>
          {ipCase.handovers.map((h, i) => (
            <div key={i} className="text-[12.5px] border-b border-slate-100 py-1.5">
              {when(h.at)} · {h.fromDoctorName} → <strong>{h.toDoctorName}</strong> · {h.reason} · by {h.by}
            </div>
          ))}
        </div>
      )}
      <NoteList notes={handovers} empty="No shift handover notes yet." />
    </div>
  )
}
