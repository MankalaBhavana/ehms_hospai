import "./shim"
import { BillingDatabase } from "../src/services/billingDb"
import { BedDatabase } from "../src/services/bedDb"
import { syncServerBilling } from "../src/services/billingSync"

const now = new Date().toISOString()
const bed = { id: 77, ward: "4th floor", room_no: "401", bed_no: "1", bed_type: "General", status: "Occupied", daily_rate: 100, patient_id: "ER-PAT-100015",
  patient_name: "Naruto", patient_last_name: "Uzumaki", admission_id: 5, allocated_at: now, admission_date: now, room_charges_so_far: 100, patient_age: 27, patient_gender: "Male", patient_phone: "9" }
const g: any = globalThis
g.fetch = async (url: string) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^\/hms-api/, "")
  const ok = (b: any) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })
  if (path.startsWith("/api/billing/invoices"))
    return ok({ invoices: [{ id: 501, invoice_no: "INV-IP-9-20261112-AAAAAA", patient_id: "ER-PAT-100015", module: "IP", total_amount: 8000, paid_amount: 0, due_amount: 8000, subtotal: 8000, discount: 0, tax: 0, payment_status: "due", created_at: now,
      items: [{ id: 1, description: "ICU bed - earlier stay (1 day @ 8000)", category: "Room / Bed Charges", quantity: 1, unit_price: 8000, total: 8000 }] }] })
  if (path.startsWith("/api/billing/payments")) return ok({ payments: [] })
  if (path.startsWith("/api/billing/claims")) return ok({ claims: [] })
  if (path.startsWith("/api/beds")) return ok({ beds: [bed] })
  if (path.startsWith("/api/patients/")) return ok({ patient_id: "ER-PAT-100015", name: "Naruto", last_name: "Uzumaki", age: 27, gender: "Male", phone: "9" })
  return new Response("{}", { status: 404 })
}
BedDatabase.save([bed as any])
const results: string[] = []
const check = (name: string, ok: boolean, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " -> " + extra : ""}`)
const due = () => BillingDatabase.getInpatientFinancialClearance("ER-PAT-100015", "Naruto Uzumaki")
const bedLines = () => BillingDatabase.getClaims().filter((c) => c.patientId === "ER-PAT-100015").flatMap((c) => c.items).filter((i) => /Bed 1 Accommodation|Room charges so far/.test(i.description))

// right after a refresh only the browser's own bill exists
check("before the server data arrives: Due is the bed's 100", due().balanceDue === 100, String(due().balanceDue))
;(async () => {
  await syncServerBilling()
  const d = due()
  check("after the server data arrives: the bed is still counted once", bedLines().length === 1, `${bedLines().length} bed line(s)`)
  check("Due is the same before and after the sync + the earlier bed's 8000 (itemised)", d.balanceDue === 8100 && (d.lines || []).some((l) => l.total === 8000), String(d.balanceDue))
  await syncServerBilling()
  check("a second sync does not change the amount", due().balanceDue === 8100, String(due().balanceDue))
  console.log(results.join(String.fromCharCode(10)))
})()
