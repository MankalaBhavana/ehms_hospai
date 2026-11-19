// Shared key/value store behind the browser's localStorage so every user,
// browser and network sees the same hospital data, instantly.
//
//   GET  /sync-api/changes?since=N   -> { ver, events:[{key,ver,v|null}] }
//   POST /sync-api/push              -> { ver, applied:[{key,ver,v|null,merged}] }
//   GET  /sync-api/stream            -> text/event-stream of the same events
//
// Requests need a signed-in session (validated against the auth service and
// cached briefly) unless SYNC_REQUIRE_AUTH=false.
import fs from "node:fs"
import path from "node:path"
import { mergeValues } from "./merge.mjs"
import { canRead, canWrite } from "./acl.mjs"

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "hospai_session"
const authUrl = () => process.env.SYNC_AUTH_URL || "http://127.0.0.1:8010/api/auth/session"
const REQUIRE_AUTH = process.env.SYNC_REQUIRE_AUTH !== "false"

export function createKvSync({ file }) {
  /** key -> { v: string|null, ver: number } (v === null is a tombstone) */
  const state = new Map()
  let ver = 0
  // Identifies this data set. A new (wiped) store gets a new epoch, so browsers still
  // holding the previous data discard it instead of re-uploading it.
  let epoch = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const streams = new Set()
  const waiters = new Set()

  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"))
    ver = saved.ver || 0
    if (saved.epoch) epoch = saved.epoch
    for (const [k, e] of Object.entries(saved.items || {})) state.set(k, e)
  } catch {
    /* first run */
  }

  let saveTimer = null
  const save = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = file + ".tmp"
        fs.writeFileSync(tmp, JSON.stringify({ ver, epoch, items: Object.fromEntries(state) }))
        fs.renameSync(tmp, file)
      } catch (err) {
        console.error("[sync] save failed", err.message)
      }
    }, 400)
  }

  const authCache = new Map()
  // The signed-in user's profile (type, permissions) from the auth service, cached for a minute; null = not signed in.
  async function sessionProfile(req) {
    if (!REQUIRE_AUTH) return { user_type: "admin" }
    const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
    if (!m) return null
    const token = m[1]
    const hit = authCache.get(token)
    if (hit && Date.now() - hit.at < 60000) return hit.profile
    let profile = null
    try {
      const r = await fetch(authUrl(), { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
      const j = await r.json().catch(() => ({}))
      profile = j && j.user ? j.user : null
    } catch {
      profile = null
    }
    authCache.set(token, { profile, at: Date.now() })
    return profile
  }

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on("data", (c) => {
        size += c.length
        if (size > 60e6) {
          reject(new Error("too large"))
          req.destroy()
        } else chunks.push(c)
      })
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"))
        } catch (e) {
          reject(e)
        }
      })
      req.on("error", reject)
    })

  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(body))
  }

  function broadcast(ev, origin) {
    for (const w of [...waiters]) if (ev.ver > w.since) w.flush()
    const frame = `id: ${ev.ver}\ndata: ${JSON.stringify({ ...ev, origin })}\n\n`
    for (const res of streams) {
      if (!canRead(res.__profile, ev.key)) continue
      try {
        res.write(frame)
      } catch {
        streams.delete(res)
      }
    }
  }

  return async function handler(req, res, next) {
    const url = req.url || ""
    if (!url.startsWith("/sync-api/")) return next()
    const u = new URL(url, "http://x")
    const profile = await sessionProfile(req)
    if (!profile) return send(res, 401, { error: "Authentication required" })

    if (req.method === "GET" && u.pathname === "/sync-api/changes") {
      const since = Number(u.searchParams.get("since") || 0)
      const wait = Math.min(Number(u.searchParams.get("wait") || 0), 30)
      const collect = () => {
        const events = []
        for (const [key, e] of state) if (e.ver > since && canRead(profile, key)) events.push({ key, ver: e.ver, v: e.v })
        events.sort((a, b) => a.ver - b.ver)
        return events
      }
      const now = collect()
      // Long-poll: hold the request open until something changes (or `wait` seconds pass).
      // Plain request/response, so it is instant AND survives proxies/tunnels that buffer
      // event streams.
      if (now.length || !wait) return send(res, 200, { ver, epoch, events: now })
      const waiter = {
        since,
        res,
        timer: setTimeout(() => {
          waiters.delete(waiter)
          send(res, 200, { ver, epoch, events: [] })
        }, wait * 1000),
        flush: () => {
          clearTimeout(waiter.timer)
          waiters.delete(waiter)
          send(res, 200, { ver, epoch, events: collect() })
        },
      }
      waiters.add(waiter)
      req.on("close", () => {
        clearTimeout(waiter.timer)
        waiters.delete(waiter)
      })
      return
    }

    if (req.method === "GET" && u.pathname === "/sync-api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      })
      const since = Number(req.headers["last-event-id"] || u.searchParams.get("since") || 0)
      res.write("retry: 1000\n\n")
      const missed = []
      for (const [key, e] of state) if (e.ver > since && canRead(profile, key)) missed.push({ key, ver: e.ver, v: e.v })
      missed.sort((a, b) => a.ver - b.ver)
      for (const ev of missed) res.write(`id: ${ev.ver}\ndata: ${JSON.stringify(ev)}\n\n`)
      res.__profile = profile
      streams.add(res)
      const beat = setInterval(() => {
        try {
          res.write(": hb\n\n")
        } catch {
          /* closed */
        }
      }, 15000)
      req.on("close", () => {
        clearInterval(beat)
        streams.delete(res)
      })
      return
    }

    if (req.method === "POST" && u.pathname === "/sync-api/push") {
      let body
      try {
        body = await readBody(req)
      } catch {
        return send(res, 400, { error: "bad body" })
      }
      const origin = String(body.clientId || "")
      const applied = []
      const denied = []
      for (const c of Array.isArray(body.changes) ? body.changes : []) {
        if (!c || typeof c.key !== "string") continue
        if (!canWrite(profile, c.key)) {
          denied.push(c.key)
          continue
        }
        const cur = state.get(c.key)
        let next
        let merged = false
        if (c.value === null || c.value === undefined) {
          next = null
        } else if (!cur || cur.v === null || cur.ver === c.base) {
          next = String(c.value)
        } else {
          next = mergeValues(cur.v, String(c.value), c.baseInfo || null)
          merged = next !== String(c.value)
        }
        if (cur && cur.v === next) {
          applied.push({ key: c.key, ver: cur.ver, v: next, merged: false, same: true })
          continue
        }
        ver += 1
        state.set(c.key, { v: next, ver })
        const ev = { key: c.key, ver, v: next }
        broadcast(ev, origin)
        applied.push({ ...ev, merged })
      }
      save()
      return send(res, 200, { ver, applied, denied })
    }

    return send(res, 404, { error: "not found" })
  }
}
