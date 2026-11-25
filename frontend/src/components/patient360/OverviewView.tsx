import { useState } from "react"
import { p360 } from "./api"
import { Badge, btnCls, Card, ErrorBox, errMsg, fmtDateTime, Loading, Stat, Table, useAsync } from "./ui"

export default function OverviewView({ go, onOpenPatient }: { go: (tab: string) => void; onOpenPatient: (id: string) => void }) {
  const { data, error, loading, reload } = useAsync(() => p360.overview(), [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  const runDue = async () => {
    setBusy(true)
    setMsg("")
    try {
      const r = await p360.runDue()
      setMsg(`Checked ${r.examined} due checkpoint(s): ${r.queued} queued as tasks, ${r.skipped} blocked (no valid contact/consent), ${r.deferred} deferred to the contact window.`)
      reload()
    } catch (e) {
      setMsg(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null
  const d = data

  return (
    <div className="space-y-4">
      {error && <ErrorBox error={error} onRetry={reload} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Active journeys" value={d.active_journeys} onClick={() => go("journeys")} />
        <Stat label="Paused journeys" value={d.paused_journeys} tone={d.paused_journeys ? "amber" : undefined} onClick={() => go("journeys")} />
        <Stat label="Journeys needing review" value={d.journeys_needing_review} tone={d.journeys_needing_review ? "red" : undefined} onClick={() => go("journeys")} />
        <Stat label="Discharges awaiting a pathway" value={d.enrollments_awaiting_template} tone={d.enrollments_awaiting_template ? "amber" : undefined} hint="Finalized discharges that no published template matched" onClick={() => go("journeys")} />
        <Stat label="Held for review (overlap)" value={d.enrollments_pending_review} tone={d.enrollments_pending_review ? "amber" : undefined} onClick={() => go("journeys")} />
        <Stat label="Templates awaiting approval" value={d.templates_awaiting_approval} tone={d.templates_awaiting_approval ? "amber" : undefined} onClick={() => go("journeys")} />
        <Stat label="Checkpoints due now" value={d.checkpoints_due_now} tone={d.checkpoints_due_now ? "amber" : undefined} />
        <Stat label="Checkpoints overdue" value={d.checkpoints_overdue} tone={d.checkpoints_overdue ? "red" : undefined} />
        <Stat label="Surveys awaiting approval" value={d.surveys_awaiting_approval} tone={d.surveys_awaiting_approval ? "amber" : undefined} onClick={() => go("surveys")} />
        <Stat label="Responses awaiting review" value={d.responses_awaiting_review} tone={d.responses_awaiting_review ? "amber" : undefined} onClick={() => go("surveys")} />
        <Stat label="Open tasks" value={d.open_tasks} onClick={() => go("tasks")} />
        <Stat label="Overdue tasks" value={d.overdue_tasks} tone={d.overdue_tasks ? "red" : undefined} onClick={() => go("tasks")} />
        <Stat label="Concerns awaiting acknowledgement" value={d.concerns_awaiting_acknowledgement} tone={d.concerns_awaiting_acknowledgement ? "red" : undefined} onClick={() => go("tasks")} />
        <Stat label="Message failures (7 days)" value={d.communication_failures_7d} tone={d.communication_failures_7d ? "red" : undefined} />
      </div>

      <Card
        title="Journey checkpoints"
        actions={<button className={btnCls.primary} onClick={runDue} disabled={busy}>{busy ? "Checking…" : "Process due checkpoints"}</button>}
      >
        <p className="text-[12px] text-[#475569]">
          Due checkpoints become accountable tasks. Nothing is sent automatically: for a message or survey the send-time consent check is recorded and a task is queued for the
          coordinator to send through Patient Messages.
        </p>
        {msg && <p className="mt-2 text-[12px] text-[#1D4ED8]">{msg}</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Work queue (most urgent first)">
          {d.recent_tasks.length === 0 ? (
            <p className="text-[12px] text-[#64748B]">No open tasks.</p>
          ) : (
            <Table head={["Patient", "Task", "Priority", "Status", "Due"]}>
              {d.recent_tasks.map((t: any) => (
                <tr key={t.id}>
                  <td className="px-2 py-1.5"><button className="text-[#1B4FD8] hover:underline" onClick={() => onOpenPatient(t.patient_id)}>{t.patient_id}</button></td>
                  <td className="px-2 py-1.5">{t.title}</td>
                  <td className="px-2 py-1.5"><Badge status={t.priority} /></td>
                  <td className="px-2 py-1.5"><Badge status={t.status} /></td>
                  <td className="px-2 py-1.5">{fmtDateTime(t.due_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Staff workload">
          {d.workload.length === 0 ? (
            <p className="text-[12px] text-[#64748B]">Nothing assigned.</p>
          ) : (
            <Table head={["Owner / team", "Open", "Overdue"]}>
              {d.workload.map((w: any) => (
                <tr key={w.owner}>
                  <td className="px-2 py-1.5">{w.owner}</td>
                  <td className="px-2 py-1.5">{w.open_tasks}</td>
                  <td className="px-2 py-1.5">{Number(w.overdue) > 0 ? <Badge status="overdue">{w.overdue}</Badge> : 0}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <p className="text-[10.5px] text-[#94A3B8]">Refreshed {fmtDateTime(d.generated_at)}. Figures are counted live from the coordination tables.</p>
    </div>
  )
}
