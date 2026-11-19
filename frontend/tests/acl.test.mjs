// Server-side access rules of the shared data store (server/sync/acl.mjs).
import assert from "node:assert/strict"
import { canRead, canWrite } from "../server/sync/acl.mjs"

const admin = { user_type: "admin", username: "admin", permissions: ["*"] }
const receptionist = { user_type: "normal", role_key: "ROLE_RECEPTIONIST", permissions: ["patients.read", "billing.read", "patients.registration.write"] }
const hr = { user_type: "normal", role_key: "ROLE_HR_MANAGER", permissions: ["hr.read", "employees.read", "hr.payroll.write"] }
const accountant = { user_type: "normal", permissions: ["accounts.read", "accounts.ledger.write"] }
const results = []
const t = (name, fn) => { try { fn(); results.push("PASS  " + name) } catch (e) { results.push("FAIL  " + name + " -> " + e.message); process.exitCode = 1 } }

t("HR / payroll / credentials: only HR and admin read or write", () => {
  for (const key of ["hrms_payroll", "hrms_credentials", "hospai_hr_employees", "hosp_hrms_staff"]) {
    assert.equal(canRead(receptionist, key), false, key); assert.equal(canWrite(receptionist, key), false, key)
    assert.equal(canRead(accountant, key), false, key)
    assert.equal(canRead(hr, key), true, key); assert.equal(canWrite(hr, key), true, key)
    assert.equal(canRead(admin, key), true, key)
  }
})
t("accounting ledger: only accounts and admin", () => {
  assert.equal(canRead(receptionist, "hospai_gl_entries"), false)
  assert.equal(canRead(hr, "hospai_accounts_ledger"), false)
  assert.equal(canWrite(accountant, "hospai_accounts_ledger"), true)
})
t("rate master and role definitions: everyone reads, only the admin writes", () => {
  for (const key of ["hospai_price_master_v1", "hospai_rbac_roles_v29", "hospai_hospital_contacts_v1"]) {
    assert.equal(canRead(receptionist, key), true, key)
    assert.equal(canWrite(receptionist, key), false, key)
    assert.equal(canWrite(hr, key), false, key)
    assert.equal(canWrite(admin, key), true, key)
  }
})
t("day-to-day shared data stays open to every signed-in user", () => {
  for (const key of ["hospai_db_patients_v1", "hospai_lab_orders_v2", "hosp_billing_claims_inr_v11", "hospai_inpatient_beds_v9", "hospai_pharm_rx_v4"]) {
    assert.equal(canRead(receptionist, key), true, key); assert.equal(canWrite(receptionist, key), true, key)
  }
})
t("no profile reads or writes a gated key", () => {
  assert.equal(canRead(null, "hrms_payroll"), false); assert.equal(canWrite(undefined, "hospai_price_master_v1"), false)
})
console.log(results.join("\n"))
