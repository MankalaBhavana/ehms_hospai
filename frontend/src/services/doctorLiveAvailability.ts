import { useEffect, useState } from "react"
import { apiFetch } from "../lib/api"

/**
 * Live "is this doctor active right now?" answers from the server's availability engine
 * (account active, logged in, inside their time slot, not on leave, not set Inactive, below capacity).
 *
 * Appointment and OP screens use this so that only active doctors are listed or scheduled.
 * Until the first answer arrives -- or when the server cannot be reached -- nothing is hidden
 * (`known` is false); the server still refuses a booking for an unavailable doctor.
 */
export type LiveDoctorStatus = {
  eligible: boolean
  status: string
  label: string
}

const EVENT = "doctor_live_availability_updated"
const POLL_MS = 20_000

let byKey = new Map<string, LiveDoctorStatus>()
let loaded = false
let inflight: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let subscribers = 0

const norm = (v?: string | null) =>
  String(v || "")
    .replace(/^dr\.?\s*/i, "")
    .trim()
    .toLowerCase()

export async function refreshDoctorAvailability(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await apiFetch<{ doctors?: any[] }>("/api/doctor-availability")
      const next = new Map<string, LiveDoctorStatus>()
      for (const d of res?.doctors || []) {
        const entry: LiveDoctorStatus = {
          eligible: Boolean(d.is_eligible),
          status: String(d.status || ""),
          label: String(d.status_label || d.status || ""),
        }
        for (const k of [d.doctor_name, d.name, d.staff_id, d.username]) {
          const key = norm(k)
          if (key) next.set(key, entry)
        }
      }
      byKey = next
      loaded = true
      window.dispatchEvent(new Event(EVENT))
    } catch {
      // keep the previous answer; the server remains the final check
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Live status for a doctor, or null when the engine has no answer for them. */
export function liveStatusOf(doctor: { name?: string; staffId?: string; username?: string; id?: string }): LiveDoctorStatus | null {
  if (!loaded) return null
  for (const k of [doctor.name, doctor.staffId, doctor.username, doctor.id]) {
    const hit = byKey.get(norm(k))
    if (hit) return hit
  }
  return null
}

/** False only when the engine positively says the doctor cannot take patients now. */
export function isLiveActive(doctor: { name?: string; staffId?: string; username?: string; id?: string }): boolean {
  const s = liveStatusOf(doctor)
  return s ? s.eligible : true
}

/** Subscribe a component: re-renders on every refresh and keeps the answers fresh while mounted. */
export function useLiveDoctorAvailability(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onUpdate = () => setTick((t) => t + 1)
    window.addEventListener(EVENT, onUpdate)
    subscribers += 1
    void refreshDoctorAvailability()
    if (!timer) timer = setInterval(() => void refreshDoctorAvailability(), POLL_MS)
    return () => {
      window.removeEventListener(EVENT, onUpdate)
      subscribers -= 1
      if (subscribers <= 0 && timer) {
        clearInterval(timer)
        timer = null
        subscribers = 0
      }
    }
  }, [])
  return tick
}
