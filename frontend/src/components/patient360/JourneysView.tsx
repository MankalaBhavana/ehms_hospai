import { useState } from "react"
import { p360, type Row } from "./api"
import { Badge, btnCls, Card, Empty, ErrorBox, errMsg, Field, fmtDate, fmtDateTime, fullName, inputCls, Loading, pretty, ReasonDialog, Table, Tabs, useAsync } from "./ui"

type Sub = "journeys" | "enrollments" | "templates"

export default function JourneysView({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [sub, setSub] = useState<Sub>("journeys")
  return (
    <div className="space-y-3">
      <Tabs<Sub> value={sub} onChange={setSub} tabs={[{ key: "journeys", label: "Running journeys" }, { key: "enrollments", label: "Discharge enrollments" }, { key: "templates", label: "Pathway templates" }]} />
      {sub === "journeys" && <Journeys onOpenPatient={onOpenPatient} />}
      {sub === "enrollments" && <Enrollments onOpenPatient={onOpenPatient} />}
      {sub === "templates" && <Templates />}
    </div>
  )
}

function Journeys({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [state, setState] = useState("")
  const [openId, setOpenId] = useState<number | null>(null)
  const { data, error, loading, reload } = useAsync(() => p360.journeys({ state, limit: 50 }), [state])
  return (
    <div className="space-y-3">
      <Card
        title="Care journeys"
        actions={
          <select aria-label="Journey state" className={inputCls + " !w-44"} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {["active", "paused", "needs_review", "completed", "cancelled", "closed"].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </select>
        }
      >
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : !data || data.journeys.length === 0 ? (
          <Empty>No journeys yet. A journey starts automatically when a discharge is finalized and a published pathway template matches it.</Empty>
        ) : (
          <Table head={["Patient", "Pathway", "State", "Progress", "Next due", ""]}>
            {data.journeys.map((j: Row) => (
              <tr key={j.id}>
                <td className="px-2 py-1.5"><button className="text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(j.patient_id)}>{j.patient_id}</button><div className="text-[10.5px] text-[#94A3B8]">{fullName(j)}</div></td>
                <td className="px-2 py-1.5">{pretty(j.template_key)} <span className="text-[#94A3B8]">v{j.template_version}</span></td>
                <td className="px-2 py-1.5"><Badge status={j.state} /></td>
                <td className="px-2 py-1.5">{j.checkpoint_done}/{j.checkpoint_total}</td>
                <td className="px-2 py-1.5">{fmtDateTime(j.next_due_at)}</td>
                <td className="px-2 py-1.5"><button className={btnCls.small} onClick={() => setOpenId(openId === j.id ? null : j.id)}>{openId === j.id ? "Hide" : "Manage"}</button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {openId !== null && <JourneyDetail id={openId} onChanged={reload} />}
    </div>
  )
}

function JourneyDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { data, error, reload } = useAsync(() => p360.journey(id), [id])
  const [ask, setAsk] = useState<null | { state: string; title: string }>(null)
  const [cp, setCp] = useState<null | { row: Row; outcome: string }>(null)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return <Loading />
  const live = ["active", "paused", "needs_review"].includes(data.state)
  const done = () => { reload(); onChanged() }
  return (
    <Card title={`Journey #${data.id} — ${pretty(data.template_key)} v${data.template_version}`} actions={<Badge status={data.state} />}>
      {data.state_reason && <p className="mb-2 text-[12px] text-[#475569]">Reason: {data.state_reason}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {data.state === "active" && <button className={btnCls.ghost} onClick={() => setAsk({ state: "paused", title: "Pause journey (no new check-ins until resumed)" })}>Pause</button>}
        {(data.state === "paused" || data.state === "needs_review") && <button className={btnCls.primary} onClick={async () => { try { await p360.journeyState(id, "active", ""); done() } catch (e) { alert(errMsg(e)) } }}>Resume</button>}
        {live && <button className={btnCls.ghost} onClick={() => setAsk({ state: "needs_review", title: "Flag for staff review" })}>Flag for review</button>}
        {live && <button className={btnCls.danger} onClick={() => setAsk({ state: "cancelled", title: "Cancel journey (remaining checkpoints are cancelled)" })}>Cancel</button>}
        {(live || data.state === "completed") && <button className={btnCls.ghost} onClick={() => setAsk({ state: "closed", title: "Close journey" })}>Close</button>}
      </div>
      <Table head={["Checkpoint", "Action", "Due", "Status", "Send-time check", ""]}>
        {data.checkpoints.map((c: Row) => (
          <tr key={c.id} className="align-top">
            <td className="px-2 py-1.5">{c.label}{c.completion_note && <div className="text-[10.5px] text-[#94A3B8]">{c.completion_note}</div>}</td>
            <td className="px-2 py-1.5">{pretty(c.action_type)}</td>
            <td className="px-2 py-1.5">{fmtDateTime(c.due_at)}</td>
            <td className="px-2 py-1.5"><Badge status={c.status} /></td>
            <td className="px-2 py-1.5 text-[11px]">{c.eligibility_at_send ? <>{c.eligibility_at_send.eligible ? "Eligible" : pretty(c.eligibility_at_send.reason)} <span className="text-[#94A3B8]">({c.eligibility_at_send.channel})</span></> : "—"}</td>
            <td className="px-2 py-1.5">
              {!["completed", "skipped", "cancelled"].includes(c.status) && (
                <div className="flex gap-1">
                  <button className={btnCls.small} onClick={() => setCp({ row: c, outcome: "completed" })}>Mark done</button>
                  <button className={btnCls.small} onClick={() => setCp({ row: c, outcome: "skipped" })}>Skip</button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {ask && <ReasonDialog title={ask.title} label="Reason (recorded in the audit trail)" onCancel={() => setAsk(null)} onConfirm={async (r) => { await p360.journeyState(id, ask.state, r); setAsk(null); done() }} />}
      {cp && <ReasonDialog title={cp.outcome === "skipped" ? `Skip “${cp.row.label}”` : `Complete “${cp.row.label}”`} label={cp.outcome === "skipped" ? "Why is it skipped?" : "Evidence / note (optional)"} required={cp.outcome === "skipped"} onCancel={() => setCp(null)} onConfirm={async (n) => { await p360.resolveCheckpoint(cp.row.id, cp.outcome, n); setCp(null); done() }} />}
    </Card>
  )
}

function Enrollments({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [status, setStatus] = useState("")
  const { data, error, loading, reload } = useAsync(() => p360.enrollments({ status, limit: 50 }), [status])
  const templates = useAsync(() => p360.templates(), [])
  const published = (templates.data?.templates || []).filter((t: Row) => t.status === "published")
  const [pick, setPick] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState("")
  const start = async (e: Row) => {
    setMsg("")
    try {
      await p360.startJourney(e.id, Number(pick[e.id]))
      reload()
    } catch (err) { setMsg(errMsg(err)) }
  }
  return (
    <Card
      title="Finalized discharges"
      actions={<select aria-label="Enrollment status" className={inputCls + " !w-44"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{["eligible", "pending_review", "enrolled", "completed", "cancelled"].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>}
    >
      <p className="mb-2 text-[11px] text-[#64748B]">Each discharge appears once (a retried discharge cannot enrol a patient twice). “Eligible” means no published pathway matched; “Pending review” means the patient already has a running journey.</p>
      {msg && <div className="mb-2"><ErrorBox error={msg} /></div>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : !data || data.enrollments.length === 0 ? <Empty>No discharges enrolled yet.</Empty> : (
        <Table head={["Patient", "Discharged", "Ward", "Stay", "Status", "Start journey"]}>
          {data.enrollments.map((e: Row) => (
            <tr key={e.id} className="align-top">
              <td className="px-2 py-1.5"><button className="text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(e.patient_id)}>{e.patient_id}</button><div className="text-[10.5px] text-[#94A3B8]">{fullName(e)}</div></td>
              <td className="px-2 py-1.5">{fmtDateTime(e.discharged_at)}</td>
              <td className="px-2 py-1.5">{e.ward || "—"}</td>
              <td className="px-2 py-1.5">{e.stay_days != null ? `${Number(e.stay_days).toFixed(1)} d` : "—"}</td>
              <td className="px-2 py-1.5"><Badge status={e.status} />{e.exclusion_reason && <div className="text-[10.5px] text-[#94A3B8]">{pretty(e.exclusion_reason)}</div>}</td>
              <td className="px-2 py-1.5">
                {["eligible", "pending_review"].includes(e.status) && (
                  <div className="flex gap-1">
                    <select aria-label="Template" className={inputCls + " !w-40"} value={pick[e.id] || ""} onChange={(ev) => setPick({ ...pick, [e.id]: ev.target.value })}>
                      <option value="">Choose pathway…</option>
                      {published.map((t: Row) => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}
                    </select>
                    <button className={btnCls.small} disabled={!pick[e.id]} onClick={() => start(e)}>Start</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

const blankCp = () => ({ key: "", label: "", action_type: "call_task", offset_days: 1, offset_hours: 0, owner_role: "care_coordinator", survey_key: "", message_text: "", instructions: "" })

function Templates() {
  const { data, error, loading, reload } = useAsync(() => p360.templates(), [])
  const [editing, setEditing] = useState<Row | null>(null)
  const [msg, setMsg] = useState("")
  const run = async (fn: () => Promise<any>) => { setMsg(""); try { await fn(); reload() } catch (e) { setMsg(errMsg(e)) } }
  return (
    <div className="space-y-3">
      <Card title="Pathway templates" actions={<button className={btnCls.primary} onClick={() => setEditing({ name: "", pathway: "general_discharge", wards: "", min_stay_days: 0, change_log: "", checkpoints: [blankCp()] })}>+ New template</button>}>
        <p className="mb-2 text-[11px] text-[#64748B]">Timing, wording, owners and escalation are clinical decisions. A template only runs once a <b>different</b> authorized person has approved and published it; running journeys keep the version they started on.</p>
        {msg && <div className="mb-2"><ErrorBox error={msg} /></div>}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : !data || data.templates.length === 0 ? <Empty>No templates yet.</Empty> : (
          <Table head={["Template", "Version", "Status", "Checkpoints", "Updated", ""]}>
            {data.templates.map((t: Row) => (
              <tr key={t.id} className="align-top">
                <td className="px-2 py-1.5"><b>{t.name}</b><div className="text-[10.5px] text-[#94A3B8]">{t.template_key} · {pretty(t.pathway)}</div></td>
                <td className="px-2 py-1.5">v{t.version}</td>
                <td className="px-2 py-1.5"><Badge status={t.status} />{t.approved_by && <div className="text-[10.5px] text-[#94A3B8]">approved by {t.approved_by}</div>}</td>
                <td className="px-2 py-1.5">{t.checkpoints.length}</td>
                <td className="px-2 py-1.5">{fmtDate(t.published_at || t.approved_at || t.submitted_at || t.created_at)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {t.status === "draft" && <button className={btnCls.small} onClick={() => setEditing({ ...t, wards: (t.eligibility.wards || []).join(", "), min_stay_days: t.eligibility.min_stay_days || 0 })}>Edit</button>}
                    {t.status === "draft" && <button className={btnCls.small} onClick={() => run(() => p360.submitTemplate(t.id))}>Submit for approval</button>}
                    {t.status === "pending_approval" && <><button className={btnCls.small} onClick={() => run(() => p360.reviewTemplate(t.id, "approve"))}>Approve</button><button className={btnCls.small} onClick={() => run(() => p360.reviewTemplate(t.id, "reject"))}>Send back</button></>}
                    {t.status === "approved" && <button className={btnCls.primary} onClick={() => run(() => p360.reviewTemplate(t.id, "publish"))}>Publish</button>}
                    {t.status === "published" && <button className={btnCls.small} onClick={() => run(() => p360.reviewTemplate(t.id, "retire"))}>Retire</button>}
                    {["published", "retired", "approved"].includes(t.status) && <button className={btnCls.small} onClick={() => run(() => p360.newTemplateVersion(t.id))}>New version</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <TemplateEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function TemplateEditor({ initial, onClose, onSaved }: { initial: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Row>(initial)
  const [error, setError] = useState("")
  const setCp = (i: number, patch: Row) => setF({ ...f, checkpoints: f.checkpoints.map((c: Row, n: number) => (n === i ? { ...c, ...patch } : c)) })
  const save = async () => {
    setError("")
    const body = {
      name: f.name, template_key: f.template_key || f.name, pathway: f.pathway, change_log: f.change_log,
      eligibility: { wards: String(f.wards || "").split(",").map((s) => s.trim()).filter(Boolean), min_stay_days: Number(f.min_stay_days) || 0 },
      checkpoints: f.checkpoints.map((c: Row) => ({ ...c, offset_days: Number(c.offset_days) || 0, offset_hours: Number(c.offset_hours) || 0 })),
    }
    try {
      if (f.id) await p360.updateTemplate(f.id, body)
      else await p360.createTemplate({ ...body, template_key: String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) })
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }
  return (
    <Card title={f.id ? `Edit draft — ${f.name} v${f.version}` : "New pathway template"} actions={<button className={btnCls.small} onClick={onClose}>Close</button>}>
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Pathway"><input className={inputCls} value={f.pathway} onChange={(e) => setF({ ...f, pathway: e.target.value })} placeholder="surgical_discharge" /></Field>
        <Field label="Only these wards" hint="Comma-separated; empty = any ward"><input className={inputCls} value={f.wards} onChange={(e) => setF({ ...f, wards: e.target.value })} /></Field>
        <Field label="Minimum stay (days)"><input className={inputCls} type="number" min={0} value={f.min_stay_days} onChange={(e) => setF({ ...f, min_stay_days: e.target.value })} /></Field>
      </div>
      <h4 className="mb-1 mt-4 text-[12px] font-semibold">Checkpoints (timing is relative to the discharge time)</h4>
      <div className="space-y-2">
        {f.checkpoints.map((c: Row, i: number) => (
          <div key={i} className="grid gap-2 rounded border border-[#E2E8F0] p-2 md:grid-cols-6">
            <Field label="Key"><input className={inputCls} value={c.key} onChange={(e) => setCp(i, { key: e.target.value.toLowerCase() })} placeholder="day1" /></Field>
            <Field label="Label"><input className={inputCls} value={c.label} onChange={(e) => setCp(i, { label: e.target.value })} /></Field>
            <Field label="Action"><select className={inputCls} value={c.action_type} onChange={(e) => setCp(i, { action_type: e.target.value })}>{["call_task", "staff_review", "message", "survey", "appointment_reminder"].map((a) => <option key={a} value={a}>{pretty(a)}</option>)}</select></Field>
            <Field label="After (days)"><input className={inputCls} type="number" min={0} value={c.offset_days} onChange={(e) => setCp(i, { offset_days: e.target.value })} /></Field>
            <Field label="+ hours"><input className={inputCls} type="number" min={0} max={23} value={c.offset_hours} onChange={(e) => setCp(i, { offset_hours: e.target.value })} /></Field>
            <Field label="Owner role"><input className={inputCls} value={c.owner_role} onChange={(e) => setCp(i, { owner_role: e.target.value })} /></Field>
            {c.action_type === "survey" && <div className="md:col-span-3"><Field label="Survey key (published survey)"><input className={inputCls} value={c.survey_key} onChange={(e) => setCp(i, { survey_key: e.target.value.toLowerCase() })} /></Field></div>}
            {["message", "appointment_reminder"].includes(c.action_type) && <div className="md:col-span-4"><Field label="Approved message text" hint="No diagnosis or medicine names in message text."><input className={inputCls} value={c.message_text} maxLength={600} onChange={(e) => setCp(i, { message_text: e.target.value })} /></Field></div>}
            <div className="md:col-span-5"><Field label="Instructions for staff (optional)"><input className={inputCls} value={c.instructions} maxLength={500} onChange={(e) => setCp(i, { instructions: e.target.value })} /></Field></div>
            <div className="flex items-end"><button className={btnCls.danger} disabled={f.checkpoints.length === 1} onClick={() => setF({ ...f, checkpoints: f.checkpoints.filter((_: Row, n: number) => n !== i) })}>Remove</button></div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className={btnCls.ghost} onClick={() => setF({ ...f, checkpoints: [...f.checkpoints, blankCp()] })}>+ Add checkpoint</button>
        <div className="flex items-center gap-2">
          <input aria-label="Change note" className={inputCls + " !w-64"} placeholder="What changed (change log)" value={f.change_log || ""} onChange={(e) => setF({ ...f, change_log: e.target.value })} />
          <button className={btnCls.primary} onClick={save}>Save draft</button>
        </div>
      </div>
      {error && <div className="mt-2"><ErrorBox error={error} /></div>}
    </Card>
  )
}
