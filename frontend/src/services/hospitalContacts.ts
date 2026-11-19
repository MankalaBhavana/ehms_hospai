/**
 * Hospital helpline / contact numbers: set by the Administration department only (Administration > Rates &
 * Charges > Helpline numbers), nothing built in. Every place that prints or sends a helpline -- the OP card,
 * journey reports, patient messages, PDFs -- reads it from here, so changing a number once changes it everywhere.
 *
 * Stored under `hospai_hospital_contacts_v1`; the shared-data sync mirrors it to every desk, and the sync
 * server only accepts writes to it from an administrator (server/sync/acl.mjs).
 */

const KEY = "hospai_hospital_contacts_v1"
/** Fired on this window when the numbers change; other tabs get the storage event. */
export const CONTACTS_EVENT = "hospai:contacts-changed"

export interface HelplineEntry {
  id: string
  /** What the number is for: "Helpline", "Emergency", "Ambulance", "Appointments" ... */
  label: string
  number: string
}

interface ContactsState {
  numbers: HelplineEntry[]
  /** Id of the number printed first / used as "the helpline" in messages. Defaults to the first. */
  primaryId?: string
}

const listeners = new Set<() => void>()

function load(): ContactsState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null
    if (raw) {
      const p = JSON.parse(raw) as Partial<ContactsState>
      const numbers = (Array.isArray(p.numbers) ? p.numbers : [])
        .filter((n) => n && typeof n.number === "string" && n.number.trim())
        .map((n) => ({ id: String(n.id || n.number), label: String(n.label || "Helpline"), number: n.number.trim() }))
      return { numbers, primaryId: p.primaryId }
    }
  } catch {
    /* fall through */
  }
  return { numbers: [] }
}

function save(s: ContactsState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    throw new Error("The browser could not store the numbers.")
  }
  listeners.forEach((l) => l())
  try {
    window.dispatchEvent(new Event(CONTACTS_EVENT))
  } catch {
    /* no window (tests) */
  }
}

/** A phone number a person could dial: digits, spaces, + - ( ) and at least 3 digits. */
export function isDialable(value: string): boolean {
  const v = value.trim()
  return /^[+()\-\d\s/]+$/.test(v) && v.replace(/\D/g, "").length >= 3 && v.replace(/\D/g, "").length <= 15
}

export const HospitalContacts = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  /** All numbers, primary first. */
  list(): HelplineEntry[] {
    const s = load()
    const primary = s.numbers.find((n) => n.id === s.primaryId) ?? s.numbers[0]
    return primary ? [primary, ...s.numbers.filter((n) => n.id !== primary.id)] : []
  },

  primary(): HelplineEntry | null {
    return HospitalContacts.list()[0] ?? null
  },

  add(label: string, number: string): HelplineEntry[] {
    const num = number.trim()
    if (!isDialable(num)) throw new Error("Enter a valid phone number (digits, +, -, spaces; 3 to 15 digits).")
    const s = load()
    if (s.numbers.some((n) => n.number.replace(/\D/g, "") === num.replace(/\D/g, "") && n.label.toLowerCase() === (label.trim() || "Helpline").toLowerCase()))
      throw new Error("That number is already listed under the same name.")
    const entry: HelplineEntry = { id: `HL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: label.trim() || "Helpline", number: num }
    save({ ...s, numbers: [...s.numbers, entry] })
    return HospitalContacts.list()
  },

  update(id: string, patch: Partial<Pick<HelplineEntry, "label" | "number">>): HelplineEntry[] {
    const s = load()
    if (patch.number !== undefined && !isDialable(patch.number)) throw new Error("Enter a valid phone number (digits, +, -, spaces; 3 to 15 digits).")
    save({ ...s, numbers: s.numbers.map((n) => (n.id === id ? { ...n, ...(patch.label !== undefined ? { label: patch.label.trim() || "Helpline" } : {}), ...(patch.number !== undefined ? { number: patch.number.trim() } : {}) } : n)) })
    return HospitalContacts.list()
  },

  remove(id: string): HelplineEntry[] {
    const s = load()
    save({ numbers: s.numbers.filter((n) => n.id !== id), primaryId: s.primaryId === id ? undefined : s.primaryId })
    return HospitalContacts.list()
  },

  setPrimary(id: string): HelplineEntry[] {
    const s = load()
    if (!s.numbers.some((n) => n.id === id)) return HospitalContacts.list()
    save({ ...s, primaryId: id })
    return HospitalContacts.list()
  },
}

/** "Helpline 0891-… · Emergency 108": the numbers as one printable line (at most `max`). */
export function helplineLine(entries: HelplineEntry[], max = 3): string {
  return entries
    .slice(0, max)
    .map((n) => (entries.length > 1 ? `${n.label} ${n.number}` : n.number))
    .join(" · ")
}

/** The helpline numbers as one line for a printed header ("" when Administration has set none). */
export function helplineText(max = 3): string {
  return helplineLine(HospitalContacts.list(), max)
}

/** The numbers printed on an OP card: at most three, primary first; none when Administration has set none. */
export function cardHelplines(b: { helplines?: { label: string; number: string }[]; helpline?: string }): { label: string; number: string }[] {
  const list = b.helplines && b.helplines.length ? b.helplines : b.helpline ? [{ label: "Helpline", number: b.helpline }] : []
  return list.slice(0, 3)
}
