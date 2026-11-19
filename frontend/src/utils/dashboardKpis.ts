import type { DBOPEncounter } from "../services/db"
import type { ErVisitRecord } from "../services/erDb"
import type { BedRecord, DischargedPatientRecord } from "../services/bedDb"
import type { LabOrder } from "../services/labOrdersDb"
import type { SurgicalCase } from "../services/surgeryDb"
import { encounterArrivalMs } from "../services/encounterTime"

/**
 * The numbers on the main dashboard's KPI cards, worked out from the hospital's own records and nothing else.
 *
 *  - "Today" is the local calendar day (not UTC: in India a UTC "today" is yesterday until 5:30 am).
 *  - Each patient is counted once per card, whichever desks have them (an inpatient who also had an OP visit and an ER
 *    visit is one patient).
 *  - Trends are real: the last seven days, from the same records.
 */

export interface KpiInput {
  now: number
  encounters: DBOPEncounter[]
  /** Every ER visit, open and closed. */
  erVisits: ErVisitRecord[]
  beds: BedRecord[]
  discharged: DischargedPatientRecord[]
  labOrders: LabOrder[]
  surgeries: SurgicalCase[]
  /** Patient master: only for "new registrations today". */
  registeredAt?: (string | null | undefined)[]
}

const WEEK = 7

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const ms = (v: string | null | undefined): number | null => {
  if (!v) return null
  const n = String(v).trim().replace(" ", "T")
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(n) ? `${n}T00:00:00` : n).getTime()
  return Number.isFinite(t) ? t : null
}
const idOf = (s: unknown) => String(s ?? "").trim().toUpperCase()
const erId = (v: ErVisitRecord) => idOf(v.patient_id || v.patient?.patient_id) || `ER:${v.id}`

/**
 * The server's completed stays and this browser's own discharge records, as one list. The server is the record of truth (a
 * discharge made at another desk, or released from the bed board without a local record, only exists there); a stay is
 * the same stay when the patient and admission day match, and the server's copy wins.
 */
export function mergeStays(server: DischargedPatientRecord[], local: DischargedPatientRecord[]): DischargedPatientRecord[] {
  const key = (d: DischargedPatientRecord) => `${idOf(d.patientId)}|${String(d.admissionDate || "").slice(0, 10)}`
  const seen = new Set(server.map(key))
  return [...server, ...local.filter((d) => !seen.has(key(d)))]
}

/**
 * Server timestamps carry no offset and are UTC ("2026-11-13T10:38:49" is 4:08 pm in India). A bare midnight is a calendar
 * date (a date column), which must stay on that day, so it is left alone.
 */
export function serverStayTime(v: string | null | undefined): string {
  if (!v) return ""
  const t = String(v).trim().replace(" ", "T")
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t) || /T00:00(:00)?(\.0+)?$/.test(t)) return t
  return `${t}Z`
}

export const ER_WAITING = new Set(["pending", "doctor_assigned", ""])
const OP_DONE = new Set(["OP Completed"])

export interface Kpis {
  patients: { total: number; op: number; er: number; ip: number; newRegistrations: number; trend: number[] }
  appointments: { total: number; completed: number; inConsultation: number; waiting: number; trend: number[] }
  admissions: { today: number; inBeds: number; free: number; totalBeds: number; occupancyPct: number; trend: number[] }
  discharges: { today: number; planned: number; trend: number[] }
  ed: { active: number; waiting: number; underTreatment: number; bedRequested: number; critical: number; arrivalsToday: number; trend: number[] }
  alerts: { total: number; er: number; criticalLabs: number; statPending: number; trend: number[] }
  surgery: { inTheatre: number; waiting: number }
  /** Seven local day keys, oldest first (for trend labels). */
  days: string[]
  /**
   * Today hour by hour, running totals up to the current hour (so each line climbs as records come in). The last value of
   * each line is the card's own number for patients, appointments, admissions and discharges; ED and alerts are the
   * arrivals / alerts raised so far today.
   */
  hourly: { patients: number[]; appointments: number[]; admissions: number[]; discharges: number[]; ed: number[]; alerts: number[]; hour: number }
}

const hourOf = (t: number) => new Date(t).getHours()

/** Running totals by hour from a list of timestamps (ms) that are all today; `base` is how many were already counted at midnight. */
function running(times: number[], hour: number, base = 0): number[] {
  const per = Array.from({ length: hour + 1 }, () => 0)
  for (const t of times) per[Math.min(hour, hourOf(t))]++
  let sum = base
  return per.map((n) => (sum += n))
}

export function computeKpis(i: KpiInput): Kpis {
  const todayKey = dayKey(i.now)
  const days = Array.from({ length: WEEK }, (_, n) => dayKey(i.now - (WEEK - 1 - n) * 86_400_000))
  const idx = (key: string) => days.indexOf(key)
  const series = () => Array.from({ length: WEEK }, () => new Set<string>())

  // ── OP visits by day
  const opDay = series()
  const opToday: DBOPEncounter[] = []
  for (const e of i.encounters) {
    const t = encounterArrivalMs(e)
    if (t == null) continue
    const k = dayKey(t)
    if (k === todayKey) opToday.push(e)
    if (idx(k) >= 0) opDay[idx(k)].add(`${idOf(e.umr)}|${e.id}`)
  }

  // ── ER
  const erActive = i.erVisits.filter((v) => v.status !== "closed")
  const erArrDay = series()
  const erToday = new Set<string>()
  let erArrivalsToday = 0
  for (const v of i.erVisits) {
    const t = ms(v.arrival_at)
    if (t == null) continue
    const k = dayKey(t)
    if (k === todayKey) {
      erArrivalsToday++
      erToday.add(erId(v))
    }
    if (idx(k) >= 0) erArrDay[idx(k)].add(String(v.id))
  }
  erActive.forEach((v) => erToday.add(erId(v))) // still in the department today, whenever they arrived

  // ── beds
  const occupied = i.beds.filter((b) => b.status === "Occupied")
  const free = i.beds.filter((b) => b.status === "Available").length
  const admDay = series()
  let admittedToday = 0
  const ipToday = new Set<string>()
  const countAdmission = (when: string | null | undefined, who: string) => {
    const t = ms(when)
    if (t == null) return
    const k = dayKey(t)
    if (k === todayKey) {
      admittedToday++
      ipToday.add(who)
    }
    if (idx(k) >= 0) admDay[idx(k)].add(who + "|" + k)
  }
  const seenAdm = new Set<string>()
  for (const b of occupied) {
    const who = idOf(b.patient_id) || `BED:${b.id}`
    seenAdm.add(`${who}|${b.admission_date || b.allocated_at}`)
    countAdmission(b.admission_date || b.allocated_at, who)
  }
  for (const d of i.discharged) {
    const key = `${idOf(d.patientId)}|${d.admissionDate}`
    if (seenAdm.has(key)) continue
    countAdmission(d.admissionDate, idOf(d.patientId) || `D:${d.id}`)
  }
  const disDay = series()
  let dischargedToday = 0
  for (const d of i.discharged) {
    const t = ms(d.dischargeDate)
    if (t == null) continue
    const k = dayKey(t)
    if (k === todayKey) dischargedToday++
    if (idx(k) >= 0) disDay[idx(k)].add(String(d.id))
  }
  const planned = occupied.filter((b) => {
    const t = ms(b.expected_discharge_date)
    return t != null && dayKey(t) <= todayKey
  }).length

  // ── patients today: each person once, wherever they are
  const everyone = new Set<string>()
  const opPeople = new Set<string>()
  opToday.forEach((e) => {
    opPeople.add(idOf(e.umr))
    everyone.add(idOf(e.umr))
  })
  erToday.forEach((p) => everyone.add(p))
  const ipPeople = new Set<string>()
  occupied.forEach((b) => {
    const who = idOf(b.patient_id) || `BED:${b.id}`
    ipPeople.add(who)
    everyone.add(who)
  })
  ipToday.forEach((p) => everyone.add(p))
  i.discharged.forEach((d) => {
    const t = ms(d.dischargeDate)
    if (t != null && dayKey(t) === todayKey) everyone.add(idOf(d.patientId))
  })
  everyone.delete("")
  const peopleDay = series()
  opDay.forEach((s, n) => s.forEach((x) => peopleDay[n].add(x.split("|")[0])))
  i.erVisits.forEach((v) => {
    const t = ms(v.arrival_at)
    if (t != null && idx(dayKey(t)) >= 0) peopleDay[idx(dayKey(t))].add(erId(v))
  })
  admDay.forEach((s, n) => s.forEach((x) => peopleDay[n].add(x.split("|")[0])))

  // ── appointments (OP visits today)
  const completed = opToday.filter((e) => OP_DONE.has(e.status)).length
  const inConsultation = opToday.filter((e) => e.status === "Under Consultation").length
  const waiting = opToday.length - completed - inConsultation

  // ── ED
  const edWaiting = erActive.filter((v) => ER_WAITING.has(v.status || "")).length
  const edTreating = erActive.filter((v) => v.status === "under_treatment").length
  const edBed = erActive.filter((v) => v.status === "bed_requested").length
  const erCritical = erActive.filter((v) => v.triage_category === "ESI-1" || v.triage_category === "ESI-2").length

  // ── critical alerts: real critical results in the last 24 h, and STAT orders still open
  const since = i.now - 86_400_000
  const live = i.labOrders.filter((o) => o.status !== "Cancelled")
  const criticalLabs = live.filter((o) => o.tests?.some((t) => (t.flag === "Critical" || Object.values(t.results || {}).some((r) => r?.flag === "Critical")) && (ms(t.resultedAt) ?? ms(o.updatedAt) ?? 0) >= since)).length
  const statPending = live.filter((o) => o.status !== "Completed" && o.tests?.some((t) => String(t.urgency).toUpperCase() === "STAT")).length

  // ── surgery (the module's own statuses)
  const inTheatre = i.surgeries.filter((c) => c.status === "In Surgery" || c.status === "PACU Recovery").length
  const surgWaiting = i.surgeries.filter((c) => c.status === "PAC Pending" || c.status === "PAC Cleared" || c.status === "Pre-Op Holding").length

  // ── critical alerts raised per day (ESI-1/2 arrivals + orders with a critical result that day): the card's history
  const alertDay = series()
  const criticalTimes: number[] = [] // today's, for the hourly line
  const noteAlert = (t: number | null, id: string) => {
    if (t == null) return
    const k = dayKey(t)
    if (idx(k) >= 0) alertDay[idx(k)].add(id)
    if (k === todayKey) criticalTimes.push(t)
  }
  for (const v of i.erVisits) if (v.triage_category === "ESI-1" || v.triage_category === "ESI-2") noteAlert(ms(v.arrival_at), `ER:${v.id}`)
  for (const o of live) {
    const t = (o.tests || [])
      .filter((x) => x.flag === "Critical" || Object.values(x.results || {}).some((r) => r?.flag === "Critical"))
      .map((x) => ms(x.resultedAt) ?? ms(o.updatedAt))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)[0]
    noteAlert(t ?? null, `LAB:${o.id}`)
  }

  // ── today hour by hour (running totals up to now)
  const hour = hourOf(i.now)
  const firstSeen = new Map<string, number>() // each person's first record today
  const seeOnce = (who: string, t: number | null) => {
    if (!who || t == null || dayKey(t) !== todayKey) return
    firstSeen.set(who, Math.min(firstSeen.get(who) ?? Infinity, t))
  }
  for (const e of opToday) seeOnce(idOf(e.umr), encounterArrivalMs(e))
  for (const v of i.erVisits) seeOnce(erId(v), ms(v.arrival_at))
  for (const b of occupied) seeOnce(idOf(b.patient_id) || `BED:${b.id}`, ms(b.admission_date || b.allocated_at))
  for (const d of i.discharged) {
    seeOnce(idOf(d.patientId), ms(d.admissionDate))
    seeOnce(idOf(d.patientId), ms(d.dischargeDate))
  }
  const withToday = [...firstSeen.keys()].filter((k) => everyone.has(k))
  const baseline = everyone.size - withToday.length // here since before today (in a bed or in ER from an earlier day)
  const admTimes: number[] = []
  occupied.forEach((b) => {
    const t = ms(b.admission_date || b.allocated_at)
    if (t != null && dayKey(t) === todayKey) admTimes.push(t)
  })
  i.discharged.forEach((d) => {
    const key = `${idOf(d.patientId)}|${d.admissionDate}`
    const t = ms(d.admissionDate)
    if (!seenAdm.has(key) && t != null && dayKey(t) === todayKey) admTimes.push(t)
  })
  const disTimes = i.discharged.map((d) => ms(d.dischargeDate)).filter((t): t is number => t != null && dayKey(t) === todayKey)
  const hourly = {
    patients: running(withToday.map((k) => firstSeen.get(k)!), hour, baseline),
    appointments: running(opToday.map((e) => encounterArrivalMs(e)).filter((t): t is number => t != null), hour),
    admissions: running(admTimes, hour),
    discharges: running(disTimes, hour),
    ed: running(i.erVisits.map((v) => ms(v.arrival_at)).filter((t): t is number => t != null && dayKey(t) === todayKey), hour),
    alerts: running(criticalTimes, hour),
    hour,
  }

  const reg = (i.registeredAt ?? []).filter((r) => {
    const t = ms(r)
    return t != null && dayKey(t) === todayKey
  }).length

  return {
    patients: { total: everyone.size, op: opPeople.size, er: erToday.size, ip: ipPeople.size, newRegistrations: reg, trend: peopleDay.map((s) => s.size) },
    appointments: { total: opToday.length, completed, inConsultation, waiting, trend: opDay.map((s) => s.size) },
    admissions: { today: admittedToday, inBeds: occupied.length, free, totalBeds: i.beds.length, occupancyPct: i.beds.length ? Math.round((occupied.length / i.beds.length) * 100) : 0, trend: admDay.map((s) => s.size) },
    discharges: { today: dischargedToday, planned, trend: disDay.map((s) => s.size) },
    ed: { active: erActive.length, waiting: edWaiting, underTreatment: edTreating, bedRequested: edBed, critical: erCritical, arrivalsToday: erArrivalsToday, trend: erArrDay.map((s) => s.size) },
    alerts: { total: erCritical + criticalLabs, er: erCritical, criticalLabs, statPending, trend: alertDay.map((x) => x.size) },
    surgery: { inTheatre, waiting: surgWaiting },
    days,
    hourly,
  }
}
