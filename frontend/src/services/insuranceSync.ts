/**
 * Keeps the insurance module's records in PostgreSQL (via /api/insurance/*) instead of
 * only in this browser. localStorage stays as a fast local cache; the server is the source
 * of truth, so every desk sees the same claims and nothing is lost when a browser is cleared.
 *
 * - push:  every local save is diffed against what the server last returned and only changed
 *          records are PUT (with the version they were based on -> 409 if someone else saved first).
 * - pull:  records are fetched per collection and replace the local copy.
 * - first run: if the server has nothing but this browser has records, they are uploaded once.
 */
import { apiFetch } from "../lib/api"

/** localStorage key -> server collection. */
export const INSURANCE_COLLECTION_OF_KEY: Record<string, string> = {
  hospai_insurance_cases_v2: "cases",
  hospai_insurance_companies_v1: "insurers",
  hospai_insurance_tpas_v1: "tpas",
  hospai_insurance_packages_v1: "packages",
  hospai_insurance_document_rules_v1: "document_rules",
  hospai_insurance_pricing_rules_v1: "pricing_rules",
  hospai_patient_policies_v1: "patient_policies",
  hospai_insurance_fixed_package_bills_v1: "fixed_package_bills",
}

type Doc = Record<string, any> & { id?: string; _version?: number }

const lastServer = new Map<string, Map<string, string>>() // collection -> id -> JSON snapshot
let lastEtag: string | null = null
const queue = new Map<string, Doc[]>() // key -> latest array waiting to be pushed
let timer: ReturnType<typeof setTimeout> | null = null
let pushing = false
let applyingRemote = false
let state: { status: "idle" | "live" | "offline" | "conflict"; lastError: string | null; lastSyncedAt: number | null } = {
  status: "idle",
  lastError: null,
  lastSyncedAt: null,
}
const stateListeners = new Set<() => void>()
const emitState = () => stateListeners.forEach((l) => l())

export const InsuranceSync = {
  isApplyingRemote: () => applyingRemote,
  getState: () => state,
  subscribe(cb: () => void) {
    stateListeners.add(cb)
    return () => stateListeners.delete(cb)
  },

  /** Called by the engine after each local save of a synced collection. */
  push(key: string, items: Doc[]) {
    if (applyingRemote || !INSURANCE_COLLECTION_OF_KEY[key]) return
    queue.set(key, items)
    lastEtag = null // a local save changes what the server will hold
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), 400)
  },

  /**
   * Load the server's records into localStorage. `apply` writes a collection locally and
   * notifies the UI. Resolves true when anything changed.
   */
  async pull(readLocal: (key: string) => Doc[], apply: (key: string, items: Doc[]) => void): Promise<boolean> {
    let changed = false
    try {
      // One request for every collection; when nothing changed on the server the reply is a few bytes.
      const snap = await apiFetch<{ unchanged: boolean; etag: string; collections?: Record<string, Doc[]> }>(
        `/api/insurance/snapshot${lastEtag ? `?etag=${encodeURIComponent(lastEtag)}` : ""}`,
      )
      if (snap.unchanged) {
        state = { status: "live", lastError: null, lastSyncedAt: Date.now() }
        emitState()
        if (queue.size) void flush()
        return false
      }
      for (const [key, collection] of Object.entries(INSURANCE_COLLECTION_OF_KEY)) {
        const remote = Array.isArray(snap.collections?.[collection]) ? snap.collections![collection] : []
        const local = readLocal(key)
        const known = new Map<string, string>()
        remote.forEach((r) => r.id && known.set(String(r.id), JSON.stringify(stripVersion(r))))
        lastServer.set(collection, known)

        if (remote.length === 0 && local.length > 0) {
          // First run against an empty server: migrate what this browser already holds.
          queue.set(key, local)
          continue
        }
        // Keep local records the server has not seen yet (saved while offline), server wins otherwise.
        const remoteIds = new Set(remote.map((r) => String(r.id)))
        const unsent = local.filter((l) => l.id && !remoteIds.has(String(l.id)) && !l._version)
        const merged = [...unsent, ...remote]
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          applyingRemote = true
          try {
            apply(key, merged)
          } finally {
            applyingRemote = false
          }
          changed = true
        }
        if (unsent.length) queue.set(key, merged)
      }
      // Remember the etag only once nothing is waiting to upload (an upload changes the server state).
      lastEtag = queue.size ? null : snap.etag
      state = { status: "live", lastError: null, lastSyncedAt: Date.now() }
      emitState()
      if (queue.size) void flush()
    } catch (e) {
      state = { ...state, status: "offline", lastError: e instanceof Error ? e.message : "server unreachable" }
      emitState()
    }
    return changed
  },
}

function stripVersion(d: Doc): Doc {
  const { _version, ...rest } = d
  return rest
}

async function flush() {
  if (pushing) {
    timer = setTimeout(() => void flush(), 400)
    return
  }
  pushing = true
  try {
    for (const [key, items] of Array.from(queue.entries())) {
      const collection = INSURANCE_COLLECTION_OF_KEY[key]
      const snap = lastServer.get(collection) ?? new Map<string, string>()
      const ids = new Set<string>()
      for (const doc of items) {
        if (!doc?.id) continue
        const id = String(doc.id)
        ids.add(id)
        if (snap.get(id) === JSON.stringify(stripVersion(doc))) continue // unchanged
        try {
          const saved = await apiFetch<Doc>(`/api/insurance/${collection}/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(doc),
          })
          snap.set(id, JSON.stringify(stripVersion(saved)))
          doc._version = saved._version
        } catch (e: any) {
          if (e?.status === 409) {
            // Someone else saved this record first. Their copy is authoritative; the next pull applies it.
            state = { status: "conflict", lastError: `${collection}/${id} was changed by someone else; reloading`, lastSyncedAt: state.lastSyncedAt }
            emitState()
          } else {
            state = { ...state, status: "offline", lastError: e?.message || "save failed" }
            emitState()
            return // keep the queue; retry on the next change or pull
          }
        }
      }
      // Master data deleted locally is removed on the server (cases are never deleted).
      if (collection !== "cases") {
        for (const id of Array.from(snap.keys())) {
          if (!ids.has(id)) {
            try {
              await apiFetch(`/api/insurance/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" })
              snap.delete(id)
            } catch {
              /* retried on the next save */
            }
          }
        }
      }
      lastServer.set(collection, snap)
      queue.delete(key)
    }
    if (state.status !== "conflict") state = { status: "live", lastError: null, lastSyncedAt: Date.now() }
    emitState()
  } finally {
    pushing = false
  }
}
