import { useEffect, useMemo, useState } from "react"
import { BillingDatabase } from "../../services/billingDb"
import { PriceMaster } from "../../services/priceMaster"
import { getServiceCatalogue } from "../DoctorWorkflow"

export interface ErBedChargeVisit {
  visitNo: string
  patientId: string
  patientName: string
  age: number
  gender: "Male" | "Female" | "Other"
  phone: string
  doctor: string
  /** The bay the patient was triaged to, used only as a starting suggestion for the bed name. */
  suggestedBed: string
}

/**
 * ER bed and its charge for a patient admitted into the ER. The hospital types the bed and the
 * amount: nothing is pre-filled from a rate card. Saving puts one "ER bed" line on the visit's
 * ER bill (saving again replaces it).
 */
export default function ErBedChargePanel({
  visit,
  onSaved,
  notify,
}: {
  visit: ErBedChargeVisit
  onSaved?: () => void
  notify: (type: "success" | "error" | "warning", message: string) => void
}) {
  const current = useMemo(() => BillingDatabase.getErBedCharge(visit.visitNo), [visit.visitNo])
  const [bed, setBed] = useState(current?.label ?? visit.suggestedBed ?? "")
  const [perDay, setPerDay] = useState(current ? String(current.perDay) : "")
  const [days, setDays] = useState(current ? String(current.days) : "1")
  const [saving, setSaving] = useState(false)
  const [, bump] = useState(0)

  // Charges other than the bed are typed in here: nothing is added automatically when a medication,
  // procedure or test is charted.
  const CATEGORIES = ["Procedure / Surgery", "Laboratory", "Radiology / Imaging", "Pharmacy", "Consumables", "Nursing", "Consultation", "Other"]
  const [chargeText, setChargeText] = useState("")
  const [chargeCategory, setChargeCategory] = useState(CATEGORIES[0])
  const [chargeQty, setChargeQty] = useState("1")
  const [chargeAmount, setChargeAmount] = useState("")

  useEffect(() => BillingDatabase.onUpdate(() => bump((n) => n + 1)), [])
  useEffect(() => PriceMaster.onUpdate(() => bump((n) => n + 1)), [])

  // Charges Administration has priced (Rates & Charges): offered as suggestions, amount filled in when picked.
  const suggestions: { name: string; category: string; price: number }[] = [
    ...PriceMaster.custom().map((c) => ({ name: c.name, category: c.category, price: c.price })),
    ...getServiceCatalogue().filter((x) => x.price > 0).map((x) => ({ name: x.name, category: String(x.category), price: x.price })),
  ]
  const pickCharge = (text: string) => {
    setChargeText(text)
    const hit = suggestions.find((x) => x.name.toLowerCase() === text.trim().toLowerCase())
    if (hit) {
      setChargeAmount(String(hit.price))
      if (CATEGORIES.includes(hit.category)) setChargeCategory(hit.category)
    }
  }

  const total = (Number(perDay) || 0) * Math.max(1, Math.floor(Number(days) || 1))
  const bill = BillingDatabase.getClaims().find((c) => (c.encounterId || "").toLowerCase() === visit.visitNo.toLowerCase() && c.status !== "Voided")

  const save = () => {
    setSaving(true)
    try {
      BillingDatabase.setErBedCharge(
        { visitNo: visit.visitNo, patientId: visit.patientId, patientName: visit.patientName, age: visit.age, gender: visit.gender, phone: visit.phone, doctor: visit.doctor },
        { label: bed, perDay: Number(perDay), days: Number(days) },
      )
      notify("success", `ER bed charge of ₹${total.toLocaleString("en-IN")} saved to this patient's ER bill.`)
      onSaved?.()
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Could not save the bed charge")
    } finally {
      setSaving(false)
    }
  }

  const info = { visitNo: visit.visitNo, patientId: visit.patientId, patientName: visit.patientName, age: visit.age, gender: visit.gender, phone: visit.phone, doctor: visit.doctor }

  const addCharge = () => {
    try {
      BillingDatabase.addErManualCharge(info, { description: chargeText, category: chargeCategory, unitPrice: Number(chargeAmount), quantity: Number(chargeQty) })
      notify("success", `"${chargeText.trim()}" added to this patient's ER bill.`)
      setChargeText("")
      setChargeAmount("")
      setChargeQty("1")
      onSaved?.()
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Could not add the charge")
    }
  }

  const removeCharge = (id: string, label: string) => {
    if (!window.confirm(`Remove "${label}" from the ER bill?`)) return
    try {
      BillingDatabase.removeErCharge(visit.visitNo, id)
      notify("success", "Charge removed from the ER bill.")
      onSaved?.()
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Could not remove the charge")
    }
  }

  const input = "h-9 px-3 bg-white border border-slate-300 text-sm text-slate-900 rounded-none w-full focus:outline-none focus:border-blue-700"

  return (
    <div className="bg-white border border-slate-300 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">ER bed &amp; charges</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          For a patient admitted into the ER: enter the bed they are on and what it is charged. The amount is yours to set; it is not filled in for you, and it goes straight onto this patient's ER bill.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          ER bed / bay *
          <input className={`${input} mt-1`} value={bed} onChange={(e) => setBed(e.target.value)} placeholder="e.g. ER Bed 4, Resus Bay 2" />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Charge per day (₹) *
          <input className={`${input} mt-1`} inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Enter amount" />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Number of days
          <input className={`${input} mt-1`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm text-slate-700">
          Bed charge: <strong className="font-mono text-slate-900">₹{total.toLocaleString("en-IN")}</strong>
          {total > 0 && <span className="text-xs text-slate-500"> ({Math.max(1, Math.floor(Number(days) || 1))} × ₹{(Number(perDay) || 0).toLocaleString("en-IN")})</span>}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 h-9 bg-[#1B4FD8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-xs font-bold rounded-none cursor-pointer"
        >
          {current ? "Update bed charge" : "Add bed charge to ER bill"}
        </button>
        {current && <span className="text-xs text-emerald-700 font-semibold">Saved on the ER bill: ₹{current.total.toLocaleString("en-IN")}</span>}
      </div>

      <div className="border-t border-slate-200 pt-3 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Add another charge</div>
        <p className="text-xs text-slate-500">
          Medications, procedures and tests recorded on the chart are <strong>not</strong> billed automatically. Add a charge here when something should be billed.
        </p>
        <div className="grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_80px_120px_auto] gap-2 items-end">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            What for *
            <input className={`${input} mt-1`} list="er-extra-charges" value={chargeText} onChange={(e) => pickCharge(e.target.value)} placeholder="Type, or pick a charge Administration has priced" />
            <datalist id="er-extra-charges">
              {suggestions.map((x) => (
                <option key={x.name} value={x.name}>{`₹${x.price}`}</option>
              ))}
            </datalist>
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Type
            <select className={`${input} mt-1`} value={chargeCategory} onChange={(e) => setChargeCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Qty
            <input className={`${input} mt-1`} inputMode="numeric" value={chargeQty} onChange={(e) => setChargeQty(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Amount each (₹) *
            <input className={`${input} mt-1`} inputMode="numeric" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Enter amount" />
          </label>
          <button type="button" onClick={addCharge} className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-none cursor-pointer">
            Add charge
          </button>
        </div>
      </div>

      {bill && (
        <div className="border-t border-slate-200 pt-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">ER bill so far</div>
          <table className="w-full text-xs">
            <tbody>
              {bill.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-800">{it.description}</td>
                  <td className="py-1 text-right font-mono text-slate-800">₹{Number(it.total || 0).toLocaleString("en-IN")}</td>
                  <td className="py-1 pl-2 text-right w-16">
                    <button type="button" onClick={() => removeCharge(it.id, it.description)} className="text-[11px] text-rose-600 hover:underline cursor-pointer">Remove</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 font-bold text-slate-900">Total</td>
                <td className="py-1.5 text-right font-mono font-bold text-slate-900">₹{Number(bill.totalAmount || 0).toLocaleString("en-IN")}</td>
                <td />
              </tr>
              <tr>
                <td className="py-0.5 text-slate-600">Paid</td>
                <td className="py-0.5 text-right font-mono text-slate-700">₹{Number(bill.amountPaid || 0).toLocaleString("en-IN")}</td>
              </tr>
              <tr>
                <td className="py-0.5 font-semibold text-slate-800">Balance due</td>
                <td className="py-0.5 text-right font-mono font-semibold text-slate-900">₹{Number(bill.balanceDue || 0).toLocaleString("en-IN")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
