/**
 * Server-backed replication for the app's browser stores.
 *
 * Every module here (OP queue, doctor portal, lab, radiology, pharmacy, ER, beds,
 * billing ...) keeps its records in localStorage, so each browser used to hold a
 * private copy of the hospital: a patient finished on one screen stayed "waiting"
 * on every other one, and lab/radiology data never reached other users.
 *
 * This layer mirrors every shared key to the server (`/sync-api`, see
 * server/sync/kvSync.mjs) and streams other users' changes back in, then wakes
 * the stores through the same signals they already listen to (storage event,
 * BroadcastChannels, custom events). No module code has to change.
 *
 *  - writes:  localStorage.setItem/removeItem are intercepted and pushed (~80 ms)
 *  - reads:   a long-poll request stays open and returns the moment anything changes
 *             (works through proxies and tunnels that buffer event streams)
 *  - clashes: two people saving the same list merge by record id on the server
 *             (see server/sync/merge.mjs); deletions are honoured
 */
// @ts-expect-error - plain JS module shared with the server
import { describeBase, mergeValues } from "../../server/sync/merge.mjs"

const ALLOW = /^(hospai_|hosp_|hrms_|hms_|icu\.)/

// Per-device / per-user state that must NOT be shared between people.
const DENY = new RegExp(
  [
    "^hospai_(current_user|last_user|login_|saved_credentials|dashboard_notifs_read|active_radiology_study_id)",
    "^hospai_(pending_patient_page|target_bed_id|pending_bed_allocation|billing_preselected_claim)",
    "^hospai_(rad_clear_global_search|rad_new_template|pharmacy_toast|token_|ocr_|audit_logs|sync_)",
    "^hospai_(rbac_users|surgery_cases_cache|pharm_read_notifs|pharm_dismissed_notifs|notif)",
    "^hospai_.*purged",
    "^hms_(username|nursing_active_user)$",
    "^hosp_billing_active_user",
  ].join("|"),
)

export function isSyncedKey(key: string | null | undefined): key is string {
  return !!key && ALLOW.test(key) && !DENY.test(key)
}

const CHANNELS = [
  "hospai_db_v1",
  "hospai_lab_orders",
  "hospai_rad_channel",
  "hospai_universal_radiology_channel",
  "hospai_departments_channel",
  "hospai_diagnostic_tariffs",
  "hospai_doctor_master_channel",
  "hospai_surgery_updates",
  "hospai_insurance_engine_sync",
  "hospai_doctor_portal",
  "hospai_lab_inventory_channel",
  "hospai_rad_template_channel",
]

interface SyncEvent {
  key: string
  ver: number
  v: string | null
  origin?: string
}

const PUSH_DELAY_MS = 80

export function startServerSync(): void {
  if (typeof window === "undefined" || (window as any).__hospaiSync) return
  let ls: Storage
  try {
    ls = window.localStorage
    void ls.length
  } catch {
    return
  }

  const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const origSet = Storage.prototype.setItem
  const origRemove = Storage.prototype.removeItem
  const origGet = Storage.prototype.getItem

  const synced = new Map<string, { ver: number; raw: string | null }>()
  const dirty = new Set<string>()
  const pendingNotify = new Set<string>()
  let lastVer = 0
  let applying = false
  let pushTimer: number | null = null
  let pushing = false
  let ready = false
  const status = { online: false, lastError: "", pushed: 0, received: 0 }
  ;(window as any).__hospaiSync = { status, dirty, synced }

  const readLocal = (key: string): string | null => {
    try {
      return origGet.call(ls, key)
    } catch {
      return null
    }
  }
  const writeLocal = (key: string, value: string | null) => {
    applying = true
    try {
      if (value === null) origRemove.call(ls, key)
      else origSet.call(ls, key, value)
    } catch (err) {
      console.warn("[sync] could not store", key, err)
    } finally {
      applying = false
    }
  }

  // ── tell the stores something changed ──────────────────────────────────────
  let notifyTimer: number | null = null
  const channels = new Map<string, BroadcastChannel>()
  const flushNotify = () => {
    notifyTimer = null
    const keys = [...pendingNotify]
    pendingNotify.clear()
    if (!keys.length) return
    for (const key of keys) {
      try {
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: readLocal(key), storageArea: ls }),
        )
      } catch {
        /* StorageEvent constructor unsupported */
      }
    }
    for (const name of CHANNELS) {
      try {
        let ch = channels.get(name)
        if (!ch) channels.set(name, (ch = new BroadcastChannel(name)))
        ch.postMessage("changed")
      } catch {
        /* no BroadcastChannel */
      }
    }
    const has = (re: RegExp) => keys.some((k) => re.test(k))
    const fire = (name: string) => window.dispatchEvent(new CustomEvent(name))
    if (has(/lab_orders|lis_|lab_inventory/)) fire("hospai_lab_orders_updated"), fire("hospai_lis_updated")
    if (has(/pharm/)) fire("hospai_pharmacy_updated")
    if (has(/rad_|radiology/)) fire("hospai_rad_workflow_updated")
    if (has(/bed|inpatient|discharged/)) fire("hospai_beds_updated")
    if (has(/er_bed|bed_request|er_/)) fire("hospai_bed_request_updated")
    if (has(/hospai_db_encounters/)) fire("hospai_encounter_updated")
  }
  const notify = (key: string) => {
    pendingNotify.add(key)
    if (notifyTimer === null) notifyTimer = window.setTimeout(flushNotify, 30)
  }

  // ── remote -> local ────────────────────────────────────────────────────────
  const applyRemote = (ev: SyncEvent) => {
    if (!isSyncedKey(ev.key)) return
    status.received++
    if (ev.ver > lastVer) lastVer = ev.ver
    const prev = synced.get(ev.key)
    if (prev && prev.ver >= ev.ver) return
    if (dirty.has(ev.key) && ev.v !== null) {
      // I have an unsent change to this key: fold the remote one in rather than lose either.
      const mine = readLocal(ev.key)
      const merged = mine === null ? ev.v : mergeValues(ev.v, mine, describeBase(prev?.raw ?? null))
      synced.set(ev.key, { ver: ev.ver, raw: ev.v })
      if (merged !== mine) {
        writeLocal(ev.key, merged)
        notify(ev.key)
      }
      schedulePush()
      return
    }
    dirty.delete(ev.key)
    synced.set(ev.key, { ver: ev.ver, raw: ev.v })
    if (readLocal(ev.key) !== ev.v) {
      writeLocal(ev.key, ev.v)
      notify(ev.key)
    }
  }

  // ── local -> remote ────────────────────────────────────────────────────────
  const schedulePush = (delay = PUSH_DELAY_MS) => {
    if (!ready || pushTimer !== null) return
    pushTimer = window.setTimeout(() => {
      pushTimer = null
      void push()
    }, delay)
  }

  async function push() {
    if (pushing || !dirty.size) return
    pushing = true
    const keys = [...dirty]
    const sent = new Map<string, string | null>()
    const changes = keys.map((key) => {
      const value = readLocal(key)
      sent.set(key, value)
      const base = synced.get(key)
      return { key, value, base: base?.ver ?? 0, baseInfo: describeBase(base?.raw ?? null) }
    })
    try {
      const res = await fetch("/sync-api/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, changes }),
      })
      if (!res.ok) throw new Error(`push ${res.status}`)
      const body = (await res.json()) as { ver: number; applied: (SyncEvent & { merged?: boolean })[]; denied?: string[] }
      status.online = true
      // The server refused these keys for this account (not permitted): stop retrying and put the server's copy back.
      for (const key of body.denied ?? []) {
        dirty.delete(key)
        const known = synced.get(key)
        writeLocal(key, known ? known.raw : null)
        notify(key)
      }
      status.pushed += body.applied.length
      for (const a of body.applied) {
        if (a.ver > lastVer) lastVer = a.ver
        synced.set(a.key, { ver: a.ver, raw: a.v })
        const now = readLocal(a.key)
        if (now === sent.get(a.key)) {
          dirty.delete(a.key)
          if (a.merged && a.v !== now) {
            writeLocal(a.key, a.v)
            notify(a.key)
          }
        } // else it changed again while in flight: stays dirty, next push uses the new base
      }
    } catch (err: any) {
      status.online = false
      status.lastError = String(err?.message || err)
      schedulePush(2000)
    } finally {
      pushing = false
      if (dirty.size && pushTimer === null && ready) schedulePush(PUSH_DELAY_MS)
    }
  }

  // ── intercept writes ───────────────────────────────────────────────────────
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    origSet.call(this, key, value)
    if (this === ls && !applying && isSyncedKey(key)) {
      const s = String(value)
      if (synced.get(key)?.raw === s) dirty.delete(key)
      else {
        dirty.add(key)
        schedulePush()
      }
    }
  }
  Storage.prototype.removeItem = function (this: Storage, key: string) {
    origRemove.call(this, key)
    if (this === ls && !applying && isSyncedKey(key)) {
      const had = synced.get(key)
      if (had && had.raw !== null) {
        dirty.add(key)
        schedulePush()
      } else dirty.delete(key)
    }
  }

  // ── catch-up + live stream ─────────────────────────────────────────────────
  async function catchUp(initial = false) {
    try {
      const res = await fetch(`/sync-api/changes?since=${lastVer}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
      if (res.status === 401) {
        status.online = false
        status.lastError = "not signed in"
        return false
      }
      if (!res.ok) throw new Error(`changes ${res.status}`)
      const body = (await res.json()) as { ver: number; epoch?: string; events: SyncEvent[] }
      status.online = true
      if (initial) {
        // The server's data set was reset: drop this browser's copy of the old one
        // (otherwise it would be uploaded back as if it were new).
        let known: string | null = null
        try { known = origGet.call(ls, "hospai_sync_epoch") } catch { /* ignore */ }
        if (body.epoch && known !== body.epoch) {
          const stale: string[] = []
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i)
            if (isSyncedKey(k)) stale.push(k)
          }
          for (const k of stale) {
            writeLocal(k, null)
            // Tell the stores their data changed instead of reloading the page: a reload
            // right after signing in made the app flash and restart.
            notify(k)
          }
          try { origSet.call(ls, "hospai_sync_epoch", body.epoch) } catch { /* ignore */ }
          dirty.clear()
        }
        // First contact: the shared server copy wins; keys only this browser has are seeded up.
        const onServer = new Set<string>()
        for (const ev of body.events) {
          onServer.add(ev.key)
          if (!isSyncedKey(ev.key)) continue
          dirty.delete(ev.key)
          synced.set(ev.key, { ver: ev.ver, raw: ev.v })
          if (ev.ver > lastVer) lastVer = ev.ver
          if (readLocal(ev.key) !== ev.v) {
            writeLocal(ev.key, ev.v)
            notify(ev.key)
          }
        }
        if (body.ver > lastVer) lastVer = body.ver
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (isSyncedKey(k) && !onServer.has(k)) dirty.add(k)
        }
      } else {
        for (const ev of body.events) applyRemote(ev)
        if (body.ver > lastVer) lastVer = body.ver
      }
      return true
    } catch (err: any) {
      status.online = false
      status.lastError = String(err?.message || err)
      return false
    }
  }

  // Long-poll loop: the request stays open until the server has something new, so a
  // change made by another user arrives immediately, through any proxy or tunnel.
  let polling = false
  async function longPoll() {
    if (polling) return
    polling = true
    while (true) {
      try {
        const ctl = new AbortController()
        const t = window.setTimeout(() => ctl.abort(), 40000)
        const res = await fetch(`/sync-api/changes?since=${lastVer}&wait=25`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: ctl.signal,
        })
        window.clearTimeout(t)
        if (res.status === 401) {
          status.online = false
          status.lastError = "not signed in"
          polling = false
          window.setTimeout(boot, 4000)
          return
        }
        if (!res.ok) throw new Error(`poll ${res.status}`)
        const body = (await res.json()) as { ver: number; events: SyncEvent[] }
        status.online = true
        for (const ev of body.events) {
          if (ev.ver > lastVer) lastVer = ev.ver
          const mine = synced.get(ev.key)
          if (mine && mine.ver >= ev.ver) continue // my own write echoing back
          applyRemote(ev)
        }
        if (body.ver > lastVer) lastVer = body.ver
      } catch (err: any) {
        status.online = false
        status.lastError = String(err?.message || err)
        await new Promise((r) => window.setTimeout(r, 2000))
      }
    }
  }

  async function boot() {
    const ok = await catchUp(!ready)
    if (!ok) {
      window.setTimeout(boot, 4000)
      return
    }
    if (!ready) {
      ready = true
      if (dirty.size) schedulePush(0)
    }
    void longPoll()
  }

  window.addEventListener("online", () => {
    if (ready) {
      void catchUp(false)
      schedulePush(0)
    }
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ready) void catchUp(false)
  })

  void boot()
}
