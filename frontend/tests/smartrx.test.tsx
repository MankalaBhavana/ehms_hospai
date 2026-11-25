import "./shim"
import React from "react"
import { renderToString } from "react-dom/server"
import SmartRxPanel from "../src/components/doctor/SmartRxPanel"
import {
  buildRequest,
  evaluatePrescription,
  explainPartialReason,
  medicationItems,
  reasonIsValid,
  requestSignature,
  sortAlerts,
  unacknowledgedCriticals,
  type SmartRxAlert,
  type SmartRxOutcome,
} from "../src/services/smartrx"

let failed = 0
const results: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + detail))
}

const alert = (over: Partial<SmartRxAlert> = {}): SmartRxAlert => ({
  id: "a1", check: "allergy", drug_name: "Augmentin 625", severity: "critical", title: "Critical Allergy Conflict: Penicillins",
  message: "Patient has a documented penicillin allergy.", recommendation: "Choose a different class.", is_blocking: false, ...over,
})
const ok = (alerts: SmartRxAlert[], extra: Record<string, unknown> = {}): SmartRxOutcome => ({
  kind: "ok", result: { status: "ok", check_status: "complete", partial_reasons: [], alerts, rule_set_version: "2026.11.24-abc", engine_version: "1.1.0", ...extra },
})
// React's server renderer separates adjacent text pieces with <!-- --> markers; they are invisible in a browser, so strip them
const render = (state: any, acks: any = {}, props: any = {}) =>
  renderToString(<SmartRxPanel state={state} acks={acks} onAcknowledge={() => {}} {...props} />).replace(/<!-- -->/g, "")

async function main() {
  // ── what is sent to the server ────────────────────────────────────────────
  const meds = [
    { name: " Augmentin 625 ", strength: "625mg", dosage: "1 tab", frequency: "BD", route: "", duration: "5 days" },
    { name: "   ", strength: "10mg" },
    { name: "Metformin", frequency: "OD" },
  ]
  const items = medicationItems(meds)
  check("blank medicine lines are never sent", items.length === 2)
  check("medicine names are trimmed and empty fields omitted", items[0].medicine === "Augmentin 625" && !("route" in items[0]) && items[0].duration === "5 days")
  check("at most 60 lines are sent", medicationItems(Array.from({ length: 80 }, (_, i) => ({ name: "Drug " + i }))).length === 60)
  const patient = { patientId: "UMR-1", encounterId: "ENC-9", age: 64, sex: "Male" }
  const req = buildRequest(patient, meds) as any
  check("the request carries patient, encounter, age and sex", req.patient_id === "UMR-1" && req.encounter_id === "ENC-9" && req.patient_age === "64" && req.patient_sex === "Male")
  check("the signature changes when a dose changes, and only then",
    requestSignature(patient, meds) === requestSignature(patient, [...meds]) &&
      requestSignature(patient, meds) !== requestSignature(patient, [{ ...meds[0], dosage: "2 tab" }, meds[1], meds[2]]))

  // ── never a made-up answer ───────────────────────────────────────────────
  const outcome = await evaluatePrescription(patient, meds)
  check("an unreachable server is reported as 'unavailable', never as 'no alerts'", outcome.kind === "unavailable" && !!outcome.message, JSON.stringify(outcome))

  // ── acknowledgement rules ────────────────────────────────────────────────
  const a2 = alert({ id: "a2", severity: "warning" })
  const a3 = alert({ id: "a3", severity: "critical", check: "renal" })
  const out = ok([a2, alert(), a3])
  check("only critical alerts need acknowledging", unacknowledgedCriticals(out, {}).map((a) => a.id).join() === "a1,a3")
  check("an acknowledged critical alert no longer blocks", unacknowledgedCriticals(out, { a1: { reasonCode: "no_alternative", at: "t" } }).map((a) => a.id).join() === "a3")
  check("an unavailable check never blocks sending", unacknowledgedCriticals({ kind: "unavailable", message: "x" }, {}).length === 0 && unacknowledgedCriticals(undefined, {}).length === 0)
  check("alerts are listed critical first", sortAlerts([a2, alert({ id: "i", severity: "info" }), alert()]).map((a) => a.severity).join() === "critical,warning,info")
  check("a reason is required, and 'other' needs words", !reasonIsValid("", "") && reasonIsValid("no_alternative", "") && !reasonIsValid("other", "no") && reasonIsValid("other", "nephrology agrees"))
  check("reason codes are explained in plain words",
    /kidney function/.test(explainPartialReason("renal_function_unknown:Metformin")) && /could not be calculated/.test(explainPartialReason("egfr_not_computed:sex_missing")))

  // ── what the doctor sees ─────────────────────────────────────────────────
  const idle = render({ status: "idle" })
  check("idle: asks for medicines", /Add medicines to the sheet/.test(idle) && /Waiting for medicines/.test(idle))
  check("loading is shown", /Checking…/.test(render({ status: "loading" })))

  const down = render({ status: "ready", outcome: { kind: "unavailable", message: "Server down." } })
  check("unavailable: says the check did NOT run and tells the doctor to check manually",
    /did not run/.test(down) && /yourself before sending/.test(down) && !/No alerts/.test(down))

  const clean = render({ status: "ready", outcome: ok([]) })
  check("no alerts is not presented as clearance", /No alerts/.test(clean) && /not clinical clearance/.test(clean))

  const partial = render({ status: "ready", outcome: ok([], { check_status: "partial", partial_reasons: ["renal_function_unknown:Metformin"] }) })
  check("partial check says what could not be checked, instead of 'No alerts'", /Partially checked/.test(partial) && /Not fully checked/.test(partial) && /kidney function/.test(partial) && !/>No alerts</.test(partial))

  const critical = render({ status: "ready", outcome: ok([alert({ provenance: "verified", source_ref: "SRC_073, p.25", source_jurisdiction: "India" })]) })
  check("a critical alert shows its source, page and jurisdiction", /Guideline-verified/.test(critical) && /SRC_073, p\.25/.test(critical) && /India source/.test(critical))
  check("an unacknowledged critical alert asks for a reason and counts as waiting", /smartrx-ack-form/.test(critical) && /1 critical to acknowledge/.test(critical) && /Acknowledge/.test(critical))

  const acked = render({ status: "ready", outcome: ok([alert()]) }, { a1: { reasonCode: "benefit_outweighs_risk", at: "t", by: "Dr Rao" } })
  check("an acknowledged alert shows who acknowledged it and why, with no form", /Acknowledged by Dr Rao/.test(acked) && /Benefit outweighs the risk/.test(acked) && !/smartrx-ack-form/.test(acked) && /acknowledged/.test(acked))

  const draft = render({ status: "ready", outcome: ok([alert({ severity: "warning", knowledge_status: "draft" })]) })
  check("a draft rule is labelled as under review", /Draft rule, under review/.test(draft))
  const cited = render({ status: "ready", outcome: ok([alert({ severity: "warning", provenance: "cited" })]) })
  check("a cited-but-unverified rule is labelled as such", /Cited, not yet verified/.test(cited))
  check("warning-only prescriptions need no acknowledgement form", !/smartrx-ack-form/.test(cited))

  const hostile = render({ status: "ready", outcome: ok([alert({ message: "<img src=x onerror=alert(1)>", title: "<script>alert(1)</script>" })]) })
  check("alert text is escaped, never injected as HTML", !/<script>alert/.test(hostile) && !/<img src=x/.test(hostile) && /&lt;script&gt;/.test(hostile))
  check("a change since the answer was computed is announced", /The prescription changed/.test(render({ status: "ready", outcome: ok([]) }, {}, { stale: true })))
  check("an audit-save failure is shown", /could not be saved/.test(render({ status: "ready", outcome: ok([alert()]) }, {}, { error: "The acknowledgement could not be saved (x)." })))

  console.log(results.join("\n"))
  console.log(failed ? `${failed} FAILED` : "ALL SMARTRX CHECKS PASSED")
  process.exit(failed ? 1 : 0)
}

main()
