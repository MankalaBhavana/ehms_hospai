// Who may read and write which shared key. Everything a signed-in user needs for the hospital's day-to-day work stays open
// to every signed-in user (the screens decide what is shown); the sensitive domains below are enforced here, on the
// server, from the session the auth service reports: a browser cannot talk its way past them.
//
//   read + write  HR / payroll / staff credentials       needs hr.read or employees.read
//   read + write  accounting ledger                      needs accounts.read
//   write only    rate master, helpline numbers, role definitions          administrators only (everyone may read them)

const RULES = [
  { re: /^(hrms_|hosp_hrms|hospai_hr_)/, any: ["hr.read", "employees.read"], scope: "both" },
  { re: /^(hospai_accounts|hosp_accounts|hospai_gl|hospai_ledger)/, any: ["accounts.read"], scope: "both" },
  { re: /^(hospai_price_master|hospai_rbac_roles|hospai_hospital_contacts)/, any: [], scope: "write", adminOnly: true },
]

export function isAdminProfile(profile) {
  if (!profile) return false
  const t = String(profile.user_type || "").toLowerCase()
  const r = String(profile.role_key || profile.role || "").toUpperCase()
  return t === "admin" || r === "ROLE_ADMIN" || String(profile.username || "").toLowerCase() === "admin"
}

function allowed(profile, key, mode) {
  if (isAdminProfile(profile)) return true
  for (const rule of RULES) {
    if (!rule.re.test(key)) continue
    if (rule.scope === "write" && mode === "read") continue
    if (rule.adminOnly) return false
    const held = new Set(Array.isArray(profile && profile.permissions) ? profile.permissions : [])
    return rule.any.some((p) => held.has(p))
  }
  return true
}

export const canRead = (profile, key) => allowed(profile, key, "read")
export const canWrite = (profile, key) => allowed(profile, key, "write")
