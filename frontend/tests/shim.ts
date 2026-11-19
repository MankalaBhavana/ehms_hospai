// End-to-end drive of the insurance engine (cashless IP journey) under a localStorage shim.
const store = new Map<string, string>()
const g: any = globalThis
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
g.sessionStorage = g.localStorage
g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true }, location: { origin: "http://x", hostname: "x", search: "" } })
g.document = { createElement: () => ({}), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, cookie: "" }
g.navigator = { userAgent: "node" }
g.BroadcastChannel = class { postMessage() {} addEventListener() {} removeEventListener() {} close() {} }

// sign in as a super user so permission checks pass
localStorage.setItem("hospai_session_user", JSON.stringify({ username: "tester", role: "ROLE_ADMIN" }))


;(globalThis as any).__HOSPAI_TEST__ = true
