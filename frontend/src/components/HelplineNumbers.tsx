import { useEffect, useState } from "react"
import { HospitalContacts, type HelplineEntry } from "../services/hospitalContacts"

/**
 * Administration > Rates & Charges > Helpline numbers. The hospital's helpline / emergency / ambulance numbers
 * are decided here and nowhere else; the OP card, journey reports, patient messages and printed headers all
 * read them from this list. Add as many as needed, mark one as primary (printed first), delete any.
 */
export default function HelplineNumbers() {
  const [rows, setRows] = useState<HelplineEntry[]>(() => HospitalContacts.list())
  const [label, setLabel] = useState("")
  const [number, setNumber] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => HospitalContacts.subscribe(() => setRows(HospitalContacts.list())), [])
  // Other tabs / desks change the list through the shared store.
  useEffect(() => {
    const on = () => setRows(HospitalContacts.list())
    window.addEventListener("storage", on)
    return () => window.removeEventListener("storage", on)
  }, [])

  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(""), 2500)
  }
  const run = (fn: () => void, ok: string) => {
    try {
      setError("")
      fn()
      flash(ok)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save")
    }
  }

  return (
    <div className="bg-white border border-[#DDE2EC] p-4 space-y-4">
      <p className="text-[12.5px] text-slate-600 max-w-3xl">
        The hospital&apos;s helpline numbers. They are printed on every <strong>OP card</strong> (the primary number first, up to three), and used in journey
        reports, receipts and patient messages. Only Administration can change them. With none listed, nothing is printed.
      </p>
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12.5px] px-3 py-2 font-semibold">✓ {notice}</div>}
      <div className="grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_auto] gap-2 items-end">
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Name *
          <input
            className="mt-1 h-9 px-3 w-full border border-slate-300 text-sm rounded-none focus:outline-none focus:border-blue-700"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Helpline, Emergency, Ambulance"
          />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Phone number *
          <input
            className="mt-1 h-9 px-3 w-full border border-slate-300 text-sm rounded-none font-mono focus:outline-none focus:border-blue-700"
            inputMode="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d+\-()\s/]/g, ""))}
            placeholder="Enter number"
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget.closest("div")?.querySelector("button") as HTMLButtonElement | null)?.click()
            }}
          />
        </label>
        <button
          type="button"
          className="h-9 px-4 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-xs font-bold rounded-none cursor-pointer"
          onClick={() =>
            run(() => {
              if (!label.trim()) throw new Error("Enter a name for the number (Helpline, Emergency ...).")
              HospitalContacts.add(label, number)
              setLabel("")
              setNumber("")
            }, "Number added")
          }
        >
          Add number
        </button>
      </div>
      {error && <p className="text-[12px] text-rose-700">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Number</th>
            <th className="px-3 py-2">On OP card</th>
            <th className="px-3 py-2 w-40" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="px-3 py-1.5">
                <input
                  className="h-8 w-full max-w-[220px] px-2 border border-transparent hover:border-slate-300 focus:border-blue-700 text-sm rounded-none focus:outline-none bg-transparent"
                  defaultValue={r.label}
                  key={`l-${r.id}-${r.label}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== r.label && run(() => HospitalContacts.update(r.id, { label: e.target.value }), "Saved")}
                />
              </td>
              <td className="px-3 py-1.5">
                <input
                  className="h-8 w-full max-w-[220px] px-2 border border-transparent hover:border-slate-300 focus:border-blue-700 text-sm font-mono rounded-none focus:outline-none bg-transparent"
                  defaultValue={r.number}
                  key={`n-${r.id}-${r.number}`}
                  onBlur={(e) => {
                    if (e.target.value.trim() === r.number) return
                    try {
                      run(() => HospitalContacts.update(r.id, { number: e.target.value }), "Saved")
                    } finally {
                      e.target.value = r.number
                    }
                  }}
                />
              </td>
              <td className="px-3 py-1.5 text-[12px]">
                {i === 0 ? <span className="font-bold text-emerald-700">Primary · printed first</span> : i < 3 ? <span className="text-slate-600">Printed</span> : <span className="text-slate-400">Not printed (card shows 3)</span>}
              </td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                {i !== 0 && (
                  <button type="button" className="text-[12px] text-blue-700 hover:underline mr-3 cursor-pointer" onClick={() => run(() => HospitalContacts.setPrimary(r.id), "Primary number changed")}>
                    Make primary
                  </button>
                )}
                <button
                  type="button"
                  className="text-[12px] text-rose-600 hover:underline cursor-pointer"
                  onClick={() => {
                    if (window.confirm(`Delete "${r.label} ${r.number}"? It will no longer print on OP cards.`)) run(() => HospitalContacts.remove(r.id), "Number deleted")
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-8 text-center text-slate-500 text-[13px]">
                No helpline numbers yet. Add the first one above; it appears on every OP card straight away.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
