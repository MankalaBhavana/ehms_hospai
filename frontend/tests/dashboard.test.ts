import "./shim"
import { computeKpis, dayKey, mergeStays, serverStayTime } from "../src/utils/dashboardKpis"

let failed = 0
const results: string[] = []
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + detail))
}

// 18 Nov 2026, 10:00 local
const now = new Date(2026, 10, 18, 10, 0, 0).getTime()
const at = (daysAgo: number, h = 9, m = 0) => new Date(2026, 10, 18 - daysAgo, h, m, 0).toISOString()
const iso = (daysAgo: number, h = 9) => at(daysAgo, h)
const enc = (id: string, umr: string, daysAgo: number, status = "Registered") => ({ id, umr, status, patientName: umr, createdAt: iso(daysAgo), date: dayKey(new Date(iso(daysAgo)).getTime()), registrationTime: "9:00 AM" }) as any
const er = (id: number, pid: string | null, daysAgo: number, status: string, triage: string | null = null) => ({ id, patient_id: pid, status, triage_category: triage, arrival_at: iso(daysAgo) }) as any
const bed = (id: number, pid: string | null, status: string, admDaysAgo?: number, expected?: string) => ({ id, ward: "Ward", status, patient_id: pid, admission_date: admDaysAgo === undefined ? null : iso(admDaysAgo), allocated_at: admDaysAgo === undefined ? null : iso(admDaysAgo), expected_discharge_date: expected ?? null }) as any
const disc = (id: string, pid: string, adm: number, dis: number) => ({ id, patientId: pid, admissionDate: iso(adm), dischargeDate: iso(dis) }) as any
const lab = (id: string, status: string, tests: any[], updated = iso(0)) => ({ id, status, tests, updatedAt: updated, createdAt: updated }) as any

const base = { now, encounters: [] as any[], erVisits: [] as any[], beds: [] as any[], discharged: [] as any[], labOrders: [] as any[], surgeries: [] as any[] }

// An empty hospital reads zero everywhere (nothing invented)
const z = computeKpis(base)
check("an empty hospital is all zeros", z.patients.total === 0 && z.appointments.total === 0 && z.admissions.today === 0 && z.discharges.today === 0 && z.ed.active === 0 && z.alerts.total === 0 && z.patients.trend.every((n) => n === 0))
check("seven day labels, oldest first, ending today", z.days.length === 7 && z.days[6] === "2026-11-18" && z.days[0] === "2026-11-12", z.days.join(","))

// The old card added every encounter ever + ER + occupied beds. Now: only today, each person once.
const k = computeKpis({
  ...base,
  encounters: [enc("E1", "PAT-1", 0), enc("E2", "PAT-2", 0, "OP Completed"), enc("E3", "PAT-3", 0, "Under Consultation"), enc("E4", "PAT-4", 3), enc("E5", "PAT-5", 40), enc("E6", "PAT-1", 2)],
  erVisits: [er(1, "PAT-6", 0, "pending", "ESI-3"), er(2, "PAT-7", 1, "under_treatment", "ESI-2"), er(3, "PAT-1", 0, "doctor_assigned"), er(4, "PAT-8", 0, "closed"), er(5, null, 0, "bed_requested", "ESI-1")],
  beds: [bed(1, "PAT-7", "Occupied", 0, iso(0)), bed(2, "PAT-9", "Occupied", 5, iso(-1)), bed(3, null, "Available"), bed(4, null, "Available"), bed(5, null, "Maintenance")],
  discharged: [disc("D1", "PAT-10", 6, 0), disc("D2", "PAT-11", 4, 2), disc("D3", "PAT-12", 0, 0)],
})
// OP today: PAT-1, 2, 3. ER today: PAT-6, PAT-7 (open since yesterday), PAT-1, PAT-8 (closed, arrived today), one with no id.
// In beds: PAT-7, PAT-9. Admitted today: PAT-7, PAT-12. Discharged today: PAT-10, PAT-12.
check("patients today counts each person once, only today / in hospital today", k.patients.total === 10, String(k.patients.total))
check("old encounter history is not counted (PAT-4 three days ago, PAT-5 forty days ago)", k.patients.total < 18)
check("OP / ER / IP breakdown", k.patients.op === 3 && k.patients.er === 5 && k.patients.ip === 2, JSON.stringify(k.patients))
check("appointments are the visits made today: 3, with 1 completed, 1 in consultation, 1 waiting", k.appointments.total === 3 && k.appointments.completed === 1 && k.appointments.inConsultation === 1 && k.appointments.waiting === 1, JSON.stringify(k.appointments))
check("admissions today = admitted today (still in bed or already discharged), not beds occupied", k.admissions.today === 2 && k.admissions.inBeds === 2, JSON.stringify(k.admissions))
check("occupancy and free beds come from the bed board (a bed in maintenance is neither free nor occupied)", k.admissions.free === 2 && k.admissions.totalBeds === 5 && k.admissions.occupancyPct === 40, JSON.stringify(k.admissions))
check("discharges today are people discharged today (not the all-time total)", k.discharges.today === 2, String(k.discharges.today))
check("discharges planned = occupied beds whose expected discharge is today or earlier", k.discharges.planned === 1, String(k.discharges.planned))
check("ED: active excludes closed; waiting / treating / bed requested split", k.ed.active === 4 && k.ed.waiting === 2 && k.ed.underTreatment === 1 && k.ed.bedRequested === 1, JSON.stringify(k.ed))
check("ED critical = ESI-1 and ESI-2 among active", k.ed.critical === 2, String(k.ed.critical))
check("ED arrivals today counts today's arrivals only", k.ed.arrivalsToday === 4, String(k.ed.arrivalsToday))
check("trend: seven points, today's point equals today's count", k.patients.trend.length === 7 && k.patients.trend[6] > 0 && k.appointments.trend[6] === 3 && k.discharges.trend[6] === 2, JSON.stringify([k.patients.trend, k.appointments.trend, k.discharges.trend]))
check("trend shows real history (OP visits three days ago and two days ago)", k.appointments.trend[3] === 1 && k.appointments.trend[4] === 1, JSON.stringify(k.appointments.trend))

// critical alerts: real critical results (last 24 h) and ER ESI-1/2; STAT pending is counted separately, not as critical
const a = computeKpis({
  ...base,
  erVisits: [er(1, "P1", 0, "pending", "ESI-1"), er(2, "P2", 0, "closed", "ESI-1")],
  labOrders: [
    lab("L1", "Completed", [{ urgency: "Routine", flag: "Critical", resultedAt: iso(0, 8) }]),
    lab("L2", "Completed", [{ urgency: "Routine", flag: "Critical", resultedAt: at(3) }], at(3)), // old
    lab("L3", "In Progress", [{ urgency: "STAT", flag: "" }]),
    lab("L4", "Cancelled", [{ urgency: "STAT", flag: "Critical", resultedAt: iso(0, 8) }]),
    lab("L5", "Completed", [{ urgency: "Routine", flag: "", results: { Potassium: { value: "6.8", flag: "Critical" } }, resultedAt: iso(0, 9) }]),
  ],
})
check("critical alerts = open ER ESI-1/2 + critical lab results from the last 24 h (old and cancelled ignored)", a.alerts.er === 1 && a.alerts.criticalLabs === 2 && a.alerts.total === 3, JSON.stringify(a.alerts))
check("a pending STAT order is shown as STAT pending, not as a critical result", a.alerts.statPending === 1, JSON.stringify(a.alerts))

// surgery uses the surgery module's own statuses
const s = computeKpis({ ...base, surgeries: [{ status: "In Surgery" }, { status: "PACU Recovery" }, { status: "PAC Pending" }, { status: "Pre-Op Holding" }, { status: "Completed" }] as any })
check("surgery: in theatre = In Surgery + PACU Recovery; waiting = PAC Pending / Cleared / Pre-Op", s.surgery.inTheatre === 2 && s.surgery.waiting === 2, JSON.stringify(s.surgery))

// local day, not UTC: 00:30 on 18 Nov local is still 18 Nov
const early = new Date(2026, 10, 18, 0, 30).getTime()
const e1 = computeKpis({ ...base, now: early, encounters: [{ id: "E", umr: "P", status: "Registered", createdAt: new Date(2026, 10, 18, 0, 10).toISOString(), registrationTime: "12:10 AM" } as any] })
check("a visit at 00:10 local counts as today (the old UTC 'today' made it yesterday)", e1.appointments.total === 1 && e1.patients.total === 1, JSON.stringify(e1.appointments))

// new registrations
const r = computeKpis({ ...base, registeredAt: [iso(0), iso(0, 11), iso(2), null] })
check("new registrations today come from the patient master", r.patients.newRegistrations === 2, String(r.patients.newRegistrations))

console.log(results.join("\n"))
console.log(failed ? `${failed} FAILED` : "ALL DASHBOARD CHECKS PASSED")
process.exit(failed ? 1 : 0)
