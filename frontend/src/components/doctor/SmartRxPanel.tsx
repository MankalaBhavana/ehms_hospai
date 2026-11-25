import React, { useState } from "react"
import type { SmartRxState } from "../../hooks/useSmartRx"
import {
  OVERRIDE_REASONS,
  describeProvenance,
  explainPartialReason,
  reasonIsValid,
  sortAlerts,
  type Acknowledgements,
  type SmartRxAlert,
} from "../../services/smartrx"

const SEVERITY_STYLE: Record<string, { border: string; bg: string; badge: string; label: string }> = {
  critical: { border: "border-[#FCA5A5]", bg: "bg-[#FEF2F2]", badge: "bg-[#DC2626] text-white", label: "Critical" },
  warning: { border: "border-[#FCD34D]", bg: "bg-[#FFFBEB]", badge: "bg-[#D97706] text-white", label: "Warning" },
  info: { border: "border-[#CBD5E1]", bg: "bg-[#F8FAFC]", badge: "bg-[#64748B] text-white", label: "Note" },
}
const TONE_STYLE = { good: "bg-[#DCFCE7] text-[#166534]", caution: "bg-[#FEF3C7] text-[#92400E]", muted: "bg-[#E2E8F0] text-[#475569]" }

function AckForm({ alert, busy, onAcknowledge }: { alert: SmartRxAlert; busy: boolean; onAcknowledge: (alert: SmartRxAlert, code: string, text: string) => void }) {
  const [code, setCode] = useState("")
  const [text, setText] = useState("")
  const valid = reasonIsValid(code, text)
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2" data-testid="smartrx-ack-form">
      <label className="flex flex-col text-[11px] font-semibold text-[#334155]">
        Reason for proceeding
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-0.5 h-8 min-w-[16rem] border border-[#CBD5E1] bg-white px-2 text-[12px] font-normal"
        >
          <option value="">Choose a reason…</option>
          {OVERRIDE_REASONS.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
      </label>
      {code === "other" && (
        <label className="flex flex-col text-[11px] font-semibold text-[#334155]">
          Describe
          <input
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            className="mt-0.5 h-8 w-64 border border-[#CBD5E1] bg-white px-2 text-[12px] font-normal"
          />
        </label>
      )}
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => onAcknowledge(alert, code, text)}
        className="h-8 px-3 border border-[#B91C1C] bg-white text-[12px] font-semibold text-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
      >
        {busy ? "Saving…" : "Acknowledge"}
      </button>
    </div>
  )
}

function AlertCard({ alert, acks, busyId, onAcknowledge }: { alert: SmartRxAlert; acks: Acknowledgements; busyId?: string | null; onAcknowledge: (a: SmartRxAlert, code: string, text: string) => void }) {
  const style = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info
  const prov = describeProvenance(alert)
  const ack = acks[alert.id]
  const reason = ack ? OVERRIDE_REASONS.find((r) => r.code === ack.reasonCode)?.label || ack.reasonCode : ""
  return (
    <li className={`border ${style.border} ${style.bg} px-3 py-2`} data-testid={`smartrx-alert-${alert.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>{style.label}</span>
        <span className="text-[12.5px] font-bold text-[#0F172A]">{alert.title}</span>
      </div>
      {alert.drug_name && <div className="mt-0.5 text-[11.5px] text-[#475569]">{alert.drug_name}</div>}
      <p className="mt-1 text-[12px] leading-snug text-[#1E293B]">{alert.message}</p>
      {alert.recommendation && <p className="mt-1 text-[12px] leading-snug text-[#334155]"><b>Suggested: </b>{alert.recommendation}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#64748B]">
        <span className={`px-1.5 py-0.5 font-semibold ${TONE_STYLE[prov.tone]}`}>{prov.label}</span>
        {alert.source_ref && <span className="font-semibold text-[#334155]">{alert.source_ref}</span>}
        {alert.source_jurisdiction && <span>{alert.source_jurisdiction} source</span>}
        {alert.source && <span className="truncate max-w-[28rem]" title={alert.source}>{alert.source}</span>}
      </div>
      {alert.severity === "critical" &&
        (ack ? (
          <div className="mt-2 border-t border-[#FECACA] pt-1.5 text-[11.5px] text-[#166534]" data-testid="smartrx-acknowledged">
            ✓ Acknowledged{ack.by ? ` by ${ack.by}` : ""}: {reason}{ack.reasonText ? ` (${ack.reasonText})` : ""}
          </div>
        ) : (
          <AckForm alert={alert} busy={busyId === alert.id} onAcknowledge={onAcknowledge} />
        ))}
    </li>
  )
}

export interface SmartRxPanelProps {
  state: SmartRxState
  acks: Acknowledgements
  onAcknowledge: (alert: SmartRxAlert, reasonCode: string, reasonText: string) => void
  busyAlertId?: string | null
  error?: string | null
  /** True when the prescription on screen has changed since the answer shown. */
  stale?: boolean
}

/**
 * The medication safety check for the prescription sheet. It is decision support: it never says a prescription is "safe",
 * it says what the loaded rules found, what they could not check, and where each alert comes from.
 */
export default function SmartRxPanel({ state, acks, onAcknowledge, busyAlertId, error, stale }: SmartRxPanelProps) {
  const outcome = state.outcome
  const result = outcome && outcome.kind === "ok" ? outcome.result : null
  const alerts = result ? sortAlerts(result.alerts) : []
  const criticals = alerts.filter((a) => a.severity === "critical")
  const warnings = alerts.filter((a) => a.severity === "warning")
  const waiting = criticals.filter((a) => !acks[a.id]).length
  const partial = !!result && result.check_status !== "complete"

  let chip: { text: string; cls: string } = { text: "Waiting for medicines", cls: "bg-[#E2E8F0] text-[#475569]" }
  if (state.status === "loading") chip = { text: "Checking…", cls: "bg-[#DBEAFE] text-[#1E40AF]" }
  else if (outcome?.kind === "unavailable") chip = { text: "Did not run", cls: "bg-[#FEE2E2] text-[#991B1B]" }
  else if (result) {
    if (criticals.length) chip = { text: waiting ? `${waiting} critical to acknowledge` : `${criticals.length} critical, acknowledged`, cls: "bg-[#DC2626] text-white" }
    else if (warnings.length) chip = { text: `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`, cls: "bg-[#D97706] text-white" }
    else if (partial) chip = { text: "Partially checked", cls: "bg-[#FEF3C7] text-[#92400E]" }
    else if (alerts.length) chip = { text: `${alerts.length} note${alerts.length > 1 ? "s" : ""}`, cls: "bg-[#64748B] text-white" }
    else chip = { text: "No alerts", cls: "bg-[#DCFCE7] text-[#166534]" }
  }

  return (
    <section className="border border-[#DDE2EC] bg-white" aria-label="Medication safety check" data-testid="smartrx-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F1F5F9] px-3 py-2">
        <h3 className="text-[12.5px] font-bold text-[#0F172A]">🛡 Medication safety check</h3>
        <span className={`px-2 py-0.5 text-[11px] font-bold ${chip.cls}`} data-testid="smartrx-chip">{chip.text}</span>
      </header>
      <div className="space-y-2 p-3">
        {state.status === "idle" && <p className="text-[12px] text-[#64748B]">Add medicines to the sheet to check allergies, duplicates, interactions, kidney function and doses.</p>}

        {outcome?.kind === "unavailable" && (
          <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#7F1D1D]" role="alert" data-testid="smartrx-unavailable">
            <b>The safety check did not run.</b> {outcome.message} Check allergies, duplicate drugs, interactions, kidney function and doses yourself before sending.
          </div>
        )}

        {error && <div className="border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#7F1D1D]" role="alert">{error}</div>}
        {stale && state.status === "ready" && <p className="text-[11.5px] text-[#92400E]">The prescription changed: updating the check…</p>}

        {result && alerts.length > 0 && (
          <ul className="space-y-2" data-testid="smartrx-alerts">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} acks={acks} busyId={busyAlertId} onAcknowledge={onAcknowledge} />
            ))}
          </ul>
        )}

        {result && alerts.length === 0 && (
          <p className="text-[12px] text-[#334155]">
            No alerts from the rules currently in use. This is decision support, not clinical clearance: it only knows the checks it has been given.
          </p>
        )}

        {result && partial && (
          <div className="border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[11.5px] text-[#78350F]" data-testid="smartrx-partial">
            <b>Not fully checked:</b>{" "}
            {(result.partial_reasons || []).map(explainPartialReason).join("; ") || "some information was missing"}.
          </div>
        )}

        {result && (result.coverage?.rules_not_evaluated || []).length > 0 && (
          <details className="text-[11.5px] text-[#64748B]">
            <summary className="cursor-pointer">Checks that could not be applied ({result.coverage!.rules_not_evaluated!.length})</summary>
            <ul className="mt-1 list-disc pl-5">
              {result.coverage!.rules_not_evaluated!.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </details>
        )}

        {result?.rule_set_version && <p className="text-[10.5px] text-[#94A3B8]">Rule set {result.rule_set_version}{result.engine_version ? ` · engine ${result.engine_version}` : ""}</p>}
      </div>
    </section>
  )
}
