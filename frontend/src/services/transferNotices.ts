/**
 * Transfer notices: when a patient is moved to another department, that department is told on its own
 * screen (bell + panel) with a link to open the patient. Notices live on the server, so the receiving
 * desk -- a different computer -- sees them. Failures to deliver are never silent: a notice that could
 * not be sent is kept and retried on the next poll.
 */
// The API client is loaded on first use, not statically: this module is imported by the billing, laboratory and bed
// services, and a static import would pull the whole API layer (and its import cycles) in with them.
const apiFetch: typeof import("../lib/api").apiFetch = (async (...args: Parameters<typeof import("../lib/api").apiFetch>) => {
  const m = await import("../lib/api")
  return m.apiFetch(...args)
}) as typeof import("../lib/api").apiFetch

export interface TransferNotice {
  id: number | string
  kind: string
  patientId?: string | null
  patientName: string
  from?: string | null
  to: string
  /** The screen the receiving department opens to see the patient. */
  toModule: string
  note?: string | null
  by?: string | null
  at: string | null
  seen: boolean
  /** Urgent notices (STAT orders, emergencies) are shown first and flagged. */
  priority?: "Normal" | "Urgent"
  /** The piece of work this announces (lab order, prescription, encounter ...): the same one is never announced twice. */
  ref?: string | null
  /** Set when the notice is for one person (a doctor's id / staff id / name), not the whole department. */
  audience?: string | null
  /** The receiving department has processed the patient and cleared the notice, for everyone. */
  handled?: boolean
  handledBy?: string | null
  handledAt?: string | null
}

type NewNotice = Omit<TransferNotice, "id" | "at" | "seen" | "by" | "handled" | "handledBy" | "handledAt">

const OUTBOX_KEY = "hospai_transfer_notice_outbox_v1"
let cache: TransferNotice[] = []

/** Who is signed in on this screen: a notice with an audience shows only to that person (and to administrators). */
let viewer: { ids: string[]; admin: boolean } = { ids: [], admin: true }
const forMe = (n: TransferNotice) => {
  if (!n.audience || viewer.admin) return true
  const a = String(n.audience).trim().toLowerCase()
  return viewer.ids.some((id) => id && id.trim().toLowerCase() === a)
}
let loadedOnce = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const readOutbox = (): NewNotice[] => {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]")
  } catch {
    return []
  }
}
const writeOutbox = (v: NewNotice[]) => {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(v))
  } catch {
    /* quota: keep working */
  }
}

async function deliver(n: NewNotice): Promise<boolean> {
  try {
    await apiFetch("/api/notices/transfers", { method: "POST", body: JSON.stringify(n) })
    return true
  } catch {
    return false
  }
}

export const TransferNotices = {
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  /** Tell the store who is signed in (their doctor id, staff id, name ...), so personal notices reach only them. */
  setViewer(ids: (string | null | undefined)[], admin: boolean) {
    viewer = { ids: ids.filter(Boolean) as string[], admin }
    emit()
  },

  /** Tell the receiving department. Safe to call from any transfer action; never throws. */
  async add(n: NewNotice): Promise<void> {
    if (!n.patientName || !n.to || !n.toModule) return
    if (!(await deliver(n))) writeOutbox([...readOutbox(), n]) // retried on the next refresh
    void TransferNotices.refresh()
  },

  async refresh(): Promise<void> {
    // Send anything that could not be delivered earlier.
    const pending = readOutbox()
    if (pending.length) {
      const still: NewNotice[] = []
      for (const n of pending) if (!(await deliver(n))) still.push(n)
      writeOutbox(still)
    }
    try {
      const res = await apiFetch<{ notices: TransferNotice[] }>("/api/notices/transfers")
      cache = Array.isArray(res?.notices) ? res.notices : []
      loadedOnce = true
      emit()
    } catch {
      /* offline: keep what we have */
    }
  },

  /** True once the server's list has been fetched at least once. */
  loaded(): boolean {
    return loadedOnce
  },

  /** Notices this user has not opened yet, for departments they can open. */
  unseen(canOpen: (module: string) => boolean): TransferNotice[] {
    return cache.filter((n) => !n.seen && !n.handled && forMe(n) && canOpen(n.toModule))
  },

  /** Patients still waiting to be processed by a department this user can open: urgent first, then oldest first. */
  pending(canOpen: (module: string) => boolean): TransferNotice[] {
    return cache
      .filter((n) => !n.handled && forMe(n) && canOpen(n.toModule))
      .sort((a, b) => (a.priority === "Urgent" ? 0 : 1) - (b.priority === "Urgent" ? 0 : 1) || String(a.at || "").localeCompare(String(b.at || "")))
  },

  /** The last few cleared notices (who processed them, when), for the department's "done" list. */
  recentlyHandled(canOpen: (module: string) => boolean, limit = 8): TransferNotice[] {
    return cache
      .filter((n) => n.handled && forMe(n) && canOpen(n.toModule))
      .sort((a, b) => String(b.handledAt || "").localeCompare(String(a.handledAt || "")))
      .slice(0, limit)
  },

  /** The patient has been processed: clear the notice for the whole department. */
  async markHandled(id: number | string): Promise<void> {
    cache = cache.map((n) => (String(n.id) === String(id) ? { ...n, handled: true, seen: true, handledAt: new Date().toISOString() } : n))
    emit()
    try {
      await apiFetch(`/api/notices/transfers/${id}/handled`, { method: "POST" })
    } catch {
      /* it reappears on the next refresh if the server missed it */
    }
  },

  async markSeen(id: number | string): Promise<void> {
    cache = cache.map((n) => (String(n.id) === String(id) ? { ...n, seen: true } : n))
    emit()
    try {
      await apiFetch(`/api/notices/transfers/${id}/seen`, { method: "POST" })
    } catch {
      /* it reappears on the next refresh if the server missed it */
    }
  },
}
