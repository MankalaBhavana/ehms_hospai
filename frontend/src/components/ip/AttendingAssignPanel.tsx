import { useState } from "react"
import { IpCare, currentActor, dayOfStay, listDoctors, type IpCase } from "../../services/ipCare"
import type { DoctorAccount } from "../../services/doctorPortalDb"
import ConcernDoctorPicker from "./ConcernDoctorPicker"
import { useIpCare } from "./useIpCare"

/**
 * Admitted patients who have no concern doctor yet, with the one click that gives them one. Shown on Bed
 * Management and the Inpatient board; the doctor is told as soon as it is saved.
 */
export default function AttendingAssignPanel({ by }: { by?: string }) {
  const { unassigned } = useIpCare()
  const [picked, setPicked] = useState<Record<string, DoctorAccount | null>>({})
  const [msg, setMsg] = useState("")
  if (unassigned.length === 0) return null
  const save = (c: IpCase) => {
    const d = picked[c.id]
    if (!d) return
    IpCare.assignAttending(c.id, d, by || currentActor().name)
    setMsg(`${d.name} is now the concern doctor of ${c.patientName} and has been told.`)
    window.setTimeout(() => setMsg(""), 5000)
  }
  return (
    <div className="bg-amber-50 border border-amber-300 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-amber-900">⚠ {unassigned.length} admitted patient{unassigned.length > 1 ? "s" : ""} without a concern doctor</span>
        <span className="text-[11.5px] text-amber-800">Until one is named the patient is in nobody&apos;s IP list.</span>
      </div>
      {msg && <div className="text-[12px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1">✓ {msg}</div>}
      {unassigned.map((c) => (
        <div key={c.id} className="bg-white border border-amber-200 p-2.5 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px]">
            <div className="text-[13px] font-bold text-slate-900">{c.patientName}</div>
            <div className="text-[11.5px] text-slate-600">
              {c.ward} · Room {c.roomNo} · Bed {c.bedNo} · Day {dayOfStay(c.admittedAt)}
              {c.reason ? ` · ${c.reason}` : ""}
            </div>
          </div>
          <ConcernDoctorPicker
            className="min-w-[260px] flex-1"
            label="Concern doctor"
            required
            value={picked[c.id]?.id || ""}
            onChange={(d) => setPicked((p) => ({ ...p, [c.id]: d }))}
            specialtyHint={c.specialty || c.ward}
          />
          <button
            type="button"
            disabled={!picked[c.id] || listDoctors().length === 0}
            onClick={() => save(c)}
            className="h-9 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold disabled:opacity-40 cursor-pointer"
          >
            Assign
          </button>
        </div>
      ))}
    </div>
  )
}
