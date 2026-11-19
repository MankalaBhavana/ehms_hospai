import { useEffect, useMemo, useState } from "react"
import type { DoctorAccount } from "../../services/doctorPortalDb"
import { IpCare, attentionFlags, currentActor, dayOfStay } from "../../services/ipCare"
import IpPatientCare from "../ip/IpPatientCare"
import { useIpCare } from "../ip/useIpCare"

/**
 * "IP patients" in a doctor's own workspace: every admitted patient the doctor is the concern (attending) doctor of,
 * with how long they have been in, where they are, whether anything needs the doctor's eye, and -- on selection --
 * the whole stay: monitoring, doctor notes, nurse notes, orders, investigations, handover.
 */
export default function InpatientRounds({ doctor, readOnly = false, now }: { doctor: DoctorAccount; readOnly?: boolean; now: number }) {
  const { rev } = useIpCare()
  const mine = useMemo(() => IpCare.casesOfDoctor(doctor).sort((a, b) => b.admittedAt.localeCompare(a.admittedAt)), [doctor, rev])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [q, setQ] = useState("")

  useEffect(() => {
    if (selectedId && !mine.some((c) => c.id === selectedId)) setSelectedId(null)
    if (!selectedId && mine.length) setSelectedId(mine[0].id)
  }, [mine, selectedId])

  const shown = mine.filter((c) => !q.trim() || `${c.patientName} ${c.patientId} ${c.ward} ${c.bedNo}`.toLowerCase().includes(q.trim().toLowerCase()))
  const selected = mine.find((c) => c.id === selectedId)
  const actor = currentActor()
  const attention = useMemo(() => mine.map((c) => ({ id: c.id, why: attentionFlags(c, now) })), [mine, Math.floor(now / 60000), rev])
  const flagged = attention.filter((a) => a.why.length).length

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      <aside className="lg:w-[320px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col lg:min-h-0 max-h-[40vh] lg:max-h-none">
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-bold text-slate-900">IP patients</h2>
            <span className="text-[11.5px] text-slate-500">
              {mine.length} under you{flagged ? ` · ${flagged} need attention` : ""}
            </span>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, UMR, ward, bed" className="w-full h-8 px-2.5 border border-slate-300 text-[12.5px] rounded-none focus:outline-none focus:border-blue-700" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {mine.length === 0 && (
            <div className="p-4 text-[12.5px] text-slate-600">
              No admitted patients are under you right now. When the ER or Bed Management names you as the concern doctor, the patient appears here and in your notifications.
            </div>
          )}
          {shown.map((c) => {
            const why = attention.find((a) => a.id === c.id)?.why || []
            const pend = IpCare.orders(c.patientId).filter((o) => o.status !== "done").length
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-100 cursor-pointer ${selectedId === c.id ? "bg-[#EFF6FF] border-l-4 border-l-[#1B4FD8]" : "hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-slate-900 truncate">{c.patientName}</span>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">Day {dayOfStay(c.admittedAt, now)}</span>
                </div>
                <div className="text-[11.5px] text-slate-600 truncate">
                  {c.ward} · Room {c.roomNo} · Bed {c.bedNo}
                </div>
                {c.reason && <div className="text-[11.5px] text-slate-500 truncate">{c.reason}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {why.map((w) => (
                    <span key={w} className="text-[10.5px] font-bold px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200">
                      {w}
                    </span>
                  ))}
                  {pend > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">{pend} order{pend > 1 ? "s" : ""} pending</span>}
                  {/icu/i.test(`${c.ward} ${c.bedType || ""}`) && <span className="text-[10.5px] font-bold px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200">ICU</span>}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-5 bg-[#F0F2F5]">
        {selected ? (
          <IpPatientCare key={selected.id} ipCase={selected} mode="doctor" actor={actor} doctor={doctor} canWrite={!readOnly} />
        ) : (
          <div className="bg-white border border-slate-200 p-8 text-center text-[13px] text-slate-600">Select an admitted patient to see monitoring, notes and orders.</div>
        )}
      </section>
    </div>
  )
}
