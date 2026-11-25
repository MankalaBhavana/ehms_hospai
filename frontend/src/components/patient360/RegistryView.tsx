import { useEffect, useState } from "react"
import { p360 } from "./api"
import { Badge, Card, Empty, ErrorBox, fmtDate, fullName, inputCls, Loading, Pager, Table, useAsync } from "./ui"

const PAGE = 25
const STATES = [
  { key: "", label: "All patients" },
  { key: "admitted", label: "Currently admitted" },
  { key: "discharged_30d", label: "Discharged in last 30 days" },
  { key: "active_journey", label: "With an active journey" },
  { key: "open_tasks", label: "With open tasks" },
]

export default function RegistryView({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  const [state, setState] = useState("")
  const [offset, setOffset] = useState(0)

  // Debounce typing so a search is one request, not one per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setTerm(q.trim())
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(t)
  }, [q])

  const { data, error, loading, reload } = useAsync(() => p360.registry({ q: term, state, limit: PAGE, offset }), [term, state, offset])

  return (
    <Card title="Patient registry">
      <div className="mb-3 grid gap-2 md:grid-cols-[1fr_240px]">
        <input aria-label="Search patients" className={inputCls} placeholder="Search by name, patient ID or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter patients" className={inputCls} value={state} onChange={(e) => { setState(e.target.value); setOffset(0) }}>
          {STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <p className="mb-2 text-[10.5px] text-[#94A3B8]">Registered patients only. Rows imported from an uploaded file in PatientReach AI are not part of the registry until they are registered.</p>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : !data || data.patients.length === 0 ? (
        <Empty>No patients match.</Empty>
      ) : (
        <>
          <Table head={["Patient ID", "Name", "Age / sex", "Phone", "Status", "Last discharge", "Journey", "Open tasks"]}>
            {data.patients.map((p: any) => (
              <tr key={p.patient_id} className="cursor-pointer hover:bg-[#F8FAFC]" onClick={() => onOpenPatient(p.patient_id)}>
                <td className="px-2 py-1.5 font-medium text-[#1B4FD8]">{p.patient_id}</td>
                <td className="px-2 py-1.5">{fullName(p)}</td>
                <td className="px-2 py-1.5">{p.age ?? "—"} / {p.gender || "—"}</td>
                <td className="px-2 py-1.5">{p.phone || "—"}</td>
                <td className="px-2 py-1.5">{Number(p.admitted) ? <Badge tone="blue">Admitted</Badge> : "—"}</td>
                <td className="px-2 py-1.5">{fmtDate(p.last_discharge)}</td>
                <td className="px-2 py-1.5">{p.journey_state ? <Badge status={p.journey_state} /> : "—"}</td>
                <td className="px-2 py-1.5">{Number(p.open_tasks) > 0 ? <Badge status="open">{p.open_tasks}</Badge> : 0}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
        </>
      )}
    </Card>
  )
}
