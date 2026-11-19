import { useEffect, useMemo, useRef, useState } from "react"
import { InsuranceEngineService as E } from "../../services/insuranceDb"
import { db } from "../../services/db"
import type { ComprehensiveClaimRecord, PatientPolicy } from "../../types/insurance"
import { POLICY_COLUMNS, checkImport, policyKey, toCsv, type ImportRow } from "../../utils/policyCsv"
import EligibilityPanel from "./EligibilityPanel"
import { PolicyForm } from "./forms"
import { openInsurance } from "./integrations"
import { EncounterCase } from "./NewCaseModal"
import { Drawer, Empty, Field, KV, Modal, PageHeader, StatusPill, Tag, attempt, btn, daysUntil, fieldBase, fieldCls, fmtDate, fmtDateTime, inr, useCases, useNotify } from "./ui"

/**
 * Patient Insurance: every insured patient and policy in one list, like the Reception registry.
 * One row per policy. Find a patient, open the row to see the policy, check eligibility, edit it or start an
 * insurance case. Import a list from Excel (CSV) or export what you see.
 */

type Validity = "valid" | "soon" | "expired" | "inactive" | "unknown"
type Filter = "all" | "valid" | "soon" | "expired" | "unverified" | "treatment"
const PAGE = 25
const SOON_DAYS = 30
const ACTIVE_CASE = new Set(["TREATMENT_IN_PROGRESS", "DISCHARGE_INITIATED", "PREAUTH_SUBMITTED", "PREAUTH_UNDER_REVIEW", "PREAUTH_QUERY", "PREAUTH_APPROVED", "PREAUTH_DRAFT", "ELIGIBLE", "ELIGIBILITY_PENDING", "DRAFT", "FINAL_BILL_READY", "CLAIM_SUBMITTED", "CLAIM_QUERY_RAISED"])

const validityOf = (p: PatientPolicy): Validity => {
  if (p.status === "Inactive") return "inactive"
  if (!p.validUntil || Number.isNaN(new Date(p.validUntil).getTime())) return "unknown"
  const d = daysUntil(p.validUntil)
  return d < 0 ? "expired" : d <= SOON_DAYS ? "soon" : "valid"
}

/** An ER quick capture holds stand-in text until the insurance desk completes the real policy details. */
const isPlaceholder = (p: PatientPolicy) => /^pending/i.test(p.policyNumber.trim()) || /^pending/i.test(p.insurerName.trim())

const VALIDITY_TAG: Record<Validity, { tone: "emerald" | "amber" | "rose" | "slate"; text: string }> = {
  valid: { tone: "emerald", text: "Valid" },
  soon: { tone: "amber", text: "Expiring soon" },
  expired: { tone: "rose", text: "Expired" },
  inactive: { tone: "slate", text: "Inactive" },
  unknown: { tone: "slate", text: "No end date" },
}

interface Row {
  p: PatientPolicy
  key: string
  validity: Validity
  patient?: { name: string; age?: number | string; sex?: string; phone?: string }
  cases: ComprehensiveClaimRecord[]
  liveCase?: ComprehensiveClaimRecord
}

const download = (name: string, text: string) => {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const sameDay = () => new Date().toISOString().slice(0, 10)

export default function PatientPoliciesPage() {
  const { notify, toastNode } = useNotify()
  const cases = useCases()
  const [policies, setPolicies] = useState<PatientPolicy[]>(() => E.getAllPatientPolicies())
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState("")
  const [insurer, setInsurer] = useState("All")
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [edit, setEdit] = useState<PatientPolicy | null>(null)
  const [verify, setVerify] = useState<PatientPolicy | null>(null)
  const [startCase, setStartCase] = useState<PatientPolicy | null>(null)
  const [importing, setImporting] = useState(false)
  const canWrite = E.can("insurance.create")

  useEffect(() => {
    const load = () => setPolicies(E.getAllPatientPolicies())
    load()
    const off = E.subscribe(load)
    const off2 = db.subscribe(() => setTick((n) => n + 1))
    return () => {
      off()
      off2?.()
    }
  }, [])

  const rows: Row[] = useMemo(() => {
    const byPatient = new Map<string, ComprehensiveClaimRecord[]>()
    cases.forEach((c) => {
      const k = (c.patientId || c.mrn || "").toUpperCase()
      byPatient.set(k, [...(byPatient.get(k) || []), c])
    })
    return policies.map((p) => {
      const mine = (byPatient.get(p.patientId.toUpperCase()) || []).filter((c) => c.policy.policyNumber.trim().toLowerCase() === p.policyNumber.trim().toLowerCase())
      mine.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      const reg = db.getPatientByUmr(p.patientId)
      return {
        p,
        key: policyKey(p.patientId, p.policyNumber),
        validity: validityOf(p),
        patient: reg ? { name: reg.name, age: reg.age, sex: reg.sex, phone: reg.phone } : mine[0] ? { name: mine[0].patientName, age: mine[0].age, sex: mine[0].gender, phone: mine[0].phone } : undefined,
        cases: mine,
        liveCase: mine.find((c) => ACTIVE_CASE.has(c.status)),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies, cases, tick])

  const insurers = useMemo(() => [...new Set(rows.map((r) => r.p.insurerName).filter(Boolean))].sort(), [rows])
  const verified = (r: Row) => !!r.p.lastVerification

  const totals = useMemo(
    () => ({
      patients: new Set(rows.map((r) => r.p.patientId.toUpperCase())).size,
      policies: rows.length,
      soon: rows.filter((r) => r.validity === "soon").length,
      expired: rows.filter((r) => r.validity === "expired").length,
      unverified: rows.filter((r) => !verified(r)).length,
      treatment: rows.filter((r) => r.liveCase).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (t) {
          const hay = [r.p.patientName, r.patient?.name, r.p.patientId, r.patient?.phone, r.p.insurerName, r.p.tpaName, r.p.policyNumber, r.p.memberId, r.p.policyHolderName].filter(Boolean).join(" ").toLowerCase()
          if (!hay.includes(t)) return false
        }
        if (insurer !== "All" && r.p.insurerName !== insurer) return false
        if (filter === "valid" && r.validity !== "valid" && r.validity !== "soon") return false
        if (filter === "soon" && r.validity !== "soon") return false
        if (filter === "expired" && r.validity !== "expired") return false
        if (filter === "unverified" && verified(r)) return false
        if (filter === "treatment" && !r.liveCase) return false
        return true
      })
      .sort((a, b) => (a.patient?.name || a.p.patientName).localeCompare(b.patient?.name || b.p.patientName))
  }, [rows, q, insurer, filter])

  useEffect(() => setPage(0), [q, insurer, filter])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const open = rows.find((r) => r.key === openKey) || null

  const exportCsv = () => {
    const lines = filtered.map((r) => [
      r.p.patientId,
      r.patient?.name || r.p.patientName,
      r.p.insurerName,
      r.p.tpaName || "",
      r.p.policyNumber,
      r.p.memberId,
      r.p.policyHolderName,
      r.p.relationship,
      r.p.validUntil ? String(r.p.validUntil).slice(0, 10) : "",
      r.p.sumInsured || "",
      r.p.balanceAvailable || "",
      r.p.copayPercentage || "",
      r.p.roomRentPerDay || "",
      r.p.icuRentPerDay || "",
      VALIDITY_TAG[r.validity].text,
      r.p.lastVerification ? `${r.p.lastVerification.status} (${String(r.p.lastVerification.at).slice(0, 10)})` : "Not verified",
      r.cases.length,
    ])
    download(`patient-insurance-${sameDay()}.csv`, toCsv([...POLICY_COLUMNS, "Validity", "Last eligibility check", "Insurance cases"], lines))
    notify(`${lines.length} polic${lines.length === 1 ? "y" : "ies"} exported.`)
  }

  const tile = (label: string, value: number, f: Filter | null, sub: string, tone = "text-slate-900") => (
    <button
      type="button"
      onClick={() => f && setFilter(f)}
      className={`text-left min-w-0 bg-white border rounded-none p-3.5 transition-colors ${f && filter === f ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200 hover:border-slate-300"} ${f ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="text-[11.5px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums leading-tight mt-1 ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-slate-400 mt-0.5 truncate">{sub}</div>
    </button>
  )

  const chip = (f: Filter, label: string) => (
    <button
      key={f}
      type="button"
      onClick={() => setFilter(f)}
      className={`h-8 px-3 text-[12.5px] font-semibold border cursor-pointer transition-colors ${filter === f ? "bg-teal-700 border-teal-700 text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {toastNode}
      <PageHeader
        title="Patient Insurance"
        subtitle="Every insured patient and policy in one list. Open a row to check eligibility or start an insurance case."
        actions={
          <>
            <button type="button" className={btn.plain} onClick={() => setImporting(true)} disabled={!canWrite} title={canWrite ? "Add many policies from an Excel / CSV file" : "Your role cannot add policies"}>
              Import
            </button>
            <button type="button" className={btn.plain} onClick={exportCsv} disabled={!filtered.length}>
              Export ({filtered.length})
            </button>
            <button type="button" className={btn.primary} onClick={() => setEdit({ id: "", patientId: "", patientName: "", insurerId: "", insurerName: "", policyNumber: "", memberId: "", policyHolderName: "", relationship: "Self", validUntil: "", sumInsured: 0, balanceAvailable: 0, copayPercentage: 0, status: "Active", createdAt: "" })} disabled={!canWrite} title={canWrite ? "" : "Your role cannot add policies"}>
              + Add policy
            </button>
          </>
        }
      />

      <div className="p-6 space-y-4 max-w-[1500px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {tile("Insured patients", totals.patients, "all", "with at least one policy")}
          {tile("Policies", totals.policies, "all", "on record")}
          {tile("In treatment", totals.treatment, "treatment", "have an open insurance case")}
          {tile("Expiring soon", totals.soon, "soon", `within ${SOON_DAYS} days`, totals.soon ? "text-amber-700" : undefined)}
          {tile("Expired", totals.expired, "expired", "renew before the next admission", totals.expired ? "text-rose-700" : undefined)}
          {tile("Not verified", totals.unverified, "unverified", "eligibility never checked", totals.unverified ? "text-amber-700" : undefined)}
        </div>

        <div className="bg-white border border-slate-200 rounded-none p-3 flex flex-wrap items-center gap-3">
          <input className={`${fieldBase} flex-1 min-w-[240px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient, UMR, phone, insurer, policy or member number" aria-label="Search" />
          <select className={`${fieldBase} w-[210px]`} value={insurer} onChange={(e) => setInsurer(e.target.value)} aria-label="Insurance company">
            <option value="All">All insurance companies</option>
            {insurers.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <div className="flex">
            {chip("all", "All")}
            {chip("valid", "Valid")}
            {chip("soon", "Expiring")}
            {chip("expired", "Expired")}
            {chip("unverified", "Not verified")}
          </div>
          {(q || insurer !== "All" || filter !== "all") && (
            <button
              type="button"
              className={btn.link}
              onClick={() => {
                setQ("")
                setInsurer("All")
                setFilter("all")
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-none overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed text-[13px]">
            <colgroup>
              <col style={{ width: "21%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Insurance</th>
                <th className="px-4 py-2.5">Policy / Member</th>
                <th className="px-4 py-2.5">Valid until</th>
                <th className="px-4 py-2.5 text-right">Balance / Sum insured</th>
                <th className="px-4 py-2.5">Eligibility</th>
                <th className="px-4 py-2.5">Insurance case</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const v = VALIDITY_TAG[r.validity]
                const ver = r.p.lastVerification
                return (
                  <tr key={r.key} onClick={() => setOpenKey(r.key)} className="border-b border-slate-100 last:border-0 hover:bg-teal-50/40 cursor-pointer align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 truncate">{r.patient?.name || r.p.patientName}</div>
                      <div className="text-[12px] text-slate-500 truncate">
                        <span className="tabular-nums">{r.p.patientId}</span>
                        {r.patient?.age ? ` · ${r.patient.age} yrs` : ""}
                        {r.patient?.sex ? ` · ${r.patient.sex}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-900 truncate">{r.p.insurerName}</div>
                      <div className="text-[12px] text-slate-500 truncate">{r.p.tpaName || "Direct"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="tabular-nums text-slate-900 truncate">{r.p.policyNumber}</div>
                      <div className="text-[12px] text-slate-500 tabular-nums truncate">{r.p.memberId || "No member ID"}</div>
                      {isPlaceholder(r.p) && (
                        <div className="mt-0.5">
                          <Tag tone="amber">Details pending</Tag>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="tabular-nums text-slate-900">{r.p.validUntil ? fmtDate(r.p.validUntil) : "—"}</div>
                      <div className="mt-0.5">
                        <Tag tone={v.tone}>{v.text}</Tag>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="text-slate-900">{r.p.sumInsured ? inr(r.p.balanceAvailable) : "—"}</div>
                      <div className="text-[12px] text-slate-500">{r.p.sumInsured ? `of ${inr(r.p.sumInsured)}` : "not recorded"}</div>
                    </td>
                    <td className="px-4 py-3">
                      {ver ? (
                        <>
                          <Tag tone={ver.status === "Eligible" ? "emerald" : ver.status === "Not Eligible" ? "rose" : "amber"}>{ver.status}</Tag>
                          <div className="text-[12px] text-slate-500 mt-0.5">{fmtDateTime(ver.at)}</div>
                        </>
                      ) : (
                        <Tag tone="amber">Not verified</Tag>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.liveCase ? (
                        <>
                          <StatusPill status={r.liveCase.status} />
                          <div className="text-[12px] text-slate-500 mt-0.5 tabular-nums">{r.liveCase.id}</div>
                        </>
                      ) : r.cases.length ? (
                        <span className="text-[12.5px] text-slate-500">{r.cases.length} past case{r.cases.length > 1 ? "s" : ""}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <Empty
              title={rows.length === 0 ? "No insurance policies yet" : "No policy matches these filters"}
              hint={rows.length === 0 ? "Use + Add policy for one patient, or Import to load a list from Excel." : "Change the search or clear the filters."}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-[12.5px] text-slate-500">
          <span>
            Showing {filtered.length === 0 ? 0 : page * PAGE + 1}–{Math.min(filtered.length, page * PAGE + PAGE)} of {filtered.length}
            {filtered.length !== rows.length && ` (filtered from ${rows.length})`}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" className={`${btn.plain} h-8 px-3`} disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              Previous
            </button>
            <span className="tabular-nums">
              Page {page + 1} of {pages}
            </span>
            <button type="button" className={`${btn.plain} h-8 px-3`} disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>
              Next
            </button>
          </span>
        </div>
      </div>

      {open && !edit && !verify && !startCase && (
        <PolicyDrawer
          r={open}
          canWrite={canWrite}
          onClose={() => setOpenKey(null)}
          onVerify={() => setVerify(open.p)}
          onEdit={() => setEdit(open.p)}
          onStart={() => setStartCase(open.p)}
          onRemove={() => {
            if (!window.confirm(`Remove policy ${open.p.policyNumber} from ${open.patient?.name || open.p.patientName}'s record?`)) return
            if (attempt(notify, () => E.removePatientPolicy(open.p.id), "Policy removed from the record.")) setOpenKey(null)
          }}
        />
      )}
      {verify && <EligibilityPanel target={{ kind: "policy", p: verify }} notify={notify} onClose={() => setVerify(null)} />}
      {startCase && (
        <Modal wide title="Start an insurance case" onClose={() => setStartCase(null)}>
          <EncounterCase
            notify={notify}
            initial={{ patientId: startCase.patientId, patientName: startCase.patientName }}
            onOpened={(id) => {
              setStartCase(null)
              openInsurance("insurance_preauth", id)
            }}
          />
        </Modal>
      )}
      {edit && (
        <PolicyEditor
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={(saved) => {
            setEdit(null)
            setOpenKey(policyKey(saved.patientId, saved.policyNumber))
            notify("Policy saved to the patient record.")
          }}
          onError={(m) => notify(m, "error")}
        />
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          existing={new Set(policies.filter((p) => !p.id.startsWith("POL-CLM")).map((p) => policyKey(p.patientId, p.policyNumber)))}
          onDone={(msg) => {
            setImporting(false)
            notify(msg)
          }}
          onError={(m) => notify(m, "error")}
        />
      )}
    </div>
  )
}

// ── details drawer ───────────────────────────────────────────────────────────

function PolicyDrawer({ r, canWrite, onClose, onVerify, onEdit, onStart, onRemove }: { r: Row; canWrite: boolean; onClose: () => void; onVerify: () => void; onEdit: () => void; onStart: () => void; onRemove: () => void }) {
  const p = r.p
  const v = VALIDITY_TAG[r.validity]
  const fromCase = p.id.startsWith("POL-CLM")
  const ver = p.lastVerification
  const h = "text-[11.5px] font-semibold uppercase tracking-wider text-slate-500 mb-1"
  return (
    <Drawer
      title={r.patient?.name || p.patientName}
      subtitle={`${p.patientId}${r.patient?.age ? ` · ${r.patient.age} yrs` : ""}${r.patient?.sex ? ` · ${r.patient.sex}` : ""}${r.patient?.phone ? ` · ${r.patient.phone}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {!fromCase && canWrite && (
            <button type="button" className={btn.danger} onClick={onRemove}>
              Remove
            </button>
          )}
          {!fromCase && canWrite && (
            <button type="button" className={btn.plain} onClick={onEdit}>
              Edit
            </button>
          )}
          <button type="button" className={btn.plain} onClick={onVerify} disabled={!E.can("insurance.verify")}>
            Check eligibility
          </button>
          <button type="button" className={btn.primary} onClick={onStart} disabled={!canWrite || r.validity === "expired"} title={r.validity === "expired" ? "This policy has expired" : ""}>
            Start insurance case
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <div className={h}>Policy</div>
          <div className="divide-y divide-slate-100">
            <KV k="Insurance company" v={p.insurerName} />
            <KV k="TPA" v={p.tpaName || "Direct"} />
            <KV k="Policy number" v={p.policyNumber} mono />
            <KV k="Member ID" v={p.memberId || "—"} mono />
            <KV k="Policy holder" v={`${p.policyHolderName || p.patientName} (${p.relationship})`} />
            <KV k="Valid until" v={<span className="inline-flex items-center gap-2">{p.validUntil ? fmtDate(p.validUntil) : "—"} <Tag tone={v.tone}>{v.text}</Tag></span>} />
            <KV k="Sum insured" v={p.sumInsured ? inr(p.sumInsured) : "—"} mono />
            <KV k="Balance available" v={p.sumInsured ? inr(p.balanceAvailable) : "—"} mono />
            <KV k="Bed rent limit per day" v={p.roomRentPerDay ? inr(p.roomRentPerDay) : "No cap recorded"} mono />
            <KV k="ICU rent limit per day" v={p.icuRentPerDay ? inr(p.icuRentPerDay) : "No cap recorded"} mono />
            <KV k="Co-pay" v={p.copayPercentage ? `${p.copayPercentage}%` : "None"} mono />
          </div>
        </section>

        <section>
          <div className={h}>Eligibility</div>
          {ver ? (
            <div className="divide-y divide-slate-100">
              <KV k="Result" v={<Tag tone={ver.status === "Eligible" ? "emerald" : ver.status === "Not Eligible" ? "rose" : "amber"}>{ver.status}</Tag>} />
              <KV k="Checked" v={`${fmtDateTime(ver.at)} by ${ver.by || "—"}`} />
              <KV k="Network hospital" v={ver.inNetwork ? "Yes" : "No"} />
            </div>
          ) : (
            <p className="text-[13px] text-slate-500">Eligibility has not been checked for this policy. Use “Check eligibility” before the admission.</p>
          )}
        </section>

        <section>
          <div className={h}>Insurance cases ({r.cases.length})</div>
          {r.cases.length === 0 ? (
            <p className="text-[13px] text-slate-500">No insurance case has been opened on this policy yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200">
              {r.cases.map((c) => (
                <li key={c.id} className="px-3 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-900 tabular-nums">
                      {c.id} <span className="font-normal text-slate-500">· {c.encounterType}</span>
                    </div>
                    <div className="text-[12px] text-slate-500 truncate">
                      {c.department}
                      {c.admissionDate ? ` · admitted ${fmtDate(c.admissionDate)}` : ""}
                    </div>
                  </div>
                  <StatusPill status={c.status} />
                  <button type="button" className={btn.link} onClick={() => openInsurance("insurance_claims", c.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isPlaceholder(p) && <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2">The insurance details were captured quickly (for example in ER) and are not complete yet. Open Intake &amp; Eligibility to enter the real policy number and insurer.</p>}
        {fromCase && <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2">This policy was captured on an insurance case. To change it, edit the case; or add it here as a policy on the patient record.</p>}
      </div>
    </Drawer>
  )
}

// ── add / edit one policy (pick the patient first when adding) ──────────────

function PolicyEditor({ initial, onClose, onSaved, onError }: { initial: PatientPolicy; onClose: () => void; onSaved: (p: PatientPolicy) => void; onError: (m: string) => void }) {
  const [patient, setPatient] = useState<{ umr: string; name: string } | null>(initial.patientId ? { umr: initial.patientId, name: db.getPatientByUmr(initial.patientId)?.name || initial.patientName } : null)
  const [find, setFind] = useState("")
  const list = useMemo(() => {
    const t = find.trim().toLowerCase()
    const all = db.getPatients()
    return (t ? all.filter((p) => `${p.name} ${p.umr} ${p.phone}`.toLowerCase().includes(t)) : all).slice(0, 8)
  }, [find])

  return (
    <Modal wide title={initial.id ? "Edit insurance policy" : "Add insurance policy"} onClose={onClose}>
      {!patient ? (
        <div className="space-y-3">
          <Field label="Step 1 · Which patient?" hint="Only registered patients can hold a policy. Register the patient at Reception first if they are not listed.">
            <input autoFocus className={fieldCls} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by name, UMR or phone" />
          </Field>
          <div className="border border-slate-200 max-h-64 overflow-y-auto">
            {list.length === 0 && <div className="p-4 text-[13px] text-slate-500">No registered patient matches.</div>}
            {list.map((p) => (
              <button key={p.umr} type="button" onClick={() => setPatient({ umr: p.umr, name: p.name })} className="w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-teal-50/50 cursor-pointer text-[13px]">
                <span className="font-semibold text-slate-900">{p.name}</span> <span className="tabular-nums text-teal-700">{p.umr}</span>
                <span className="text-slate-500"> · {p.age} yrs · {p.sex}{p.phone ? ` · ${p.phone}` : ""}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 px-4 py-2.5 text-[13px]">
            <span>
              <span className="font-semibold text-slate-900">{patient.name}</span> <span className="tabular-nums text-slate-500">{patient.umr}</span>
            </span>
            {!initial.id && (
              <button type="button" className={btn.link} onClick={() => setPatient(null)}>
                Change patient
              </button>
            )}
          </div>
          <PolicyForm
            initial={{ ...initial, policyHolderName: initial.policyHolderName || patient.name, paymentType: "Insurance / Cashless", deductibleAmount: 0, preAuthRequired: true, roomCategoryEligible: "" }}
            submitLabel="Save policy"
            onSubmit={(f) => {
              try {
                onSaved(E.savePatientPolicy({ ...initial, ...f, tpaName: f.tpaName, patientId: patient.umr, patientName: patient.name }))
              } catch (e) {
                onError((e as Error).message)
              }
            }}
          />
        </div>
      )}
    </Modal>
  )
}

// ── import from CSV ──────────────────────────────────────────────────────────

function ImportModal({ existing, onClose, onDone, onError }: { existing: Set<string>; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [result, setResult] = useState<{ rows: ImportRow[]; fileError?: string } | null>(null)

  const read = async (f: File) => {
    setName(f.name)
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setResult({ rows: [], fileError: "Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited)." })
      return
    }
    const text = await f.text()
    setResult(
      checkImport(text, {
        patient: (umr) => {
          const p = db.getPatientByUmr(umr.trim())
          return p ? { umr: p.umr, name: p.name } : undefined
        },
        insurers: E.getInsurers().map((i) => ({ id: i.id, name: i.companyName, tpa: i.tpaName })),
        existing,
      }),
    )
  }

  const good = (result?.rows || []).filter((r) => r.status !== "error")
  const bad = (result?.rows || []).filter((r) => r.status === "error")
  const nNew = good.filter((r) => r.status === "new").length
  const nUpd = good.filter((r) => r.status === "update").length

  const apply = () => {
    try {
      const res = E.importPatientPolicies(good.map((r) => r.policy!))
      onDone(`Import finished: ${res.added} added, ${res.updated} updated${bad.length ? `, ${bad.length} row${bad.length > 1 ? "s" : ""} skipped` : ""}.`)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  return (
    <Modal wide title="Import insurance policies" onClose={onClose}>
      <div className="space-y-4">
        <ol className="text-[13px] text-slate-700 space-y-1 list-decimal pl-5">
          <li>
            Download the template and fill one policy per row.{" "}
            <button type="button" className={btn.link} onClick={() => download("patient-insurance-template.csv", toCsv(POLICY_COLUMNS, []))}>
              Download template
            </button>
          </li>
          <li>Save it as CSV and choose the file below. You will see a check of every row before anything is saved.</li>
        </ol>
        <div className="text-[12.5px] text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2">
          <strong className="text-slate-700">Required:</strong> UMR (must already be registered), Insurance company, Policy number. <strong className="text-slate-700">Dates</strong> as dd/mm/yyyy or yyyy-mm-dd. A policy that already exists for the patient is updated, not duplicated. An exported file can be edited and imported back.
        </div>

        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          <button type="button" className={btn.primary} onClick={() => fileRef.current?.click()}>
            Choose CSV file
          </button>
          <span className="text-[13px] text-slate-500 truncate">{name || "No file chosen"}</span>
        </div>

        {result?.fileError && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-[13px] px-3 py-2">{result.fileError}</div>}

        {result && !result.fileError && (
          <>
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Tag tone="emerald">{nNew} new</Tag>
              <Tag tone="blue">{nUpd} to update</Tag>
              <Tag tone={bad.length ? "rose" : "slate"}>{bad.length} with problems (skipped)</Tag>
            </div>
            <div className="border border-slate-200 max-h-72 overflow-y-auto">
              <table className="w-full table-fixed text-[12.5px]">
                <colgroup>
                  <col style={{ width: "56px" }} />
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "92px" }} />
                  <col />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 text-left text-[11.5px] uppercase tracking-wider text-slate-500 sticky top-0">
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Patient · policy</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.line} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 tabular-nums text-slate-500">{r.line}</td>
                      <td className="px-3 py-2 truncate">{r.label}</td>
                      <td className="px-3 py-2">
                        <Tag tone={r.status === "error" ? "rose" : r.status === "update" ? "blue" : "emerald"}>{r.status === "error" ? "Problem" : r.status === "update" ? "Update" : "New"}</Tag>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.errors.map((m) => (
                          <div key={m} className="text-rose-700">{m}</div>
                        ))}
                        {r.warnings.map((m) => (
                          <div key={m} className="text-amber-700">{m}</div>
                        ))}
                        {!r.errors.length && !r.warnings.length && <span className="text-slate-400">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.plain} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} disabled={!good.length} onClick={apply}>
            {good.length ? `Import ${good.length} polic${good.length === 1 ? "y" : "ies"}` : "Import"}
          </button>
        </div>
      </div>
    </Modal>
  )
}
