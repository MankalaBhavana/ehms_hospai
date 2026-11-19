import { useEffect, useMemo, useState } from "react"
import { BillingDatabase } from "../../services/billingDb"
import { placeInvestigations, placePrescription, type Orderable } from "../../services/ipOrders"
import type { IpCase } from "../../services/ipCare"
import type { DoctorAccount } from "../../services/doctorPortalDb"
import DictationTextarea from "../voice/DictationTextarea"
import DictationInput from "../voice/DictationInput"

/**
 * Orders from the in-patient screen: investigations (laboratory and radiology) and medicines for an admitted patient.
 *
 *  - Laboratory orders go to the lab billing desk first (the laboratory sees them once they are paid), exactly like an
 *    ICU or OP order; radiology studies the same way.
 *  - Medicines come from the pharmacy stock list (what the pharmacy actually holds, at the pharmacy's own price) and go
 *    into the pharmacy prescription queue; the pharmacy is told.
 *  Prices are whatever Administration set; an unpriced item is shown as "not set", never given a made-up price.
 */
const inr = (n: number) => (n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "price not set")
export function InvestigationOrder({ ipCase, doctor, onDone }: { ipCase: IpCase; doctor?: DoctorAccount; onDone: (msg: string) => void }) {
  const [catalogue, setCatalogue] = useState<Orderable[]>([])
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Orderable[]>([])
  const [urgency, setUrgency] = useState<"Routine" | "STAT">("Routine")
  const [notes, setNotes] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    // the catalogue (and the imaging list inside it) is loaded on demand
    import("../DoctorWorkflow").then((m) => {
      if (!live) return
      setCatalogue(m.getOrderableTests())
      window.setTimeout(() => live && setCatalogue(m.getOrderableTests()), 1200) // imaging list arrives a moment later
    })
    return () => {
      live = false
    }
  }, [])

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    return catalogue.filter((x) => !picked.some((p) => p.name === x.name) && (x.name.toLowerCase().includes(t) || x.group.toLowerCase().includes(t))).slice(0, 12)
  }, [q, catalogue, picked])

  const place = () => {
    setErr("")
    setBusy(true)
    try {
      const { labOrder } = placeInvestigations(ipCase, doctor, picked, urgency, notes)
      const n = picked.length
      setPicked([])
      setNotes("")
      setQ("")
      onDone(`${n} test${n > 1 ? "s" : ""} ordered${labOrder ? ` (lab order ${labOrder.id})` : ""}. Sent to the lab & radiology billing desk; the lab and radiology see them once paid.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The order could not be placed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 p-3 space-y-2">
      <div className="text-[12.5px] font-bold text-slate-900">Order investigations</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests: CBC, LFT, chest x-ray, CT brain…" className="w-full h-9 px-2.5 border border-slate-300 text-[13px] rounded-none focus:outline-none focus:border-blue-700" />
      {catalogue.length === 0 && <div className="text-[12px] text-slate-500">Loading the test list…</div>}
      {matches.length > 0 && (
        <div className="border border-slate-200 max-h-52 overflow-y-auto">
          {matches.map((m) => (
            <button
              key={`${m.kind}-${m.name}`}
              type="button"
              onClick={() => {
                setPicked((p) => [...p, m])
                setQ("")
              }}
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
            >
              <span>
                {m.name} <span className="text-slate-400">· {m.kind}{m.group ? ` · ${m.group}` : ""}</span>
              </span>
              <span className={`font-mono text-[12px] ${m.price > 0 ? "text-slate-700" : "text-amber-700"}`}>{inr(m.price)}</span>
            </button>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 text-[12px]">
              {p.name} <span className="text-slate-500 font-mono">{inr(p.price)}</span>
              <button type="button" onClick={() => setPicked((x) => x.filter((y) => y.name !== p.name))} className="text-slate-500 hover:text-red-600 cursor-pointer" aria-label={`Remove ${p.name}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <DictationTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Clinical notes for the lab / radiologist (optional)" className="w-full border border-slate-300 px-2.5 py-2 text-[13px] rounded-none" />
      <div className="flex flex-wrap items-center gap-3">
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as "Routine" | "STAT")} className="h-8 px-2 border border-slate-300 text-[12.5px] bg-white rounded-none">
          <option>Routine</option>
          <option>STAT</option>
        </select>
        <button type="button" disabled={busy || !picked.length} onClick={place} className="h-8 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold disabled:opacity-40 cursor-pointer">
          Place order{picked.length ? ` (${picked.length})` : ""}
        </button>
        {err && <span className="text-[12.5px] text-red-700">{err}</span>}
      </div>
    </div>
  )
}

interface RxRow {
  id: string
  medicineId: string
  label: string
  dose: string
  frequency: string
  route: string
  duration: string
  quantity: string
  instructions: string
}
const emptyRow = (): RxRow => ({ id: Math.random().toString(36).slice(2, 8), medicineId: "", label: "", dose: "", frequency: "", route: "Oral", duration: "", quantity: "1", instructions: "" })

export function MedicineOrder({ ipCase, doctor, onDone }: { ipCase: IpCase; doctor?: DoctorAccount; onDone: (msg: string) => void }) {
  const stock = useMemo(() => BillingDatabase.getErPharmacyStock(), [])
  const [rows, setRows] = useState<RxRow[]>([emptyRow()])
  const [search, setSearch] = useState<Record<string, string>>({})
  const [urgent, setUrgent] = useState(false)
  const [err, setErr] = useState("")
  const set = (id: string, patch: Partial<RxRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const place = () => {
    setErr("")
    const lines = rows.filter((r) => r.medicineId || r.label.trim())
    try {
      const rx = placePrescription(
        ipCase,
        doctor,
        lines.map((r) => ({ medicineId: r.medicineId, label: r.label, dose: r.dose, frequency: r.frequency, route: r.route, duration: r.duration, quantity: Number(r.quantity) || 1, instructions: r.instructions })),
        urgent,
      )
      setRows([emptyRow()])
      setUrgent(false)
      onDone(`Prescription ${rx.id} (${lines.length} medicine${lines.length > 1 ? "s" : ""}) sent to the pharmacy.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The prescription could not be sent.")
    }
  }

  const input = "h-8 px-2 border border-slate-300 text-[12.5px] rounded-none focus:outline-none focus:border-blue-700 w-full"
  return (
    <div className="bg-white border border-slate-200 p-3 space-y-3">
      <div className="text-[12.5px] font-bold text-slate-900">Prescribe medicines</div>
      {stock.length === 0 && <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1">The pharmacy medicine master is empty: add medicines to the pharmacy first.</div>}
      {rows.map((r) => {
        const t = (search[r.id] ?? "").trim().toLowerCase()
        const found = r.medicineId || t.length < 2 ? [] : stock.filter((m) => m.label.toLowerCase().includes(t)).slice(0, 8)
        return (
          <div key={r.id} className="border border-slate-200 p-2 space-y-2">
            <div className="relative">
              <input
                value={r.medicineId ? r.label : (search[r.id] ?? "")}
                onChange={(e) => {
                  if (r.medicineId) set(r.id, { medicineId: "", label: "" })
                  setSearch((s) => ({ ...s, [r.id]: e.target.value }))
                }}
                placeholder="Search the pharmacy stock: paracetamol, pantoprazole…"
                className={input}
              />
              {found.length > 0 && (
                <div className="absolute z-20 left-0 right-0 bg-white border border-slate-300 shadow-lg max-h-52 overflow-y-auto">
                  {found.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        set(r.id, { medicineId: m.id, label: m.label })
                        setSearch((s) => ({ ...s, [r.id]: "" }))
                      }}
                      className="w-full flex justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                    >
                      <span>{m.label}</span>
                      <span className={`font-mono text-[11.5px] ${m.stock > 0 ? "text-emerald-700" : "text-red-700"}`}>{m.stock > 0 ? `${m.stock} in stock` : "out of stock"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <input className={input} placeholder="Dose (e.g. 1 tab)" value={r.dose} onChange={(e) => set(r.id, { dose: e.target.value })} />
              <input className={input} placeholder="Frequency (TDS)" value={r.frequency} onChange={(e) => set(r.id, { frequency: e.target.value })} />
              <select className={input} value={r.route} onChange={(e) => set(r.id, { route: e.target.value })}>
                {["Oral", "IV", "IM", "SC", "Topical", "Inhalation", "Sublingual", "Rectal"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input className={input} placeholder="Duration (5 days)" value={r.duration} onChange={(e) => set(r.id, { duration: e.target.value })} />
              <input className={input} placeholder="Qty" inputMode="numeric" value={r.quantity} onChange={(e) => set(r.id, { quantity: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div className="flex gap-2 items-start">
              <DictationInput className={input} placeholder="Instructions (after food, hold if …)" value={r.instructions} onChange={(e) => set(r.id, { instructions: e.target.value })} />
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} className="h-8 px-2 text-[12px] text-red-600 border border-red-200 cursor-pointer">
                  Remove
                </button>
              )}
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRows((r) => [...r, emptyRow()])} className="h-8 px-3 border border-slate-300 text-[12.5px] font-semibold cursor-pointer">
          + Add medicine
        </button>
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
        </label>
        <button type="button" onClick={place} className="h-8 px-4 bg-[#1B4FD8] text-white text-[12.5px] font-bold cursor-pointer">
          Send to pharmacy
        </button>
        {err && <span className="text-[12.5px] text-red-700">{err}</span>}
      </div>
    </div>
  )
}

