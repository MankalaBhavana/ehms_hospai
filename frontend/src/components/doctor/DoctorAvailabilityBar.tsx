import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import { apiFetch } from "../../lib/api"
import { refreshDoctorAvailability } from "../../services/doctorLiveAvailability"

type Slot = { start: string; end: string }

type Me = {
  status: string
  status_label: string
  is_eligible: boolean
  current_workload: number
  max_workload: number
  slots?: Slot[]
  eligibility_reasons?: { not_manually_unavailable?: boolean }
  schedule?: { start_time?: string; end_time?: string }
}

const MAX_SLOTS = 6

const TONE: Record<string, string> = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-300",
  busy: "bg-amber-50 text-amber-700 border-amber-300",
  off_duty: "bg-slate-100 text-slate-700 border-slate-300",
  on_leave: "bg-violet-50 text-violet-700 border-violet-300",
  unavailable: "bg-rose-50 text-rose-700 border-rose-300",
  offline: "bg-slate-100 text-slate-700 border-slate-300",
}

const DEFAULT_SLOT: Slot = { start: "09:00", end: "17:00" }

const slotsOf = (me: Me): Slot[] =>
  me.slots && me.slots.length
    ? me.slots
    : [{ start: me.schedule?.start_time || DEFAULT_SLOT.start, end: me.schedule?.end_time || DEFAULT_SLOT.end }]

/**
 * Shown to a signed-in doctor: switch Active / Inactive and set the daily time slots.
 * Saves to the availability engine, which decides who may be scheduled appointments.
 */
export default function DoctorAvailabilityBar() {
  const [me, setMe] = useState<Me | null>(null)
  const [hidden, setHidden] = useState(false) // this account has no doctor profile
  const [slots, setSlots] = useState<Slot[]>([DEFAULT_SLOT])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ doctor?: Me }>("/api/doctor-availability/me")
      if (!res?.doctor) return
      setMe(res.doctor)
      setHidden(false)
      if (!dirty) setSlots(slotsOf(res.doctor))
    } catch (error: any) {
      if (error?.status === 404) setHidden(true)
    }
  }, [dirty])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  if (hidden || !me) return null

  const isActive = me.eligibility_reasons?.not_manually_unavailable !== false
  const tone = TONE[me.status] || TONE.offline
  const slotsValid = slots.length > 0 && slots.every((s) => s.start && s.end && s.start !== s.end)

  const edit = (next: Slot[]) => {
    setSlots(next)
    setDirty(true)
  }

  const setActive = async (next: boolean) => {
    setBusy(true)
    try {
      const res = await apiFetch<{ doctor: Me; message: string }>("/api/doctor-availability/me/status", {
        method: "POST",
        body: JSON.stringify({ is_active: next }),
      })
      setMe(res.doctor)
      toast.success(res.message || (next ? "You are now Active" : "You are now Inactive"))
      void refreshDoctorAvailability()
    } catch (error: any) {
      toast.error(error?.message || "Could not update your status")
    } finally {
      setBusy(false)
    }
  }

  const saveSlots = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ doctor: Me; message: string }>("/api/doctor-availability/me/schedule", {
        method: "PUT",
        body: JSON.stringify({ slots }),
      })
      setMe(res.doctor)
      setSlots(slotsOf(res.doctor))
      setDirty(false)
      toast.success(res.message || "Time slots saved")
      void refreshDoctorAvailability()
    } catch (error: any) {
      toast.error(error?.message || "Could not save the time slots")
    } finally {
      setBusy(false)
    }
  }

  const timeInput = "h-8 border border-[#CBD5E1] bg-[#F8FAFC] px-2 text-[12.5px] focus:border-[#1B4FD8] focus:outline-none"

  return (
    <div className="shrink-0 border-b border-[#DDE2EC] bg-white px-4 py-2.5 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[#0F172A]">My availability</span>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            disabled={busy}
            onClick={() => void setActive(!isActive)}
            className={`flex h-6 w-11 items-center border p-0.5 transition-colors disabled:opacity-60 ${
              isActive ? "justify-end border-emerald-600 bg-emerald-600" : "justify-start border-slate-300 bg-slate-200"
            }`}
            title={isActive ? "Click to go Inactive (no new appointments)" : "Click to go Active (accept appointments)"}
          >
            <span className="h-4 w-4 bg-white shadow" />
          </button>
          <span className={`font-bold ${isActive ? "text-emerald-700" : "text-slate-600"}`}>
            {isActive ? "Active" : "Inactive"}
          </span>
          <span className={`border px-2 py-0.5 text-[11.5px] font-semibold ${tone}`} title="Current status in the assignment engine">
            {me.status_label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-semibold text-[#475569]">Time slots</span>
          {slots.map((slot, i) => (
            <span key={i} className="flex items-center gap-1.5 border border-[#E2E8F0] bg-white px-1.5 py-1">
              <input
                type="time"
                value={slot.start}
                onChange={(e) => edit(slots.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))}
                className={timeInput}
                aria-label={`Slot ${i + 1} start time`}
              />
              <span className="text-[#64748B]">to</span>
              <input
                type="time"
                value={slot.end}
                onChange={(e) => edit(slots.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))}
                className={timeInput}
                aria-label={`Slot ${i + 1} end time`}
              />
              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => edit(slots.filter((_, j) => j !== i))}
                  className="h-8 w-7 border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                  title="Remove this slot"
                  aria-label={`Remove slot ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {slots.length < MAX_SLOTS && (
            <button
              type="button"
              onClick={() => edit([...slots, { start: "14:00", end: "18:00" }])}
              className="h-8 border border-dashed border-blue-400 bg-white px-3 font-semibold text-[#1B4FD8] hover:bg-blue-50"
            >
              + Add slot
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveSlots()}
            disabled={busy || !dirty || !slotsValid}
            className="h-8 border border-blue-600 bg-[#1B4FD8] px-3 font-semibold text-white transition-colors hover:bg-[#1740B4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save slots
          </button>
        </div>

        <div className="ml-auto text-[12px] text-[#64748B]">
          Patients today: <b className="text-[#0F172A]">{me.current_workload}</b> / {me.max_workload}
        </div>
      </div>
    </div>
  )
}
