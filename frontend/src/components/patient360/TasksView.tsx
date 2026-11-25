import { useState } from "react"
import { p360, type Row } from "./api"
import { Badge, btnCls, Card, Empty, ErrorBox, errMsg, Field, fmtDateTime, fullName, inputCls, Loading, Pager, ReasonDialog, Table, useAsync } from "./ui"

const PAGE = 25
type Pending = { task: Row; action: string; title: string; label: string; required: boolean }

/** Tasks & escalations (spec 10): acknowledge, assign, escalate, snooze, resolve -- every state change keeps its history. */
export default function TasksView({ onOpenPatient, patientId }: { onOpenPatient?: (id: string) => void; patientId?: string }) {
  const [status, setStatus] = useState("open")
  const [priority, setPriority] = useState("")
  const [overdue, setOverdue] = useState(false)
  const [offset, setOffset] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [assigning, setAssigning] = useState<Row | null>(null)
  const [detail, setDetail] = useState<Row | null>(null)
  const [msg, setMsg] = useState("")

  const { data, error, loading, reload } = useAsync(
    () => p360.tasks({ status, priority, overdue: overdue ? "true" : "", patient_id: patientId, limit: PAGE, offset }),
    [status, priority, overdue, offset, patientId],
  )

  const act = async (task: Row, action: string, body: Row = {}) => {
    setMsg("")
    try {
      await p360.taskAction(task.id, { action, ...body })
      if (detail?.id === task.id) setDetail(await p360.task(task.id))
      reload()
    } catch (e) {
      setMsg(errMsg(e))
    }
  }

  const ask = (task: Row, action: string, title: string, label: string, required = true) => setPending({ task, action, title, label, required })

  return (
    <div className="space-y-3">
      <Card title={patientId ? "Tasks for this patient" : "Tasks & escalations"}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0) }}>
              <option value="open">Open (all unresolved)</option>
              <option value="all">All</option>
              {["open", "assigned", "acknowledged", "in_progress", "escalated", "snoozed", "resolved", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={priority} onChange={(e) => { setPriority(e.target.value); setOffset(0) }}>
              <option value="">Any</option>
              {["urgent", "high", "normal", "low"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] text-[#334155]">
            <input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setOffset(0) }} /> Overdue only
          </label>
        </div>
        {msg && <div className="mb-2"><ErrorBox error={msg} /></div>}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : !data || data.tasks.length === 0 ? (
          <Empty>No tasks match these filters.</Empty>
        ) : (
          <>
            <Table head={["Priority", "Task", "Patient", "Owner", "Status", "Due", ""]}>
              {data.tasks.map((t: Row) => {
                const closed = t.status === "resolved" || t.status === "cancelled"
                const late = !closed && t.due_at && new Date(t.due_at) < new Date()
                return (
                  <tr key={t.id} className="align-top">
                    <td className="px-2 py-1.5"><Badge status={t.priority} /></td>
                    <td className="px-2 py-1.5">
                      <button className="text-left font-medium text-[#1B4FD8] hover:underline" onClick={async () => setDetail(await p360.task(t.id).catch(() => null))}>{t.title}</button>
                      <div className="text-[10.5px] text-[#94A3B8]">{(t.category || "").replace(/_/g, " ")}</div>
                    </td>
                    <td className="px-2 py-1.5">
                      {onOpenPatient ? <button className="text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(t.patient_id)}>{t.patient_id}</button> : t.patient_id}
                      <div className="text-[10.5px] text-[#94A3B8]">{fullName(t)}</div>
                    </td>
                    <td className="px-2 py-1.5">{t.assigned_to || t.owner_team || "Unassigned"}</td>
                    <td className="px-2 py-1.5"><Badge status={t.status} /></td>
                    <td className={late ? "px-2 py-1.5 font-medium text-[#B91C1C]" : "px-2 py-1.5"}>{fmtDateTime(t.due_at)}{late && " (overdue)"}</td>
                    <td className="px-2 py-1.5">
                      {!closed && (
                        <div className="flex flex-wrap gap-1">
                          {["open", "assigned", "escalated", "snoozed"].includes(t.status) && <button className={btnCls.small} onClick={() => act(t, "acknowledge")}>Acknowledge</button>}
                          <button className={btnCls.small} onClick={() => setAssigning(t)}>Assign</button>
                          {["acknowledged", "assigned", "open"].includes(t.status) && <button className={btnCls.small} onClick={() => act(t, "start")}>Start</button>}
                          <button className={btnCls.small} onClick={() => ask(t, "escalate", "Escalate task", "Why is this being escalated?")}>Escalate</button>
                          <button className={btnCls.small} onClick={() => act(t, "snooze", { until: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })}>Snooze 24h</button>
                          <button className={btnCls.primary} onClick={() => ask(t, "resolve", "Resolve task", "Action taken and outcome")}>Resolve</button>
                          <button className={btnCls.danger} onClick={() => ask(t, "cancel", "Cancel task", "Why is it being cancelled?")}>Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
            <Pager total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>

      {detail && (
        <Card title={`Task #${detail.id} history`} actions={<button className={btnCls.small} onClick={() => setDetail(null)}>Close</button>}>
          {detail.description && <p className="mb-2 whitespace-pre-wrap text-[12px] text-[#334155]">{detail.description}</p>}
          <Table head={["When", "Event", "From → to", "By", "Note"]}>
            {(detail.history || []).map((h: Row, i: number) => (
              <tr key={i}>
                <td className="px-2 py-1.5">{fmtDateTime(h.created_at)}</td>
                <td className="px-2 py-1.5">{h.event_type}</td>
                <td className="px-2 py-1.5">{h.from_status || "—"} → {h.to_status || "—"}</td>
                <td className="px-2 py-1.5">{h.actor || "—"}</td>
                <td className="px-2 py-1.5">{h.note || ""}</td>
              </tr>
            ))}
          </Table>
          {detail.resolution_note && <p className="mt-2 text-[12px]"><b>Resolution:</b> {detail.resolution_note}</p>}
        </Card>
      )}

      {pending && (
        <ReasonDialog
          title={pending.title}
          label={pending.label}
          required={pending.required}
          onCancel={() => setPending(null)}
          onConfirm={async (note) => {
            await p360.taskAction(pending.task.id, { action: pending.action, note, resolution_action: pending.action })
            setPending(null)
            if (detail?.id === pending.task.id) setDetail(await p360.task(pending.task.id))
            reload()
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          task={assigning}
          onCancel={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function AssignDialog({ task, onCancel, onDone }: { task: Row; onCancel: () => void; onDone: () => void }) {
  const [who, setWho] = useState(task.assigned_to || "")
  const [team, setTeam] = useState(task.owner_team || "")
  const [error, setError] = useState("")
  return (
    <div role="dialog" aria-modal="true" aria-label="Assign task" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm space-y-3 rounded bg-white p-4 shadow-lg">
        <h3 className="text-[13px] font-semibold">Assign “{task.title}”</h3>
        <Field label="Staff username"><input autoFocus className={inputCls} value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Team / role (optional)"><input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} /></Field>
        {error && <p className="text-[11.5px] text-[#B91C1C]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnCls.ghost} onClick={onCancel}>Cancel</button>
          <button
            className={btnCls.primary}
            onClick={async () => {
              try {
                await p360.taskAction(task.id, { action: "assign", assigned_to: who, owner_team: team })
                onDone()
              } catch (e) {
                setError(errMsg(e))
              }
            }}
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  )
}
