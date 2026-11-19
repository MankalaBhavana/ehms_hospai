// Shared by the sync server and the browser client.
//
// Three-way merge for a key written by two people at once. `base` describes the copy
// the writer last synced from the server (record ids + a hash of each record), so we
// can tell what the writer actually CHANGED:
//   - record the writer changed          -> writer's version wins
//   - record the writer did not touch    -> the server's current version is kept
//                                           (and stays deleted if someone deleted it)
//   - record the writer added            -> kept
//   - record the writer deleted          -> stays deleted
//   - record someone else added          -> kept
// So two people saving different patients at the same moment never overwrite each other.

const ID_KEYS = ["id", "encounterId", "uid", "orderId", "studyId", "umr"]

function parse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function hash(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value)
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return h
}

function pickIdKey(arr) {
  if (!arr.length) return null
  for (const k of ID_KEYS) {
    if (arr.every((o) => o && typeof o === "object" && o[k] != null)) return k
  }
  return null
}

/** Describe a stored value so a later merge knows exactly what the writer had seen. */
export function describeBase(raw) {
  if (typeof raw !== "string" || raw.length > 4000000) return null
  const v = parse(raw)
  if (Array.isArray(v)) {
    const idKey = pickIdKey(v)
    if (!idKey) return { kind: "array", idKey: null, ids: [], hashes: {} }
    const hashes = {}
    for (const o of v) hashes[String(o[idKey])] = hash(o)
    return { kind: "array", idKey, ids: Object.keys(hashes), hashes }
  }
  if (v && typeof v === "object") {
    const hashes = {}
    for (const k of Object.keys(v)) hashes[k] = hash(v[k])
    return { kind: "object", ids: Object.keys(hashes), hashes }
  }
  return null
}

export function mergeValues(serverRaw, incomingRaw, base) {
  const s = parse(serverRaw)
  const i = parse(incomingRaw)
  if (s === undefined || i === undefined) return incomingRaw
  // Counters (UMR / OP numbers): never go backwards.
  if (typeof s === "number" && typeof i === "number") return String(Math.max(s, i))
  if (!base) return incomingRaw
  const seen = new Set(base.ids)
  const baseHash = base.hashes || {}

  if (Array.isArray(s) && Array.isArray(i) && base.kind === "array" && base.idKey) {
    const k = base.idKey
    const serverById = new Map()
    for (const o of s) if (o && o[k] != null) serverById.set(String(o[k]), o)
    const out = []
    const inIncoming = new Set()
    for (const o of i) {
      const id = String(o && o[k])
      inIncoming.add(id)
      const untouched = baseHash[id] !== undefined && hash(o) === baseHash[id]
      if (untouched) {
        // The writer only re-sent what it last saw: the server's copy is the newer truth.
        if (serverById.has(id)) out.push(serverById.get(id))
        // else: someone deleted it meanwhile -> stays deleted
      } else {
        out.push(o)
      }
    }
    for (const [id, o] of serverById) {
      if (!inIncoming.has(id) && !seen.has(id)) out.push(o) // added by someone else
    }
    return JSON.stringify(out)
  }

  if (
    s && i && typeof s === "object" && typeof i === "object" &&
    !Array.isArray(s) && !Array.isArray(i) && base.kind === "object"
  ) {
    const out = {}
    for (const key of Object.keys(i)) {
      const untouched = baseHash[key] !== undefined && hash(i[key]) === baseHash[key]
      if (untouched) {
        if (key in s) out[key] = s[key]
      } else {
        out[key] = i[key]
      }
    }
    for (const key of Object.keys(s)) {
      if (!(key in i) && !seen.has(key)) out[key] = s[key]
    }
    return JSON.stringify(out)
  }
  return incomingRaw
}
