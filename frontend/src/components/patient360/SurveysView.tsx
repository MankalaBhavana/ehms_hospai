import { useState } from "react"
import { p360, type Row } from "./api"
import { Badge, btnCls, Card, Empty, ErrorBox, errMsg, Field, fmtDateTime, fullName, inputCls, Loading, pretty, Table, Tabs, useAsync } from "./ui"

type Sub = "responses" | "surveys" | "record"

export default function SurveysView({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [sub, setSub] = useState<Sub>("responses")
  return (
    <div className="space-y-3">
      <Tabs<Sub> value={sub} onChange={setSub} tabs={[{ key: "responses", label: "Response review" }, { key: "record", label: "Record a response" }, { key: "surveys", label: "Survey builder" }]} />
      {sub === "responses" && <Responses onOpenPatient={onOpenPatient} />}
      {sub === "record" && <RecordResponse />}
      {sub === "surveys" && <Surveys />}
    </div>
  )
}

function Responses({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const [status, setStatus] = useState("pending")
  const { data, error, loading, reload } = useAsync(() => p360.responses({ review_status: status, limit: 50 }), [status])
  const [msg, setMsg] = useState("")
  const review = async (r: Row, s: string) => {
    setMsg("")
    try { await p360.reviewResponse(r.id, s, ""); reload() } catch (e) { setMsg(errMsg(e)) }
  }
  return (
    <Card title="Survey responses" actions={<select aria-label="Review status" className={inputCls + " !w-40"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{["pending", "under_review", "reviewed"].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>}>
      <p className="mb-2 text-[11px] text-[#64748B]">These are the patient's own answers, shown exactly as submitted. They are patient-reported, not verified diagnoses, and cannot be edited.</p>
      {msg && <div className="mb-2"><ErrorBox error={msg} /></div>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : !data || data.responses.length === 0 ? <Empty>Nothing to review.</Empty> : (
        <div className="space-y-3">
          {data.responses.map((r: Row) => (
            <div key={r.id} className="rounded border border-[#E2E8F0] p-3 text-[12px]">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <button className="font-medium text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(r.patient_id)}>{r.patient_id} {fullName(r) !== "—" && `· ${fullName(r)}`}</button>
                <span>{pretty(r.survey_key)} v{r.survey_version}</span>
                <Badge status={r.review_status} />
                <span className="text-[#94A3B8]">{fmtDateTime(r.submitted_at)} via {pretty(r.channel)}</span>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[#334155]">{Object.entries(r.answers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\n")}</pre>
              {r.triggered_task_ids.length > 0 && <div className="mt-1 text-[#B45309]">Raised task #{r.triggered_task_ids.join(", #")} (see Tasks)</div>}
              {r.review_status !== "reviewed" && (
                <div className="mt-2 flex gap-2">
                  {r.review_status === "pending" && <button className={btnCls.small} onClick={() => review(r, "under_review")}>Start review</button>}
                  <button className={btnCls.small} onClick={() => review(r, "reviewed")}>Mark reviewed</button>
                </div>
              )}
              {r.reviewed_by && <div className="mt-1 text-[10.5px] text-[#94A3B8]">Reviewed by {r.reviewed_by} {fmtDateTime(r.reviewed_at)}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

const isVisible = (q: Row, a: Row) => !q.show_if || String(a[q.show_if.question_id] ?? "").toLowerCase() === String(q.show_if.equals ?? "").toLowerCase()

function RecordResponse() {
  const surveys = useAsync(() => p360.surveys(), [])
  const published = (surveys.data?.surveys || []).filter((s: Row) => s.status === "published")
  const [sid, setSid] = useState("")
  const [patientId, setPatientId] = useState("")
  const [answers, setAnswers] = useState<Row>({})
  const [channel, setChannel] = useState("staff_entry")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const survey = published.find((s: Row) => String(s.id) === sid)
  const set = (id: string, v: any) => setAnswers({ ...answers, [id]: v })

  const submit = async () => {
    setMsg(null)
    const visible = Object.fromEntries(survey.questions.filter((q: Row) => isVisible(q, answers)).map((q: Row) => [q.id, answers[q.id]]))
    try {
      const r = await p360.submitResponse({ patient_id: patientId.trim(), survey_id: survey.id, answers: visible, channel })
      setMsg({ ok: true, text: `Saved response #${r.id}.${r.triggered_task_ids.length ? ` ${r.triggered_task_ids.length} follow-up task(s) raised by the approved escalation rules.` : ""}` })
      setAnswers({})
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }) }
  }

  return (
    <Card title="Record a patient's answers (phone call or desk)">
      <div className="mb-3 grid gap-2 md:grid-cols-3">
        <Field label="Patient ID"><input className={inputCls} value={patientId} onChange={(e) => setPatientId(e.target.value)} /></Field>
        <Field label="Published survey"><select className={inputCls} value={sid} onChange={(e) => { setSid(e.target.value); setAnswers({}) }}><option value="">Choose…</option>{published.map((s: Row) => <option key={s.id} value={s.id}>{s.title} v{s.version} ({s.language})</option>)}</select></Field>
        <Field label="Captured via"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>{["staff_entry", "phone_call", "whatsapp", "sms"].map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select></Field>
      </div>
      {!survey ? <p className="text-[12px] text-[#64748B]">Only published (approved) surveys can be used.</p> : (
        <div className="space-y-3">
          {survey.questions.filter((q: Row) => isVisible(q, answers)).map((q: Row) => (
            <div key={q.id}>
              <div className="mb-1 text-[12px] font-medium">{q.text}{q.required && <span className="text-[#B91C1C]"> *</span>}</div>
              {q.type === "yes_no" && <div className="flex gap-3 text-[12px]">{["yes", "no"].map((v) => <label key={v}><input type="radio" name={q.id} checked={answers[q.id] === v} onChange={() => set(q.id, v)} /> {v}</label>)}</div>}
              {q.type === "single_choice" && <select className={inputCls + " !w-64"} value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)}><option value="">—</option>{q.options.map((o: string) => <option key={o}>{o}</option>)}</select>}
              {q.type === "multiple_choice" && <div className="flex flex-wrap gap-3 text-[12px]">{q.options.map((o: string) => <label key={o}><input type="checkbox" checked={(answers[q.id] || []).includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...(answers[q.id] || []), o] : (answers[q.id] || []).filter((x: string) => x !== o))} /> {o}</label>)}</div>}
              {q.type === "rating" && <input className={inputCls + " !w-24"} type="number" min={q.min} max={q.max} value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} placeholder={`${q.min}–${q.max}`} />}
              {q.type === "free_text" && <textarea className={inputCls} rows={2} maxLength={2000} value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)} />}
            </div>
          ))}
          <button className={btnCls.primary} disabled={!patientId.trim()} onClick={submit}>Save response</button>
        </div>
      )}
      {msg && <div className="mt-3">{msg.ok ? <p className="text-[12px] text-[#15803D]">{msg.text}</p> : <ErrorBox error={msg.text} />}</div>}
    </Card>
  )
}

const blankQ = () => ({ id: "", text: "", type: "yes_no", required: true, options: "", min: 0, max: 10, show_if_q: "", show_if_v: "" })
const blankRule = () => ({ question_id: "", operator: "eq", value: "", priority: "high", team: "care_coordinator", due_hours: 24, title: "Patient-reported concern" })

function Surveys() {
  const { data, error, loading, reload } = useAsync(() => p360.surveys(), [])
  const [editing, setEditing] = useState<Row | null>(null)
  const [msg, setMsg] = useState("")
  const run = async (fn: () => Promise<any>) => { setMsg(""); try { await fn(); reload() } catch (e) { setMsg(errMsg(e)) } }
  const edit = (s: Row) => setEditing({
    id: s.id, title: s.title, survey_key: s.survey_key, language: s.language, purpose: s.purpose || "", version: s.version,
    questions: s.questions.map((q: Row) => ({ ...q, options: (q.options || []).join(", "), show_if_q: q.show_if?.question_id || "", show_if_v: q.show_if?.equals ?? "" })),
    rules: s.escalation_rules.length ? s.escalation_rules.map((r: Row) => ({ ...r, value: Array.isArray(r.value) ? r.value.join(", ") : r.value })) : [],
  })
  return (
    <div className="space-y-3">
      <Card title="Surveys" actions={<button className={btnCls.primary} onClick={() => setEditing({ title: "", survey_key: "", language: "en", purpose: "", questions: [blankQ()], rules: [] })}>+ New survey</button>}>
        <p className="mb-2 text-[11px] text-[#64748B]">Published versions are immutable. Wording and the answer patterns that raise a task must be approved by a clinician other than the author. Offer Telugu/Hindi only with approved translations (create a separate language version).</p>
        {msg && <div className="mb-2"><ErrorBox error={msg} /></div>}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : !data || data.surveys.length === 0 ? <Empty>No surveys yet.</Empty> : (
          <Table head={["Survey", "Language", "Version", "Status", "Questions", "Rules", ""]}>
            {data.surveys.map((s: Row) => (
              <tr key={s.id}>
                <td className="px-2 py-1.5"><b>{s.title}</b><div className="text-[10.5px] text-[#94A3B8]">{s.survey_key}</div></td>
                <td className="px-2 py-1.5">{s.language}</td>
                <td className="px-2 py-1.5">v{s.version}</td>
                <td className="px-2 py-1.5"><Badge status={s.status} />{s.approved_by && <div className="text-[10.5px] text-[#94A3B8]">approved by {s.approved_by}</div>}</td>
                <td className="px-2 py-1.5">{s.questions.length}</td>
                <td className="px-2 py-1.5">{s.escalation_rules.length}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {s.status === "draft" && <button className={btnCls.small} onClick={() => edit(s)}>Edit</button>}
                    {s.status === "draft" && <button className={btnCls.small} onClick={() => run(() => p360.submitSurvey(s.id))}>Submit for approval</button>}
                    {s.status === "pending_approval" && <><button className={btnCls.small} onClick={() => run(() => p360.reviewSurvey(s.id, "approve"))}>Approve</button><button className={btnCls.small} onClick={() => run(() => p360.reviewSurvey(s.id, "reject"))}>Send back</button></>}
                    {s.status === "approved" && <button className={btnCls.primary} onClick={() => run(() => p360.reviewSurvey(s.id, "publish"))}>Publish</button>}
                    {s.status === "published" && <button className={btnCls.small} onClick={() => run(() => p360.reviewSurvey(s.id, "retire"))}>Retire</button>}
                    {s.status !== "draft" && s.status !== "pending_approval" && <button className={btnCls.small} onClick={() => run(() => p360.newSurveyVersion(s.id))}>New version</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <SurveyEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function SurveyEditor({ initial, onClose, onSaved }: { initial: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Row>(initial)
  const [error, setError] = useState("")
  const setQ = (i: number, patch: Row) => setF({ ...f, questions: f.questions.map((q: Row, n: number) => (n === i ? { ...q, ...patch } : q)) })
  const setR = (i: number, patch: Row) => setF({ ...f, rules: f.rules.map((r: Row, n: number) => (n === i ? { ...r, ...patch } : r)) })
  const save = async () => {
    setError("")
    const questions = f.questions.map((q: Row) => ({
      id: q.id, text: q.text, type: q.type, required: !!q.required,
      ...(q.type === "single_choice" || q.type === "multiple_choice" ? { options: String(q.options).split(",").map((s) => s.trim()).filter(Boolean) } : {}),
      ...(q.type === "rating" ? { min: Number(q.min), max: Number(q.max) } : {}),
      ...(q.show_if_q ? { show_if: { question_id: q.show_if_q, equals: q.show_if_v } } : {}),
    }))
    const escalation_rules = f.rules.map((r: Row) => ({ ...r, due_hours: Number(r.due_hours) || 24, value: r.operator === "in" ? String(r.value).split(",").map((s) => s.trim()) : (r.value !== "" && !isNaN(Number(r.value)) && ["lt", "lte", "gt", "gte"].includes(r.operator) ? Number(r.value) : r.value) }))
    try {
      const body = { title: f.title, purpose: f.purpose, language: f.language, survey_key: f.survey_key || String(f.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40), questions, escalation_rules }
      if (f.id) await p360.updateSurvey(f.id, body)
      else await p360.createSurvey(body)
      onSaved()
    } catch (e) { setError(errMsg(e)) }
  }
  return (
    <Card title={f.id ? `Edit draft — ${f.title} v${f.version}` : "New survey"} actions={<button className={btnCls.small} onClick={onClose}>Close</button>}>
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Key" hint="Used by journey checkpoints"><input className={inputCls} value={f.survey_key} disabled={!!f.id} onChange={(e) => setF({ ...f, survey_key: e.target.value.toLowerCase() })} placeholder="post-surgery-day2" /></Field>
        <Field label="Language"><select className={inputCls} value={f.language} disabled={!!f.id} onChange={(e) => setF({ ...f, language: e.target.value })}>{["en", "te", "hi"].map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Purpose"><input className={inputCls} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      </div>
      <h4 className="mb-1 mt-4 text-[12px] font-semibold">Questions</h4>
      <div className="space-y-2">
        {f.questions.map((q: Row, i: number) => (
          <div key={i} className="grid gap-2 rounded border border-[#E2E8F0] p-2 md:grid-cols-6">
            <Field label="ID"><input className={inputCls} value={q.id} onChange={(e) => setQ(i, { id: e.target.value.toLowerCase() })} placeholder="fever" /></Field>
            <div className="md:col-span-2"><Field label="Question"><input className={inputCls} maxLength={300} value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} /></Field></div>
            <Field label="Type"><select className={inputCls} value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}>{["yes_no", "single_choice", "multiple_choice", "rating", "free_text"].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></Field>
            <label className="mt-6 flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required</label>
            <div className="mt-5"><button className={btnCls.danger} disabled={f.questions.length === 1} onClick={() => setF({ ...f, questions: f.questions.filter((_: Row, n: number) => n !== i) })}>Remove</button></div>
            {(q.type === "single_choice" || q.type === "multiple_choice") && <div className="md:col-span-3"><Field label="Options (comma-separated)"><input className={inputCls} value={q.options} onChange={(e) => setQ(i, { options: e.target.value })} /></Field></div>}
            {q.type === "rating" && <><Field label="Min"><input className={inputCls} type="number" value={q.min} onChange={(e) => setQ(i, { min: e.target.value })} /></Field><Field label="Max"><input className={inputCls} type="number" value={q.max} onChange={(e) => setQ(i, { max: e.target.value })} /></Field></>}
            {i > 0 && <><Field label="Show only if question…"><select className={inputCls} value={q.show_if_q} onChange={(e) => setQ(i, { show_if_q: e.target.value })}><option value="">Always shown</option>{f.questions.slice(0, i).filter((p: Row) => p.id).map((p: Row) => <option key={p.id}>{p.id}</option>)}</select></Field>{q.show_if_q && <Field label="…was answered"><input className={inputCls} value={q.show_if_v} onChange={(e) => setQ(i, { show_if_v: e.target.value })} placeholder="yes" /></Field>}</>}
          </div>
        ))}
      </div>
      <button className={btnCls.ghost + " mt-2"} onClick={() => setF({ ...f, questions: [...f.questions, blankQ()] })}>+ Add question</button>

      <h4 className="mb-1 mt-4 text-[12px] font-semibold">Escalation rules (answer pattern → task; approved with the survey)</h4>
      <div className="space-y-2">
        {f.rules.map((r: Row, i: number) => (
          <div key={i} className="grid gap-2 rounded border border-[#E2E8F0] p-2 md:grid-cols-7">
            <Field label="If question"><select className={inputCls} value={r.question_id} onChange={(e) => setR(i, { question_id: e.target.value })}><option value="">—</option>{f.questions.filter((q: Row) => q.id).map((q: Row) => <option key={q.id}>{q.id}</option>)}</select></Field>
            <Field label="Operator"><select className={inputCls} value={r.operator} onChange={(e) => setR(i, { operator: e.target.value })}>{["eq", "ne", "lt", "lte", "gt", "gte", "in", "contains"].map((o) => <option key={o}>{o}</option>)}</select></Field>
            <Field label="Value"><input className={inputCls} value={r.value} onChange={(e) => setR(i, { value: e.target.value })} placeholder={r.operator === "in" ? "a, b" : "yes"} /></Field>
            <Field label="Priority"><select className={inputCls} value={r.priority} onChange={(e) => setR(i, { priority: e.target.value })}>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Team"><input className={inputCls} value={r.team} onChange={(e) => setR(i, { team: e.target.value })} /></Field>
            <Field label="Due in (hours)"><input className={inputCls} type="number" min={1} value={r.due_hours} onChange={(e) => setR(i, { due_hours: e.target.value })} /></Field>
            <div className="mt-5"><button className={btnCls.danger} onClick={() => setF({ ...f, rules: f.rules.filter((_: Row, n: number) => n !== i) })}>Remove</button></div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className={btnCls.ghost} onClick={() => setF({ ...f, rules: [...f.rules, blankRule()] })}>+ Add rule</button>
        <button className={btnCls.primary} onClick={save}>Save draft</button>
      </div>
      <p className="mt-2 text-[10.5px] text-[#94A3B8]">Patients must be told not to wait for a survey reply in an emergency. Put reviewed emergency wording in the first message of the pathway, and do not promise round-the-clock monitoring unless it is staffed.</p>
      {error && <div className="mt-2"><ErrorBox error={error} /></div>}
    </Card>
  )
}
