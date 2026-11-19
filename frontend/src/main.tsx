import React, { Suspense, useEffect, useState } from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import PatientRecordPage from "./components/patientRecord/PatientRecordPage"
import { cardTokenFromHash, patientCodeFromHash } from "./components/patientRecord/patientRecord"
import { purgeAllLegacySeedData } from "./services/legacySeedPurge"
import { startServerSync } from "./lib/serverSync"
import "./index.css"

// Purge any legacy browser storage seeds and reset to clean state
purgeAllLegacySeedData()

// After a new version is deployed, a tab that was already open still points at the OLD
// lazy-loaded files (lab screens, reports ...), which no longer exist, so the page
// failed with "could not be displayed". Reload once to pick up the new version.
function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem("hospai_chunk_reload") || 0)
    if (Date.now() - last < 15000) return // never loop
    sessionStorage.setItem("hospai_chunk_reload", String(Date.now()))
  } catch {
    /* ignore */
  }
  window.location.reload()
}
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault()
  reloadForNewVersion()
})
;(window as any).__hospaiReloadForNewVersion = reloadForNewVersion

// Share every browser store through the server so all users see the same live data.
startServerSync()

// `#/patient/<code>` is the page a scanned OP card opens in its own tab (staff,
// signed in): the patient's complete record, outside the app shell.
// `#/card/<token>` is the same page opened from the card's QR, with no login.
function Root() {
  const read = () => ({ code: patientCodeFromHash(), card: cardTokenFromHash() })
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  if (route.card) return <PatientRecordPage key={`card:${route.card}`} cardToken={route.card} />
  if (route.code) return <PatientRecordPage key={route.code} code={route.code} />
  // Pages load their code on first open; a lazy page rendered outside the main area (modals, headers) still has a boundary.
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
