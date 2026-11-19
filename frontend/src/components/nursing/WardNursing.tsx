import { useEffect, useMemo, useState } from "react"
import { IpCare, attentionFlags, currentActor, dayOfStay } from "../../services/ipCare"
import IpPatientCare from "../ip/IpPatientCare"
import { useIpCare } from "../ip/useIpCare"

/**
 * Ward Nursing: the nurses' view of every admitted patient. Pick a ward, see who is in each bed, who has an order
 * waiting or has not had vitals for hours, and open a patient to record vitals, nursing notes (typed or dictated),
 * acknowledge and complete the doctor's orders, and write the shift handover.
 *
 * Replaces the old nursing portal, which was built around a fixed list of sample nurses and pre-filled each note with
 * clinical text nobody had written. Here a note says only what its author says, and the nurse is whoever is signed in.
 */
export default function WardNursing({ readOnly = false }: { readOnly?: boolean }) {
  const { rev, cases } = useIpCare()
  const [ward, setWard] = useState("All")
  const [q, setQ] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [])

  const actor = currentActor()
  const wards = useMemo(() => ["All", ...Array.from(new Set(cases.map((c) => c.ward))).sort()], [cases])
  const shown = useMemo(
    () =>
      cases
        .filter((c) => (ward === "All" || c.ward === ward) && (!q.trim() || `${c.patientName} ${c.patientId} ${c.bedNo} ${c.attendingDoctorName || ""}`.toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => `${a.ward}${a.roomNo}${a.bedNo}`.localeCompare(`${b.ward}${b.roomNo}${b.bedNo}`, undefined, { numeric: true })),
    [cases, ward, q],
  )
  const flags = useMemo(() => new Map(shown.map((c) => [c.id, attentionFlags(c, now)])), [shown, now, rev])
  const pendingOrders = useMemo(() => IpCare.orders().filter((o) => o.status !== "done" && shown.some((c) => c.patientId === o.patientId)).length, [shown, rev])

  useEffect(() => {
    if (selectedId && !shown.some((c) => c.id === selectedId)) setSelectedId(null)
    else if (!selectedId && shown.length) setSelectedId(shown[0].id)
  }, [shown, selectedId])
  const selected = shown.find((c) => c.id === selectedId)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#F0F2F5]">
      <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[16px] font-bold text-slate-900">Ward Nursing</h1>
          <p className="text-[12px] text-slate-600">
            Signed in as <strong>{actor.name}</strong> · {shown.length} admitted patient{shown.length === 1 ? "" : "s"}
            {pendingOrders ? ` · ${pendingOrders} doctor order${pendingOrders > 1 ? "s" : ""} pending` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={ward} onChange={(e) => setWard(e.target.value)} className="h-8 px-2 border border-slate-300 text-[12.5px] bg-white rounded-none">
            {wards.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, bed, doctor" className="h-8 w-56 px-2.5 border border-slate-300 text-[12.5px] rounded-none" />
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <aside className="lg:w-[340px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto max-h-[42vh] lg:max-h-none">
          {shown.length === 0 && <div className="p-4 text-[12.5px] text-slate-600">{cases.length === 0 ? "No patient is admitted right now." : "No admitted patient matches."}</div>}
          {shown.map((c) => {
            const why = flags.get(c.id) || []
            const pend = IpCare.orders(c.patientId).filter((o) => o.status !== "done").length
            return (
              <button key={c.id} type="button" onClick={() => setSelectedId(c.id)} className={`w-full text-left px-3 py-2.5 border-b border-slate-100 cursor-pointer ${selectedId === c.id ? "bg-[#EFF6FF] border-l-4 border-l-[#1B4FD8]" : "hover:bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-slate-900 truncate">{c.patientName}</span>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">Day {dayOfStay(c.admittedAt, now)}</span>
                </div>
                <div className="text-[11.5px] text-slate-600 truncate">
                  {c.ward} · Room {c.roomNo} · Bed {c.bedNo}
                </div>
                <div className="text-[11.5px] text-slate-500 truncate">{c.attendingDoctorName ? `🩺 ${c.attendingDoctorName}` : "⚠ no concern doctor yet"}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {why.map((w) => (
                    <span key={w} className="text-[10.5px] font-bold px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200">
                      {w}
                    </span>
                  ))}
                  {pend > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">{pend} order{pend > 1 ? "s" : ""}</span>}
                </div>
              </button>
            )
          })}
        </aside>
        <section className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-5">
          {selected ? (
            <IpPatientCare key={selected.id} ipCase={selected} mode="nurse" actor={actor} canWrite={!readOnly} />
          ) : (
            <div className="bg-white border border-slate-200 p-8 text-center text-[13px] text-slate-600">Select a patient to record vitals and notes, or to see the doctor&apos;s orders.</div>
          )}
        </section>
      </div>
    </div>
  )
}
