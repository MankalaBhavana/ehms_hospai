import { useState } from "react"
import { p360, type Row } from "./api"
import { Badge, btnCls, Card, Empty, ErrorBox, errMsg, Field, fmtDateTime, fullName, inputCls, Loading, pretty, Table, useAsync } from "./ui"

type Cond = { field: string; op: string; value: string }
const OP_LABEL: Record<string, string> = { eq: "is", ne: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", contains: "contains" }

/** AI query + manual segment builder (spec 9). The model proposes a filter; the server validates it against an allow-list. */
export default function SegmentsView({ onOpenPatient, navigate }: { onOpenPatient: (id: string) => void; navigate: (m: string) => void }) {
  const meta = useAsync(() => p360.meta(), [])
  const saved = useAsync(() => p360.segments(), [])
  const fields: Row = meta.data?.segment_fields || {}

  const [prompt, setPrompt] = useState("")
  const [conds, setConds] = useState<Cond[]>([])
  const [logic, setLogic] = useState<"and" | "or">("and")
  const [ai, setAi] = useState<Row | null>(null)
  const [result, setResult] = useState<Row | null>(null)
  const [recips, setRecips] = useState<Row | null>(null)
  const [channel, setChannel] = useState("whatsapp")
  const [purpose, setPurpose] = useState("clinical_followup")
  const [name, setName] = useState("")
  const [mode, setMode] = useState("dynamic")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  const criteria = () => ({
    logic,
    conditions: conds.map((c) => {
      const f = fields[c.field]
      let value: any = c.value
      if (f?.type === "number") value = Number(c.value)
      if (f?.type === "bool") value = c.value === "true"
      if (c.op === "in") value = String(c.value).split(",").map((s) => s.trim()).filter(Boolean)
      return { field: c.field, op: c.op, value }
    }),
  })

  const guard = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    setError("")
    setNote("")
    try { await fn() } catch (e: any) { setError(errMsg(e)) } finally { setBusy("") }
  }

  const interpret = () => guard("ai", async () => {
    const r = await p360.interpret(prompt)
    setAi(r)
    if (r.criteria) {
      setLogic(r.criteria.logic)
      setConds(r.criteria.conditions.map((c: Row) => ({ field: c.field, op: c.op, value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value) })))
    }
  })
  const evaluate = () => guard("eval", async () => { setRecips(null); setResult(await p360.evaluate(criteria())) })
  const preview = () => guard("recips", async () => setRecips(await p360.recipients(criteria(), channel, purpose)))
  const save = () => guard("save", async () => {
    const s = await p360.saveSegment({ name, mode, criteria: criteria() })
    setNote(`Saved “${s.name}” (v${s.version}${mode === "snapshot" ? `, ${s.member_count ?? 0} members captured` : ""}).`)
    setName("")
    saved.reload()
  })
  const load = (s: Row) => {
    setLogic(s.criteria.logic || "and")
    setConds((s.criteria.conditions || []).filter((c: Row) => !c.conditions).map((c: Row) => ({ field: c.field, op: c.op, value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value) })))
    setResult(null); setRecips(null); setAi(null)
  }

  const addCond = () => { const first = Object.keys(fields)[0]; if (first) setConds([...conds, { field: first, op: fields[first].ops[0], value: fields[first].type === "bool" ? "true" : "" }]) }
  const setCond = (i: number, patch: Partial<Cond>) => setConds(conds.map((c, n) => {
    if (n !== i) return c
    const next = { ...c, ...patch }
    if (patch.field) { const f = fields[patch.field]; next.op = f.ops[0]; next.value = f.type === "bool" ? "true" : f.type === "enum" ? f.values[0] : "" }
    return next
  }))

  return (
    <div className="space-y-4">
      <Card title="Ask in plain language (Keppler AI)">
        <div className="flex gap-2">
          <input aria-label="Natural-language patient query" className={inputCls} placeholder='e.g. "patients discharged in the last 7 days with no active journey"' maxLength={400} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && prompt.trim() && interpret()} />
          <button className={btnCls.primary} disabled={!prompt.trim() || busy === "ai"} onClick={interpret}>{busy === "ai" ? "Interpreting…" : "Interpret"}</button>
        </div>
        {ai && !ai.available && <p className="mt-2 text-[12px] text-[#B45309]">{ai.message}</p>}
        {ai?.available && (
          <div className="mt-2 text-[12px]">
            <p className="text-[#475569]">{ai.message} <Badge tone="amber">AI-proposed · provisional</Badge></p>
            {ai.rejected.length > 0 && <div className="mt-2"><ErrorBox error={`Not used (outside the allowed fields): ${ai.rejected.map((r: Row) => `${r.condition?.field ?? "?"} — ${r.reason}`).join("; ")}. Fix the conditions below before running.`} /></div>}
          </div>
        )}
        <p className="mt-2 text-[10.5px] text-[#94A3B8]">The model only suggests conditions; they are checked against a fixed list of fields and run as parameterised queries. If the AI is offline, build the filter by hand below.</p>
      </Card>

      <Card title="Filter" actions={<div className="flex items-center gap-2 text-[12px]">Match <select aria-label="Combine conditions" className={inputCls + " !w-20"} value={logic} onChange={(e) => setLogic(e.target.value as any)}><option value="and">all</option><option value="or">any</option></select> of:</div>}>
        {meta.error && <ErrorBox error={meta.error} onRetry={meta.reload} />}
        <div className="space-y-2">
          {conds.length === 0 && <p className="text-[12px] text-[#64748B]">No conditions yet.</p>}
          {conds.map((c, i) => {
            const f = fields[c.field]
            return (
              <div key={i} className="grid gap-2 md:grid-cols-[1.4fr_0.8fr_1.2fr_auto]">
                <select aria-label="Field" className={inputCls} value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} title={f?.help}>{Object.entries(fields).map(([k, v]: [string, any]) => <option key={k} value={k}>{v.label}</option>)}</select>
                <select aria-label="Operator" className={inputCls} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>{(f?.ops || []).map((o: string) => <option key={o} value={o}>{OP_LABEL[o] || o}</option>)}</select>
                {f?.type === "bool" ? (
                  <select aria-label="Value" className={inputCls} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="true">yes</option><option value="false">no</option></select>
                ) : f?.type === "enum" && c.op !== "in" ? (
                  <select aria-label="Value" className={inputCls} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>{f.values.map((v: string) => <option key={v}>{v}</option>)}</select>
                ) : (
                  <input aria-label="Value" className={inputCls} type={f?.type === "number" ? "number" : "text"} value={c.value} placeholder={c.op === "in" ? "a, b" : ""} onChange={(e) => setCond(i, { value: e.target.value })} />
                )}
                <button className={btnCls.danger} onClick={() => setConds(conds.filter((_, n) => n !== i))}>Remove</button>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btnCls.ghost} onClick={addCond} disabled={!meta.data}>+ Add condition</button>
          <button className={btnCls.primary} disabled={conds.length === 0 || busy === "eval"} onClick={evaluate}>{busy === "eval" ? "Running…" : "Run filter"}</button>
        </div>
        {error && <div className="mt-3"><ErrorBox error={error} /></div>}
        {note && <p className="mt-3 text-[12px] text-[#15803D]">{note}</p>}
      </Card>

      {result && (
        <Card title={`${result.matched} of ${result.total_in_scope} registered patients match`}>
          <p className="mb-2 text-[11.5px] text-[#475569]">Scope: registered patients of this hospital. Interpreted as {result.logic === "or" ? "ANY" : "ALL"} of: {result.interpreted.map((c: Row) => `${c.label} ${OP_LABEL[c.op] || c.op} ${Array.isArray(c.value) ? c.value.join("/") : String(c.value)}`).join("; ")}.</p>
          {result.patients.length === 0 ? <Empty>No patients match.</Empty> : (
            <Table head={["Patient", "Age / sex", "Phone", "Why it matched"]}>
              {result.patients.map((p: Row) => (
                <tr key={p.patient_id} className="align-top">
                  <td className="px-2 py-1.5"><button className="text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(p.patient_id)}>{p.patient_id}</button><div className="text-[10.5px] text-[#94A3B8]">{fullName(p)}</div></td>
                  <td className="px-2 py-1.5">{p.age ?? "—"} / {p.gender || "—"}</td>
                  <td className="px-2 py-1.5">{p.phone || "—"}</td>
                  <td className="px-2 py-1.5 text-[11px]">{p.match_reasons.map((r: string, i: number) => <div key={i}>• {r}</div>)}</td>
                </tr>
              ))}
            </Table>
          )}
          {result.matched > result.patients.length && <p className="mt-2 text-[10.5px] text-[#94A3B8]">Showing the first {result.patients.length}.</p>}

          <div className="mt-4 rounded border border-[#E2E8F0] p-3">
            <h4 className="mb-2 text-[12px] font-semibold">Prepare outreach</h4>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option>whatsapp</option><option>sms</option></select></Field>
              <Field label="Purpose"><select className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)}>{["clinical_followup", "appointment_reminder", "survey", "marketing"].map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select></Field>
              <button className={btnCls.primary} disabled={busy === "recips"} onClick={preview}>{busy === "recips" ? "Checking…" : "Check who can be contacted"}</button>
            </div>
            {recips && (
              <div className="mt-3 text-[12px]">
                <p><b className="text-[#15803D]">{recips.eligible_count} can be contacted</b> · <b className="text-[#B45309]">{recips.excluded_count} excluded</b>{recips.truncated && " (list capped at 2000)"}. Recomputed now from live consent records.</p>
                {recips.excluded_count > 0 && <p className="mt-1 text-[#475569]">Excluded because: {Object.entries(recips.excluded_by_reason).map(([k, v]) => `${pretty(k)} (${v})`).join(", ")}.</p>}
                {recips.excluded.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-[#1B4FD8]">Show excluded patients</summary><Table head={["Patient", "Reason"]}>{recips.excluded.slice(0, 200).map((e: Row) => <tr key={e.patient_id}><td className="px-2 py-1">{e.patient_id} · {e.name}</td><td className="px-2 py-1">{pretty(e.reason)}</td></tr>)}</Table></details>}
                <p className="mt-2 text-[11px] text-[#64748B]">Sending stays in the existing tools, which re-check opt-outs at send time. Evaluated {fmtDateTime(recips.evaluated_at)}.</p>
                <div className="mt-2 flex gap-2"><button className={btnCls.ghost} onClick={() => navigate("patient_messages")}>Open Patient Messages</button><button className={btnCls.ghost} onClick={() => navigate("nl_filtering")}>Open PatientReach AI (broadcast)</button></div>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Save as segment"><input className={inputCls + " !w-64"} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Recent discharges without a journey" /></Field>
            <Field label="Membership"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}><option value="dynamic">Dynamic (live)</option><option value="snapshot">Point-in-time snapshot</option></select></Field>
            <button className={btnCls.primary} disabled={!name.trim() || busy === "save"} onClick={save}>Save segment</button>
          </div>
          <p className="mt-2 text-[10.5px] text-[#94A3B8]">A segment is a working list, not a diagnosis or a validated risk score.</p>
        </Card>
      )}

      <Card title="Saved segments">
        {saved.loading && !saved.data ? <Loading /> : !saved.data || saved.data.segments.length === 0 ? <Empty>No saved segments.</Empty> : (
          <Table head={["Name", "Version", "Membership", "Owner", "Created", ""]}>
            {saved.data.segments.map((s: Row) => (
              <tr key={s.id}>
                <td className="px-2 py-1.5">{s.name}</td>
                <td className="px-2 py-1.5">v{s.version}</td>
                <td className="px-2 py-1.5">{s.mode === "snapshot" ? `Snapshot (${s.snapshot_count})` : "Dynamic"}</td>
                <td className="px-2 py-1.5">{s.owner || "—"}</td>
                <td className="px-2 py-1.5">{fmtDateTime(s.created_at)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <button className={btnCls.small} onClick={() => load(s)}>Load</button>
                    {s.mode === "snapshot" && <button className={btnCls.small} onClick={() => guard("refresh", async () => { const r = await p360.refreshSegment(s.id); setNote(`Snapshot refreshed: ${r.member_count} members.`); saved.reload() })}>Refresh</button>}
                    <button className={btnCls.danger} onClick={() => guard("archive", async () => { await p360.archiveSegment(s.id); saved.reload() })}>Archive</button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Search an uploaded Excel / PDF file">
        <p className="text-[12px] text-[#475569]">File-scoped search lives in PatientReach AI. Rows from an uploaded file are kept apart from registered patients: they never appear in the registry, segments or journeys above until they are properly registered.</p>
        <button className={btnCls.ghost + " mt-2"} onClick={() => navigate("nl_filtering")}>Open PatientReach AI</button>
      </Card>
    </div>
  )
}
