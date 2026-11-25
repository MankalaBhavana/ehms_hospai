import { useState } from "react"
import { p360, type Row } from "./api"
import { Card, ErrorBox, fmtDateTime, fmtDuration, inputCls, Loading, pretty, Table, useAsync } from "./ui"

const pct = (v: number | null) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`)

/** Operational metrics. Every figure shows numerator, denominator, window and definition (spec 11.4). */
export default function AnalyticsView() {
  const [days, setDays] = useState(30)
  const { data, error, loading, reload } = useAsync(() => p360.analytics(days), [days])
  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-[#64748B]">Refreshed {fmtDateTime(data.refreshed_at)} · all windows and day boundaries in {data.timezone}.</p>
        <select aria-label="Window" className={inputCls + " !w-40"} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {data.metrics.map((m: Row) => (
          <div key={m.key} className="rounded border border-[#DDE2EC] bg-white p-3" title={m.definition}>
            <div className="text-xl font-semibold text-gray-900">{pct(m.value)}</div>
            <div className="text-[11.5px] font-medium text-[#334155]">{m.label}</div>
            <div className="text-[10.5px] text-[#64748B]">{m.numerator} / {m.denominator}</div>
          </div>
        ))}
      </div>
      <Card title="Metric definitions">
        <ul className="space-y-1.5 text-[11.5px] text-[#475569]">{data.metrics.map((m: Row) => <li key={m.key}><b>{m.label}:</b> {m.definition}</li>)}</ul>
        <p className="mt-3 text-[11px] text-[#B45309]">{data.caveat}</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Task acknowledgement time">
          <p className="text-[12px]">Median <b>{fmtDuration(data.task_acknowledgement_seconds.median)}</b> · 90th percentile <b>{fmtDuration(data.task_acknowledgement_seconds.p90)}</b> <span className="text-[#94A3B8]">({data.task_acknowledgement_seconds.tasks} acknowledged tasks)</span></p>
          <p className="mt-1 text-[10.5px] text-[#94A3B8]">{data.task_acknowledgement_seconds.definition}</p>
        </Card>
        <Card title="Tasks by priority">
          {data.task_by_priority.length === 0 ? <p className="text-[12px] text-[#64748B]">No tasks in this window.</p> : (
            <Table head={["Priority", "Created", "Resolved", "Median time to resolve"]}>
              {data.task_by_priority.map((r: Row) => <tr key={r.priority}><td className="px-2 py-1.5">{pretty(r.priority)}</td><td className="px-2 py-1.5">{r.created}</td><td className="px-2 py-1.5">{r.resolved}</td><td className="px-2 py-1.5">{fmtDuration(r.median_resolution_seconds)}</td></tr>)}
            </Table>
          )}
        </Card>
        <Card title="Journeys by state (all time)">
          <Table head={["State", "Journeys"]}>{data.journeys_by_state.map((r: Row) => <tr key={r.state}><td className="px-2 py-1.5">{pretty(r.state)}</td><td className="px-2 py-1.5">{r.n}</td></tr>)}</Table>
        </Card>
        <Card title="Checkpoints by status (all time)">
          <Table head={["Status", "Checkpoints"]}>{data.checkpoints_by_status.map((r: Row) => <tr key={r.status}><td className="px-2 py-1.5">{pretty(r.status)}</td><td className="px-2 py-1.5">{r.n}</td></tr>)}</Table>
        </Card>
      </div>
    </div>
  )
}
