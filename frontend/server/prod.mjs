// Production web server for the hospital app.
//
//   node server/prod.mjs        (after `npm run build`)
//
// One process, one port. It serves:
//   /                 the built single-page app (dist/), with correct cache headers
//   /hms-api/*        reverse proxy to the Flask backend (BACKEND_URL), same-origin, so the
//                     session cookie and CSRF work from any host / tunnel / domain
//   /sync-api/*       the shared live-data store (see server/sync/kvSync.mjs)
//   /app-config.json  the public URL used for patient-card QR codes
//   /keppler-ocr/*    the built OCR screens, if ocr-frontend/dist exists
//   /healthz          liveness probe
//
// Configuration (environment):
//   PORT                 listen port                         (default 8443)
//   BACKEND_URL          Flask backend                       (default http://127.0.0.1:8010)
//   PUBLIC_APP_URL       public https URL of this site       (default: none)
//   DATA_DIR             where shared data is persisted      (default ./server/data)
//   SYNC_AUTH_URL        session check used by /sync-api     (default BACKEND_URL/api/auth/session)
//   TRUST_PROXY          "true" when behind a reverse proxy / tunnel (reads X-Forwarded-*)
//   VLLM_URL             the vLLM model server, e.g. http://gpu-host:8700 (optional; /vllm-api answers 503 without it)
//   VLLM_API_KEY         bearer key for that server, if it has one
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { createKvSync } from "./sync/kvSync.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const PORT = Number(process.env.PORT || 8443)
const BACKEND = new URL(process.env.BACKEND_URL || "http://127.0.0.1:8010")
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, "data"))
const DIST = path.join(root, "dist")
const OCR_DIST = path.resolve(root, "..", "ocr-frontend", "dist")

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`[web] ${DIST} is missing. Run "npm run build" first.`)
  process.exit(1)
}
if (!process.env.SYNC_AUTH_URL) process.env.SYNC_AUTH_URL = new URL("/api/auth/session", BACKEND).href

const app = express()
app.disable("x-powered-by")
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", true)

// ── security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "SAMEORIGIN")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  }
  next()
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

// ── public URL for QR codes ──────────────────────────────────────────────────
app.get("/app-config.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store")
  res.json({ publicUrl: (process.env.PUBLIC_APP_URL || "").trim() })
})

// ── shared live data ─────────────────────────────────────────────────────────
const sync = createKvSync({ file: path.join(DATA_DIR, "sync-kv.json") })
app.use((req, res, next) => (req.url.startsWith("/sync-api/") ? sync(req, res, next) : next()))

// ── API reverse proxy ────────────────────────────────────────────────────────
app.use("/hms-api", (req, res) => {
  const headers = { ...req.headers, host: BACKEND.host }
  const ip = req.socket.remoteAddress || ""
  headers["x-real-ip"] = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || ip
  headers["x-forwarded-for"] = [req.headers["x-forwarded-for"], ip].filter(Boolean).join(", ")
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")
  const upstream = http.request(
    { hostname: BACKEND.hostname, port: BACKEND.port || 80, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.setTimeout(300000, () => upstream.destroy(new Error("upstream timeout")))
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).json({ error: "The hospital backend is not reachable." })
    else res.end()
  })
  req.pipe(upstream)
})

// ── AI model server (vLLM) ───────────────────────────────────────────────────
// A few screens call the language / vision model straight from the browser (ER triage assist, discharge-summary
// assist, pharmacy invoice OCR) through /vllm-api. The dev server proxies it; here it is proxied to VLLM_URL
// (e.g. http://gpu-host:8700), and only for a signed-in user (the model server has no login of its own). With no
// VLLM_URL it answers 503 JSON, so the screens fall back at once instead of being handed this app's index.html.
const VLLM_UPSTREAM = process.env.VLLM_URL ? new URL(process.env.VLLM_URL) : null
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "hospai_session"
const aiAuthCache = new Map()
async function signedIn(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))
  if (!m) return false
  const hit = aiAuthCache.get(m[1])
  if (hit && Date.now() - hit.at < 60000) return hit.ok
  let ok = false
  try {
    const r = await fetch(process.env.SYNC_AUTH_URL, { headers: { cookie: `${SESSION_COOKIE_NAME}=${m[1]}` } })
    const j = await r.json().catch(() => ({}))
    ok = Boolean(j && j.user)
  } catch {
    ok = false
  }
  aiAuthCache.set(m[1], { ok, at: Date.now() })
  return ok
}
app.use("/vllm-api", async (req, res) => {
  if (!(await signedIn(req))) return res.status(401).json({ error: "Sign in to use the AI services." })
  if (!VLLM_UPSTREAM) return res.status(503).json({ error: "The AI model server is not configured (set VLLM_URL on the web server)." })
  const headers = { ...req.headers, host: VLLM_UPSTREAM.host }
  delete headers.cookie // the hospital session is not for the model server
  if (process.env.VLLM_API_KEY) headers.authorization = `Bearer ${process.env.VLLM_API_KEY}`
  const base = VLLM_UPSTREAM.pathname.replace(/\/$/, "")
  const upstream = http.request({ hostname: VLLM_UPSTREAM.hostname, port: VLLM_UPSTREAM.port || 80, method: req.method, path: base + req.url, headers }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers)
    up.pipe(res)
  })
  upstream.setTimeout(240000, () => upstream.destroy(new Error("model server timeout")))
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).json({ error: "The AI model server is not reachable." })
    else res.end()
  })
  req.pipe(upstream)
})

// ── OCR screens (optional) ───────────────────────────────────────────────────
// Built screens (ocr-frontend/dist) win. Without a build, /keppler-ocr (and the OCR app's own /api calls)
// are forwarded to the OCR dev server (OCR_URL, default http://127.0.0.1:3000) so the embedded OCR page
// shows the OCR app instead of falling through to this hospital app's index.html (a login page inside the iframe).
const OCR_UPSTREAM = new URL(process.env.OCR_URL || "http://127.0.0.1:3000")
function forwardToOcr(req, res) {
  const headers = { ...req.headers, host: OCR_UPSTREAM.host }
  const upstream = http.request(
    { hostname: OCR_UPSTREAM.hostname, port: OCR_UPSTREAM.port || 80, method: req.method, path: req.originalUrl, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.setTimeout(60000, () => upstream.destroy(new Error("ocr upstream timeout")))
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).type("text/plain").send("The OCR service is not running.")
    else res.end()
  })
  req.pipe(upstream)
}
if (!fs.existsSync(path.join(OCR_DIST, "index.html"))) {
  app.use("/keppler-ocr", forwardToOcr)
  app.use("/api", forwardToOcr)
}
if (fs.existsSync(path.join(OCR_DIST, "index.html"))) {
  app.use("/keppler-ocr", express.static(OCR_DIST, { maxAge: "1y", immutable: true, index: false }))
  app.get(/^\/keppler-ocr(\/.*)?$/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache")
    res.sendFile(path.join(OCR_DIST, "index.html"))
  })
}

// ── the app ──────────────────────────────────────────────────────────────────
// Hashed assets never change, so they cache for a year; index.html is never cached, which is what
// lets an open tab pick up a new release (and avoids stale lazy-chunk 404s).
app.use(
  express.static(DIST, {
    index: false,
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
      else res.setHeader("Cache-Control", "no-cache")
    },
  }),
)
app.get(/^(?!\/(hms-api|sync-api)\/).*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-cache")
  res.sendFile(path.join(DIST, "index.html"))
})

const server = app.listen(PORT, "0.0.0.0", () => console.log(`[web] listening on :${PORT}  backend=${BACKEND.href}  data=${DATA_DIR}`))
server.keepAliveTimeout = 65000
server.headersTimeout = 70000
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)))
