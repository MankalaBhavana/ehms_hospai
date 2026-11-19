/**
 * In-patient care: who is the CONCERN (attending) doctor of every admitted patient, and the doctor notes, nurse
 * notes, nursing orders and vitals that follow the patient through the stay.
 *
 * The journey:
 *   1. ER doctor examines the patient and decides to admit -> picks the concern doctor (a referral is recorded).
 *   2. Bed Management allocates a bed (ER request, direct admission, transfer ... any path).
 *   3. `reconcile()` sees the occupied bed, opens the patient's CASE with that doctor as attending and tells the
 *      doctor. A patient who got a bed without a concern doctor is flagged and Bed Management / Inpatient is
 *      asked to assign one.
 *   4. The attending doctor sees the patient in "IP patients" in their own workspace, with monitoring, notes
 *      and orders; the nurses see the same patient on their ward list. The doctor can hand the patient over
 *      to another doctor (recorded).
 *   5. When the bed is released the case closes.
 *
 * Everything is kept in id-keyed arrays under `hospai_ip_*` keys, so the shared-data sync merges two desks'
 * changes record by record. Nothing here invents clinical data.
 */
import { BedDatabase } from "./bedDb"
import { getAllDoctorAccounts, normalizeDoctorName, type DoctorAccount } from "./doctorPortalDb"
import { handOff } from "./handoffs"

const K_CASES = "hospai_ip_cases_v1"
const K_REFERRALS = "hospai_ip_referrals_v1"
const K_NOTES = "hospai_ip_notes_v1"
const K_ORDERS = "hospai_ip_orders_v1"
export const IP_CARE_EVENT = "hospai:ip-care-changed"

export interface Vitals {
  bp?: string
  pulse?: string
  temperature?: string
  spo2?: string
  rr?: string
  pain?: string
  sugar?: string
}

export interface IpReferral {
  id: string
  patientId: string
  patientName: string
  erVisitId?: number | null
  visitNo?: string | null
  concernDoctorId: string
  concernDoctorName: string
  specialty?: string | null
  reason?: string | null
  levelOfCare?: string | null
  decidedBy?: string | null
  decidedAt: string
  status: "open" | "admitted" | "cancelled"
}

export interface IpHandover {
  at: string
  by: string
  fromDoctorName: string
  toDoctorId: string
  toDoctorName: string
  reason: string
}

export interface IpCase {
  /** `${patientId}|${admission key}` */
  id: string
  patientId: string
  patientName: string
  admissionId?: number | null
  bedId?: number | null
  ward: string
  roomNo: string
  bedNo: string
  bedType?: string | null
  admittedAt: string
  source: "ER" | "Direct"
  erVisitNo?: string | null
  /** Why the patient was admitted, as the admitting doctor / bed request recorded it. */
  reason?: string | null
  attendingDoctorId?: string | null
  attendingDoctorName?: string | null
  attendingStaffId?: string | null
  specialty?: string | null
  assignedBy?: string | null
  assignedAt?: string | null
  handovers: IpHandover[]
  status: "active" | "discharged"
  closedAt?: string | null
}

export type NoteKind = "doctor" | "nurse" | "handover"

export interface IpNote {
  id: string
  patientId: string
  caseId: string
  kind: NoteKind
  text: string
  /** Doctor notes: the plan / orders that follow from the note. */
  plan?: string
  vitals?: Vitals
  byId: string
  byName: string
  byRole: string
  at: string
  /** Entered by dictation (the author reviewed the text before saving). */
  voice?: boolean
}

export interface IpOrder {
  id: string
  patientId: string
  caseId: string
  text: string
  priority: "routine" | "urgent" | "stat"
  status: "pending" | "acknowledged" | "done"
  byDoctorId: string
  byDoctorName: string
  at: string
  ackBy?: string
  ackAt?: string
  doneBy?: string
  doneAt?: string
  doneNote?: string
}

// ── storage ──────────────────────────────────────────────────────────────────

function read<T>(key: string): T[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

function write<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* quota: keep working */
  }
  listeners.forEach((l) => l())
  try {
    window.dispatchEvent(new Event(IP_CARE_EVENT))
  } catch {
    /* no window (tests) */
  }
}

const listeners = new Set<() => void>()
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const norm = (s?: string | null) => String(s || "").trim().toUpperCase()

/** Does this doctor account stand for the doctor a case / referral names? */
export function isSameDoctor(doc: Pick<DoctorAccount, "id" | "staffId" | "name">, id?: string | null, name?: string | null, staffId?: string | null): boolean {
  if (id && (norm(id) === norm(doc.id) || norm(id) === norm(doc.staffId))) return true
  if (staffId && (norm(staffId) === norm(doc.staffId) || norm(staffId) === norm(doc.id))) return true
  const a = normalizeDoctorName(name)
  return Boolean(a && a === normalizeDoctorName(doc.name))
}

// ── the service ──────────────────────────────────────────────────────────────

export const IpCare = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  cases(): IpCase[] {
    return read<IpCase>(K_CASES)
  },
  activeCases(): IpCase[] {
    return IpCare.cases().filter((c) => c.status === "active")
  },
  caseFor(patientId: string): IpCase | undefined {
    return IpCare.activeCases().find((c) => norm(c.patientId) === norm(patientId))
  },
  casesOfDoctor(doc: Pick<DoctorAccount, "id" | "staffId" | "name">): IpCase[] {
    return IpCare.activeCases().filter((c) => isSameDoctor(doc, c.attendingDoctorId, c.attendingDoctorName, c.attendingStaffId))
  },
  unassigned(): IpCase[] {
    return IpCare.activeCases().filter((c) => !c.attendingDoctorId && !c.attendingDoctorName)
  },

  referrals(): IpReferral[] {
    return read<IpReferral>(K_REFERRALS)
  },
  openReferralFor(patientId: string): IpReferral | undefined {
    return IpCare.referrals()
      .filter((r) => r.status === "open" && norm(r.patientId) === norm(patientId))
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]
  },

  /**
   * The admitting (ER) doctor names the concern doctor. Bed Management finds this when the bed is allocated; the
   * concern doctor hears about the patient at once, before the bed is even ready.
   */
  recordReferral(r: Omit<IpReferral, "id" | "decidedAt" | "status"> & { decidedAt?: string }): IpReferral {
    const now = r.decidedAt || new Date().toISOString()
    const all = IpCare.referrals()
    // One open referral per patient: a new decision replaces the open one.
    const rest = all.map((x) => (x.status === "open" && norm(x.patientId) === norm(r.patientId) ? { ...x, status: "cancelled" as const } : x))
    const ref: IpReferral = { ...r, id: uid("REF"), decidedAt: now, status: "open" }
    write(K_REFERRALS, [ref, ...rest].slice(0, 500))
    handOff({
      to: "doctor",
      audience: r.concernDoctorId || r.concernDoctorName,
      from: `Emergency · ${r.decidedBy || "ER doctor"}`,
      patientName: r.patientName,
      patientId: r.patientId,
      kind: "Admission advised — you are the concern doctor",
      note: [r.levelOfCare, r.reason].filter(Boolean).join(" · ") || undefined,
      ref: `${ref.id}:referral`,
      urgent: /icu|stat|emergency/i.test(`${r.levelOfCare || ""}`),
    })
    return ref
  },

  /**
   * Opens a case for every occupied bed that has none, closes the case of a patient whose bed was released, and
   * keeps ward / bed up to date after a transfer. Safe to call from anywhere, any number of times.
   */
  reconcile(): void {
    let beds: ReturnType<typeof BedDatabase.getBeds> = []
    try {
      beds = BedDatabase.getBeds()
    } catch {
      return
    }
    if (!beds.length) return // beds not loaded yet: closing cases now would be a guess
    const occupied = beds.filter((b) => b.status === "Occupied" && b.patient_id)
    const cases = IpCare.cases()
    let changed = false
    const next = cases.map((c) => ({ ...c }))
    const raised: { c: IpCase; ref?: IpReferral }[] = []

    for (const bed of occupied) {
      const pid = String(bed.patient_id)
      const existing = next.find((c) => c.status === "active" && norm(c.patientId) === norm(pid))
      const name = [bed.patient_name, bed.patient_last_name].filter(Boolean).join(" ").trim() || pid
      if (existing) {
        if (existing.bedId !== bed.id || existing.ward !== bed.ward || existing.bedNo !== bed.bed_no || existing.roomNo !== bed.room_no) {
          existing.bedId = bed.id
          existing.ward = bed.ward
          existing.roomNo = bed.room_no
          existing.bedNo = bed.bed_no
          existing.bedType = bed.bed_type
          changed = true
        }
        // The attending doctor arrives after the bed (referral recorded late): attach it.
        if (!existing.attendingDoctorId && !existing.attendingDoctorName) {
          const ref = IpCare.openReferralFor(pid)
          if (ref) {
            existing.attendingDoctorId = ref.concernDoctorId
            existing.attendingDoctorName = ref.concernDoctorName
            existing.specialty = ref.specialty
            existing.assignedBy = ref.decidedBy
            existing.assignedAt = ref.decidedAt
            existing.reason = existing.reason || ref.reason
            changed = true
          }
        }
        continue
      }
      const ref = IpCare.openReferralFor(pid)
      const admittedAt = bed.admission_date || bed.allocated_at || new Date().toISOString()
      const c: IpCase = {
        id: `${pid}|${bed.admission_id ?? String(admittedAt).slice(0, 10)}`,
        patientId: pid,
        patientName: name,
        admissionId: bed.admission_id,
        bedId: bed.id,
        ward: bed.ward,
        roomNo: bed.room_no,
        bedNo: bed.bed_no,
        bedType: bed.bed_type,
        admittedAt,
        source: ref ? "ER" : /ER|emergency/i.test(bed.admission_notes || "") ? "ER" : "Direct",
        erVisitNo: ref?.visitNo ?? null,
        reason: ref?.reason || bed.admission_notes || null,
        attendingDoctorId: ref?.concernDoctorId || null,
        attendingDoctorName: ref?.concernDoctorName || null,
        specialty: ref?.specialty || null,
        assignedBy: ref?.decidedBy || null,
        assignedAt: ref?.decidedAt || null,
        handovers: [],
        status: "active",
      }
      next.unshift(c)
      raised.push({ c, ref })
      changed = true
    }

    const occupiedIds = new Set(occupied.map((b) => norm(b.patient_id)))
    for (const c of next) {
      if (c.status === "active" && !occupiedIds.has(norm(c.patientId))) {
        c.status = "discharged"
        c.closedAt = new Date().toISOString()
        changed = true
      }
    }

    if (!changed) return
    write(K_CASES, next)

    if (raised.length) {
      // The referral that produced a case is now fulfilled.
      const refs = IpCare.referrals()
      let refChanged = false
      const updated = refs.map((r) => {
        if (r.status === "open" && raised.some((x) => norm(x.c.patientId) === norm(r.patientId))) {
          refChanged = true
          return { ...r, status: "admitted" as const }
        }
        return r
      })
      if (refChanged) write(K_REFERRALS, updated)
    }
    for (const { c } of raised) {
      if (c.attendingDoctorId || c.attendingDoctorName) {
        handOff({
          to: "doctor",
          audience: c.attendingDoctorId || c.attendingDoctorName || undefined,
          from: c.source === "ER" ? "Emergency → Bed Management" : "Bed Management",
          patientName: c.patientName,
          patientId: c.patientId,
          kind: "Admitted under you",
          note: `${c.ward} · Room ${c.roomNo} · Bed ${c.bedNo}${c.reason ? ` · ${c.reason}` : ""}`,
          ref: `${c.id}:admitted`,
          urgent: /icu/i.test(`${c.ward} ${c.bedType || ""}`),
        })
        handOff({
          to: "inpatient",
          from: "Bed Management",
          patientName: c.patientName,
          patientId: c.patientId,
          kind: "New admission — nursing handover",
          note: `${c.ward} · Room ${c.roomNo} · Bed ${c.bedNo} · concern doctor ${c.attendingDoctorName}`,
          ref: `${c.id}:ward`,
        })
      } else {
        handOff({
          to: "inpatient",
          from: "Bed Management",
          patientName: c.patientName,
          patientId: c.patientId,
          kind: "Admitted without a concern doctor — assign one",
          note: `${c.ward} · Room ${c.roomNo} · Bed ${c.bedNo}`,
          ref: `${c.id}:unassigned`,
          urgent: true,
        })
      }
    }
  },

  /** Name (or change) the concern doctor of an admitted patient. */
  assignAttending(caseId: string, doc: Pick<DoctorAccount, "id" | "staffId" | "name" | "specialty">, by: string, reason?: string): IpCase | undefined {
    const all = IpCare.cases()
    const i = all.findIndex((c) => c.id === caseId)
    if (i < 0) return undefined
    const cur = all[i]
    const first = !cur.attendingDoctorId && !cur.attendingDoctorName
    if (!first && isSameDoctor(doc, cur.attendingDoctorId, cur.attendingDoctorName, cur.attendingStaffId)) return cur
    const now = new Date().toISOString()
    const updated: IpCase = {
      ...cur,
      attendingDoctorId: doc.id,
      attendingStaffId: doc.staffId,
      attendingDoctorName: doc.name,
      specialty: doc.specialty || cur.specialty,
      assignedBy: by,
      assignedAt: now,
      handovers: first
        ? cur.handovers
        : [...cur.handovers, { at: now, by, fromDoctorName: cur.attendingDoctorName || "—", toDoctorId: doc.id, toDoctorName: doc.name, reason: reason || "Handed over" }],
    }
    const out = [...all]
    out[i] = updated
    write(K_CASES, out)
    handOff({
      to: "doctor",
      audience: doc.id,
      from: first ? `Bed Management · ${by}` : `${cur.attendingDoctorName || "Previous doctor"} · ${by}`,
      patientName: cur.patientName,
      patientId: cur.patientId,
      kind: first ? "Admitted under you" : "Patient handed over to you",
      note: `${cur.ward} · Room ${cur.roomNo} · Bed ${cur.bedNo}${reason ? ` · ${reason}` : ""}`,
      ref: `${cur.id}:to:${doc.id}:${now.slice(0, 16)}`,
    })
    return updated
  },

  // ── notes ──────────────────────────────────────────────────────────────────
  notes(patientId?: string): IpNote[] {
    const all = read<IpNote>(K_NOTES)
    return (patientId ? all.filter((n) => norm(n.patientId) === norm(patientId)) : all).sort((a, b) => b.at.localeCompare(a.at))
  },
  addNote(n: Omit<IpNote, "id" | "at"> & { at?: string }): IpNote {
    const note: IpNote = { ...n, id: uid("NOTE"), at: n.at || new Date().toISOString() }
    if (!note.text.trim() && !note.vitals) throw new Error("A note needs some text or vitals.")
    write(K_NOTES, [note, ...read<IpNote>(K_NOTES)].slice(0, 5000))
    return note
  },

  // ── orders to the nurses ───────────────────────────────────────────────────
  orders(patientId?: string): IpOrder[] {
    const all = read<IpOrder>(K_ORDERS)
    return (patientId ? all.filter((o) => norm(o.patientId) === norm(patientId)) : all).sort((a, b) => b.at.localeCompare(a.at))
  },
  addOrder(o: Omit<IpOrder, "id" | "at" | "status">): IpOrder {
    if (!o.text.trim()) throw new Error("Write the order first.")
    const order: IpOrder = { ...o, id: uid("ORD"), at: new Date().toISOString(), status: "pending" }
    write(K_ORDERS, [order, ...read<IpOrder>(K_ORDERS)].slice(0, 5000))
    const c = IpCare.cases().find((x) => x.id === o.caseId)
    handOff({
      to: "inpatient",
      from: o.byDoctorName,
      patientName: c?.patientName || o.patientId,
      patientId: o.patientId,
      kind: o.priority === "stat" ? "STAT doctor order" : "Doctor order",
      note: `${c ? `${c.ward} · Bed ${c.bedNo} · ` : ""}${o.text.slice(0, 160)}`,
      ref: `${order.id}:order`,
      urgent: o.priority !== "routine",
    })
    return order
  },
  updateOrder(id: string, status: "acknowledged" | "done", by: string, note?: string): void {
    const now = new Date().toISOString()
    write(
      K_ORDERS,
      read<IpOrder>(K_ORDERS).map((o) =>
        o.id !== id ? o : status === "acknowledged" ? { ...o, status, ackBy: by, ackAt: now } : { ...o, status, doneBy: by, doneAt: now, doneNote: note || undefined, ackBy: o.ackBy || by, ackAt: o.ackAt || now },
      ),
    )
  },
}

/** Every doctor account, for the concern-doctor picker: the doctor master, not a typed name. */
export function listDoctors(): DoctorAccount[] {
  try {
    return getAllDoctorAccounts()
  } catch {
    return []
  }
}

/** Latest-first vitals from the stay's notes (doctor and nurse), for the monitoring chart. */
export function vitalsTimeline(patientId: string): { at: string; by: string; role: string; v: Vitals }[] {
  return IpCare.notes(patientId)
    .filter((n) => n.vitals && Object.values(n.vitals).some((x) => String(x ?? "").trim()))
    .map((n) => ({ at: n.at, by: n.byName, role: n.byRole, v: n.vitals as Vitals }))
}

/** Day of stay (admission day = day 1). */
export function dayOfStay(admittedAt: string, now = Date.now()): number {
  const t = Date.parse(admittedAt)
  if (!Number.isFinite(t)) return 1
  const a = new Date(t)
  const b = new Date(now)
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.max(1, Math.round((db - da) / 86400000) + 1)
}

let actorOverride: { id: string; name: string; role: string } | null = null
/** The app tells this module who is signed in (the staff profile it holds), so notes carry the real author. */
export function setCurrentActor(a: { id: string; name: string; role: string } | null) {
  actorOverride = a
}

/** Who is signed in on this screen (for "recorded by"). */
export function currentActor(): { id: string; name: string; role: string } {
  if (actorOverride && actorOverride.name) return actorOverride
  try {
    const u = JSON.parse(localStorage.getItem("hospai_current_user") || "null")
    return {
      id: String(u?.profile?.staffId || u?.profile?.id || u?.user || ""),
      name: String(u?.name || u?.profile?.name || u?.user || "Staff"),
      role: String(u?.role || u?.profile?.role || ""),
    }
  } catch {
    return { id: "", name: "Staff", role: "" }
  }
}

const HOURS_QUIET = 8

/** What needs a clinician's eye on an admitted patient: a STAT order nobody has picked up, vitals not taken for hours. */
export function attentionFlags(c: IpCase, now = Date.now()): string[] {
  const out: string[] = []
  const pending = IpCare.orders(c.patientId).filter((o) => o.status !== "done")
  if (pending.some((o) => o.priority === "stat" && o.status === "pending")) out.push("STAT order not yet acknowledged")
  const last = vitalsTimeline(c.patientId)[0]
  const since = last ? now - Date.parse(last.at) : now - Date.parse(c.admittedAt)
  if (Number.isFinite(since) && since > HOURS_QUIET * 3600_000) out.push(last ? `No vitals for ${Math.floor(since / 3600_000)} h` : "No vitals recorded yet")
  return out
}
