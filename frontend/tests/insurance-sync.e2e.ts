// Two "browsers" sharing one in-memory fake of the /api/insurance server (versions + 409s).
import "./shim"
import { InsuranceEngineService as E } from "../src/services/insuranceDb"

type Rec = { doc: any; version: number }
const server = new Map<string, Rec>() // "collection/id" -> record
const g: any = globalThis
let calls: string[] = []
let snapshotCalls = 0

g.fetch = async (url: string, init: any = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^\/hms-api/, "")
  const method = (init.method || "GET").toUpperCase()
  const m = /^\/api\/insurance\/([a-z_]+)(?:\/([^/?]+))?/.exec(path)
  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  if (!m) return json(404, { error: "no route" })
  const [, coll, rawId] = m
  if (coll === "snapshot") {
    snapshotCalls++
    const etag = `${server.size}:${[...server.values()].reduce((a, r) => a + r.version, 0)}`
    if (new URL("http://x" + path).searchParams.get("etag") === etag) return json(200, { unchanged: true, etag })
    const collections: Record<string, any[]> = {}
    for (const [k, r] of server.entries()) (collections[k.split("/")[0]] ||= []).push({ ...r.doc, _version: r.version })
    return json(200, { unchanged: false, etag, collections })
  }
  const id = rawId ? decodeURIComponent(rawId) : ""
  calls.push(`${method} ${coll}/${id}`)
  if (method === "GET" && !id) {
    const records = [...server.entries()].filter(([k]) => k.startsWith(coll + "/")).map(([, r]) => ({ ...r.doc, _version: r.version }))
    return json(200, { records, count: records.length })
  }
  if (method === "PUT") {
    const body = JSON.parse(init.body)
    const key = `${coll}/${id}`
    const base = body._version
    delete body._version
    const cur = server.get(key)
    if (cur && base != null && base !== cur.version) return json(409, { error: "version conflict", current: { ...cur.doc, _version: cur.version } })
    const next = { doc: { ...body, id }, version: (cur?.version ?? 0) + 1 }
    server.set(key, next)
    return json(cur ? 200 : 201, { ...next.doc, _version: next.version })
  }
  if (method === "DELETE") {
    server.delete(`${coll}/${id}`)
    return json(200, { ok: true })
  }
  return json(405, {})
}

const results: string[] = []
const check = (name: string, cond: boolean, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " -> " + extra : ""}`)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const localCases = () => JSON.parse(localStorage.getItem("hospai_insurance_cases_v2") || "[]")

;(async () => {
  // Browser A: create a case; it must reach the server.
  const policy: any = { insurerName: "Star Health", policyNumber: "POL-9" }
  const c = E.openEncounterCase({ patientId: "UMR7001", patientName: "Sync Patient", encounterType: "IP", department: "General Medicine" }, policy)
  await wait(900)
  check("case reaches the server", server.has(`cases/${c.id}`), calls.join(", ") || "no calls")

  // Update on A pushes a new version.
  E.recordEligibility(c.id, { status: "Eligible", balanceAvailable: 100000, inNetwork: true } as any)
  await wait(900)
  check("update pushes version 2", server.get(`cases/${c.id}`)?.version === 2, `v${server.get(`cases/${c.id}`)?.version}`)
  check("server holds the new status", server.get(`cases/${c.id}`)?.doc.status === "ELIGIBLE")

  // Browser B: empty local storage; hydrate must load the case.
  localStorage.clear()
  await E.hydrate()
  check("second browser sees the case after hydrate", localCases().some((x: any) => x.id === c.id))
  check("second browser sees server status", localCases().find((x: any) => x.id === c.id)?.status === "ELIGIBLE")

  // Stale write: B edits, A (stale) edits -> conflict, server copy kept.
  const stale = { ...localCases().find((x: any) => x.id === c.id), _version: 1, status: "STALE_VALUE" }
  const res = await fetch(`/api/insurance/cases/${c.id}`, { method: "PUT", body: JSON.stringify(stale) })
  check("stale version is rejected with 409", res.status === 409)
  check("stale write did not overwrite", server.get(`cases/${c.id}`)?.doc.status === "ELIGIBLE")

  // First-run migration: server empty, browser has records -> uploaded.
  server.clear()
  await E.hydrate()
  await wait(900)
  check("empty server is seeded from local records", server.has(`cases/${c.id}`))

  // An idle poll must be one tiny request, not eight.
  const before = snapshotCalls
  await E.hydrate()
  await E.hydrate()
  check("each poll is a single snapshot request", snapshotCalls - before === 2, `calls ${snapshotCalls - before}`)

  console.log(results.join("\n"))
})().catch((e) => {
  console.log(results.join("\n"))
  console.log("HARNESS ERROR", e)
})
