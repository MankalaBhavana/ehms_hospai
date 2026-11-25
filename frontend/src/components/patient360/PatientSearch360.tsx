import { useState } from "react"
import { patientPageUrl } from "../patientRecord/patientRecord"
import { p360, type Row } from "./api"
import { ClinicalTab, CommsTab, ConsentTab, EncountersTab, JourneyTab, MedicationsTab, NewTask, SurveysTab, TimelineTab } from "./PatientWorkspace"
import TasksView from "./TasksView"
import { Badge, btnCls, Card, cx, Empty, ErrorBox, errMsg, fmtDate, fmtDateTime, fullName, inputCls, Loading, pretty, Table, useAsync } from "./ui"

type Tab = "overview" | "timeline" | "clinical" | "encounters" | "medications" | "labs" | "appointments" | "journey" | "surveys" | "communications" | "tasks" | "documents" | "consent"

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "overview", label: "Overview", icon: "🏠" },
  { key: "timeline", label: "Timeline", icon: "🕒" },
  { key: "clinical", label: "Clinical", icon: "📋" },
  { key: "encounters", label: "Encounters", icon: "🩺" },
  { key: "medications", label: "Medications", icon: "💊" },
  { key: "labs", label: "Labs & Imaging", icon: "🧪" },
  { key: "appointments", label: "Appointments", icon: "📅" },
  { key: "journey", label: "Care Journey", icon: "🧭" },
  { key: "surveys", label: "Surveys", icon: "📝" },
  { key: "communications", label: "Communications", icon: "💬" },
  { key: "tasks", label: "Tasks", icon: "✅" },
  { key: "documents", label: "Documents", icon: "📄" },
  { key: "consent", label: "Consent & Audit", icon: "🔒" },
]

/** The server compares phone digits only, so the query is sent as typed (just trimmed). */
const normalise = (raw: string) => raw.trim().replace(/\s+/g, " ")
const initials = (p: Row) => (fullName(p).split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?")
const money = (v: any) => (v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN")}`)
const DONE = ["completed", "delivered", "sent", "skipped"]

/** Lab/imaging order state, from what the Laboratory module actually recorded. */
const labState = (x: Row) => (x.reported_at || ["reported", "completed", "published"].includes(String(x.order_status).toLowerCase())) ? "Available" : "Pending"

function Tile({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#EEF3FF] px-2 py-3 text-center">
      <div className="text-xl" aria-hidden>{icon}</div>
      <div className="text-2xl font-semibold leading-tight text-[#1E3A6E]">{String(value).padStart(2, "0")}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-[#475569]">{label}</div>
    </div>
  )
}

function Panel({ title, icon, badge, children, action, className }: { title: string; icon?: string; badge?: React.ReactNode; children: React.ReactNode; action?: { label: string; onClick: () => void }; className?: string }) {
  return (
    <section className={cx("flex flex-col rounded-xl border border-[#DDE2EC] bg-white p-4 shadow-sm", className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900">{icon && <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EEF3FF] text-sm">{icon}</span>}{title}</h3>
        {badge}
      </header>
      <div className="flex-1 text-[12px] text-[#334155]">{children}</div>
      {action && <button className="mt-3 self-end rounded-md border border-[#CBD5E1] bg-white px-3 py-1 text-[11.5px] font-medium text-[#1B4FD8] hover:bg-[#EEF3FF]" onClick={action.onClick}>{action.label} →</button>}
    </section>
  )
}

const LISTS = ["diagnoses", "vitals", "medications", "investigations", "lab_orders", "documents", "invoices", "claims", "surgeries", "beds", "er_visits", "admissions", "encounters", "appointments", "further_appointments", "journeys", "checkpoints", "tasks", "survey_responses", "communications", "authorizations"]

const none = (t: string) => <p className="text-[#64748B]">{t}</p>

function Overview({ d, go }: { d: Row; go: (t: Tab) => void }) {
  const p = d.patient
  const latestVisit = d.encounters[0] || d.admissions[0]
  const nextAppt = (d.further_appointments && d.further_appointments[0]) || d.appointments.filter((a: Row) => ["scheduled", "checked_in", "confirmed", "booked", "pending"].includes(a.status))[0] || d.appointments[0]
  const whatsappSymptomText = d.whatsapp_symptoms?.symptoms || d.patient?.symptoms || latestVisit?.symptoms || latestVisit?.chief_complaint
  const whatsappSymptomDate = d.whatsapp_symptoms?.received_at || d.patient?.updated_at
  const isAwaitingTriage = latestVisit && (
    latestVisit.status === "Awaiting Triage" ||
    latestVisit.status === "Registered" ||
    latestVisit.status === "In Queue" ||
    latestVisit.status === "Symptoms Captured" ||
    latestVisit.department === "Awaiting Triage" ||
    (latestVisit.status || "").toLowerCase().includes("triage")
  )
  const activeJourney = d.journeys.find((j: Row) => j.state === "active") || d.journeys[0]
  const jCps = activeJourney ? d.checkpoints.filter((c: Row) => c.journey_id === activeJourney.id && c.status !== "cancelled") : []
  const progress = jCps.length ? Math.round((jCps.filter((c: Row) => DONE.includes(c.status)).length / jCps.length) * 100) : 0
  const nextCp = jCps.find((c: Row) => ["scheduled", "queued", "overdue"].includes(c.status))
  const upcoming = d.appointments.filter((a: Row) => ["scheduled", "checked_in"].includes(a.status))[0]
  const h = d.clinical_history
  const pendingReports = d.investigations.filter((x: Row) => labState(x) === "Pending").length
  const allergy = p.allergies || h?.allergies
  const due = d.invoices.reduce((n: number, i: Row) => n + Number(i.due_amount || 0), 0)
  const bed = d.beds.find((b: Row) => !b.released_at)
  const activity = [
    ...d.appointments.slice(0, 3).map((a: Row) => ({ at: a.created_at || a.appointment_date, text: `Appointment booked — ${a.department || "General"} (${pretty(a.status)})`, mod: "Appointments" })),
    ...d.encounters.slice(0, 2).map((e: Row) => ({ at: e.arrival_at, text: `${e.encounter_type} encounter — ${e.chief_complaint || "visit"}`, mod: e.encounter_type === "OP" ? "OPD" : "Inpatient" })),
    ...d.investigations.slice(0, 3).map((x: Row) => ({ at: x.created_at, text: `Lab investigation ordered — ${x.test_name}`, mod: "Laboratory" })),
    ...d.medications.slice(0, 2).map((m: Row) => ({ at: m.created_at, text: "Prescription recorded", mod: "Pharmacy" })),
    ...d.invoices.slice(0, 2).map((i: Row) => ({ at: i.created_at, text: `Invoice ${i.invoice_no} — ${pretty(i.payment_status)}`, mod: "Billing" })),
    { at: p.created_at, text: "Patient registered", mod: "Patient Management" },
  ].filter((e) => e.at).sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 5)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Patient Overview">
          <div className="grid grid-cols-4 gap-2">
            <Tile icon="🩺" label="Total Encounters" value={d.encounters.length + d.admissions.length} />
            <Tile icon="💊" label="Active Medications" value={d.medications.filter((m: Row) => m.status !== "cancelled").length} />
            <Tile icon="🧪" label="Pending Reports" value={pendingReports} />
            <Tile icon="📋" label="Open Tasks" value={d.tasks.filter((t: Row) => !["resolved", "cancelled"].includes(t.status)).length} />
          </div>
        </Panel>
        <Panel
          title="Latest Encounter"
          badge={
            latestVisit && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge status={latestVisit.status || (latestVisit.discharge_date ? "completed" : "active")} />
                {isAwaitingTriage && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 border border-amber-300">
                    ⏳ Triage Pending
                  </span>
                )}
              </div>
            )
          }
          action={{ label: "View Details", onClick: () => go("encounters") }}
        >
          {latestVisit ? (
            <>
              <div className="text-[14px] font-semibold text-gray-900">{latestVisit.encounter_type === "OP" ? "OPD Consultation" : latestVisit.encounter_type ? `${latestVisit.encounter_type} visit` : "Inpatient admission"}</div>
              <div>{fmtDate(latestVisit.arrival_at || latestVisit.admission_date)} · {d.appointments[0]?.department || latestVisit.department || "—"}</div>
              <div className="mt-2 text-[#64748B]">Consulting Doctor</div>
              <div className="font-medium text-gray-900">{d.appointments[0]?.doctor_name || latestVisit.attending_doctor || "—"}</div>
              <div className="mt-2 text-[#64748B]">Complaint / Summary</div>
              <div>{latestVisit.chief_complaint || latestVisit.admission_reason || d.diagnoses[0]?.diagnosis_name || "Not recorded"}</div>

              {/* Further Appointments & Current Symptoms beside Awaiting Triage */}
              <div className="mt-3 space-y-2 border-t border-[#E2E8F0] pt-2.5">
                <div className="rounded border border-[#DCE6FB] bg-[#F4F7FE] p-2 text-[11.5px]">
                  <div className="flex items-center justify-between font-semibold text-gray-800">
                    <span className="flex items-center gap-1">📅 Further Appointment</span>
                    {nextAppt && <Badge status={nextAppt.status} />}
                  </div>
                  {nextAppt ? (
                    <div className="mt-0.5 text-gray-900 font-medium">
                      <span className="text-[#1B4FD8] font-bold">{fmtDateTime(nextAppt.appointment_date)}</span> · {nextAppt.doctor_name || "Doctor"} ({nextAppt.department || "General"})
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[#64748B]">No further appointments scheduled.</div>
                  )}
                </div>

                <div className="rounded border border-emerald-200 bg-emerald-50/70 p-2 text-[11.5px]">
                  <div className="flex items-center justify-between font-semibold text-emerald-900">
                    <span className="flex items-center gap-1">🩺 Symptoms</span>
                    {whatsappSymptomDate && <span className="text-[10px] text-emerald-700 font-normal">{fmtDate(whatsappSymptomDate)}</span>}
                  </div>
                  <div className="mt-0.5 text-gray-900 font-medium italic">
                    {whatsappSymptomText ? `"${whatsappSymptomText}"` : "None reported"}
                  </div>
                </div>
              </div>
            </>
          ) : none("No encounters recorded.")}
        </Panel>
        <Panel title="Care Journey" icon="🧭" badge={activeJourney && <Badge status={activeJourney.state} />} action={{ label: "View Journey", onClick: () => go("journey") }}>
          {activeJourney ? (
            <>
              <div className="text-[14px] font-semibold text-gray-900">{pretty(activeJourney.template_key)}</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E2E8F0]"><div className="h-full rounded-full bg-[#1B4FD8]" style={{ width: `${progress}%` }} /></div>
                <span className="text-[15px] font-semibold text-[#1E3A6E]">{progress}%</span>
              </div>
              <div className="mt-2 text-[#64748B]">{nextCp ? <>Next checkpoint: <span className="text-gray-900">{nextCp.label}</span> · {fmtDate(nextCp.due_at)}</> : "No pending checkpoint."}</div>
            </>
          ) : none("Not enrolled in a care journey.")}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Clinical Context" icon="📋" badge={<Badge tone="blue">Source-linked</Badge>} action={{ label: "Open Clinical", onClick: () => go("clinical") }}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <div><dt className="text-[#64748B]">Medical History</dt><dd className="font-medium text-gray-900">{h ? "Available" : "Not recorded"}</dd></div>
            <div><dt className="text-[#64748B]">Allergies</dt><dd className={allergy ? "font-semibold text-[#B45309]" : "font-medium text-gray-900"}>{allergy || "None recorded"}</dd></div>
            <div><dt className="text-[#64748B]">Surgical History</dt><dd className="font-medium text-gray-900">{h?.previous_surgeries || "Not verified"}</dd></div>
            <div><dt className="text-[#64748B]">Current Diagnosis</dt><dd className="font-medium text-gray-900">{d.diagnoses[0]?.diagnosis_name || "See consultation"}</dd></div>
          </dl>
        </Panel>
        <Panel title="Medication Summary" icon="💊" action={{ label: "View All", onClick: () => go("medications") }}>
          {d.medications.length ? (
            <>
              <div className="flex items-center justify-between"><span className="font-semibold text-gray-900">Prescribed medicines</span><Badge tone="blue">{String(d.medications.length).padStart(2, "0")} records</Badge></div>
              <ul className="mt-1.5 space-y-0.5">{d.medications.slice(0, 3).map((m: Row) => <li key={m.id}>{m.medicines.map((x: Row) => x.name).join(", ") || "—"} <Badge status={m.status} /></li>)}</ul>
              <div className="mt-1.5 text-[#64748B]">Linked to Pharmacy</div>
            </>
          ) : none("No prescriptions on record.")}
        </Panel>
        <Panel title="Labs & Imaging" icon="🧪" action={{ label: "View All", onClick: () => go("labs") }}>
          {d.investigations.length ? <ul className="space-y-2">{d.investigations.slice(0, 3).map((x: Row) => <li key={x.id} className="flex items-center justify-between gap-2"><span className="font-medium text-gray-900">{x.test_name}</span><Badge tone={labState(x) === "Available" ? "green" : "amber"}>{labState(x)}</Badge></li>)}</ul> : none("No investigations ordered.")}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Upcoming Follow-up" icon="📅" badge={upcoming && <Badge status="pending" />} action={{ label: "View Appointments", onClick: () => go("appointments") }}>
          {upcoming ? <><div className="font-semibold text-gray-900">{upcoming.visit_type || "Appointment"}</div><div>{fmtDateTime(upcoming.appointment_date)} · {upcoming.department || "—"}</div><div className="text-[#64748B]">{upcoming.doctor_name || "—"} · Token {upcoming.token_no ?? "—"}</div></> : none("No upcoming appointment. Check the scheduler for booking status.")}
        </Panel>
        <Panel title="Recent Activity" action={{ label: "Full Timeline", onClick: () => go("timeline") }}>
          <ul className="space-y-1.5">{activity.map((e, i) => <li key={i} className="border-l-2 border-[#1B4FD8] pl-2"><span className="font-medium text-gray-900">{e.text}</span><span className="text-[#94A3B8]"> · {e.mod} · {fmtDate(e.at)}</span></li>)}</ul>
        </Panel>
        <Panel title="Billing & Insurance" icon="💳" className="bg-gradient-to-br from-[#EEF3FF] to-white">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-[#64748B]">Invoices</div><div className="text-[15px] font-semibold text-gray-900">{d.invoices.length}</div></div>
            <div><div className="text-[#64748B]">Outstanding</div><div className={cx("text-[15px] font-semibold", due > 0 ? "text-[#B91C1C]" : "text-gray-900")}>{money(due)}</div></div>
            <div><div className="text-[#64748B]">Insurance claims</div><div className="font-medium text-gray-900">{d.claims.length ? `${d.claims.length} · ${pretty(d.claims[0].claim_status)}` : "None"}</div></div>
            <div><div className="text-[#64748B]">Surgeries / Bed</div><div className="font-medium text-gray-900">{d.surgeries.length} · {bed ? `${bed.ward || "Ward"} ${bed.bed_no || ""}` : "No bed"}</div></div>
          </div>
          {d.invoices.length > 0 && <ul className="mt-2 space-y-0.5 border-t border-[#E2E8F0] pt-2">{d.invoices.slice(0, 2).map((i: Row) => <li key={i.id} className="flex justify-between"><span>{i.invoice_no} · {pretty(i.module)}</span><span>{money(i.total_amount)} <Badge status={i.payment_status} /></span></li>)}</ul>}
        </Panel>
      </div>
    </div>
  )
}

function MoreVisits({ d }: { d: Row }) {
  return (
    <div className="mt-3 space-y-3">
      <Card title="Emergency visits">
        {d.er_visits?.length ? <Table head={["Arrived", "Visit no", "Mode", "Condition", "Doctor", "Status"]}>{d.er_visits.map((v: Row) => <tr key={v.id}><td className="px-2 py-1.5">{fmtDateTime(v.arrival_at)}</td><td className="px-2 py-1.5">{v.visit_no}</td><td className="px-2 py-1.5">{pretty(v.arrival_mode)}</td><td className="px-2 py-1.5">{v.condition_at_arrival || "—"}</td><td className="px-2 py-1.5">{v.assigned_doctor_name || "—"}</td><td className="px-2 py-1.5"><Badge status={v.status} /></td></tr>)}</Table> : <p className="text-[12px] text-[#64748B]">None.</p>}
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Bed allocations">
          {d.beds.length ? <Table head={["Ward / bed", "Allocated", "Released", "Status"]}>{d.beds.map((b: Row) => <tr key={b.id}><td className="px-2 py-1.5">{b.ward || "—"} {b.room_no || ""} {b.bed_no || ""}</td><td className="px-2 py-1.5">{fmtDate(b.allocated_at)}</td><td className="px-2 py-1.5">{b.released_at ? fmtDate(b.released_at) : "—"}</td><td className="px-2 py-1.5"><Badge status={b.status} /></td></tr>)}</Table> : <p className="text-[12px] text-[#64748B]">None.</p>}
        </Card>
        <Card title="Surgeries">
          {d.surgeries.length ? <Table head={["Procedure", "Surgeon", "Scheduled", "Status"]}>{d.surgeries.map((x: Row) => <tr key={x.id}><td className="px-2 py-1.5">{x.procedure_name}</td><td className="px-2 py-1.5">{x.surgeon_name || "—"}</td><td className="px-2 py-1.5">{fmtDateTime(x.scheduled_start)}</td><td className="px-2 py-1.5"><Badge status={x.status} /></td></tr>)}</Table> : <p className="text-[12px] text-[#64748B]">None.</p>}
        </Card>
      </div>
      <Card title="Billing & insurance">
        {d.invoices.length ? <Table head={["Invoice", "Module", "Total", "Paid", "Due", "Status"]}>{d.invoices.map((i: Row) => <tr key={i.id}><td className="px-2 py-1.5">{i.invoice_no}</td><td className="px-2 py-1.5">{pretty(i.module)}</td><td className="px-2 py-1.5">{money(i.total_amount)}</td><td className="px-2 py-1.5">{money(i.paid_amount)}</td><td className="px-2 py-1.5">{money(i.due_amount)}</td><td className="px-2 py-1.5"><Badge status={i.payment_status} /></td></tr>)}</Table> : <p className="text-[12px] text-[#64748B]">No invoices.</p>}
        {d.claims.length > 0 && <div className="mt-3"><Table head={["Insurer", "Claim", "Approved", "Status"]}>{d.claims.map((c: Row) => <tr key={c.id}><td className="px-2 py-1.5">{c.insurer_name || "—"}</td><td className="px-2 py-1.5">{money(c.claim_amount)}</td><td className="px-2 py-1.5">{money(c.approved_amount)}</td><td className="px-2 py-1.5"><Badge status={c.claim_status} /></td></tr>)}</Table></div>}
      </Card>
    </div>
  )
}

function Appointments({ d }: { d: Row }) {
  return (
    <Card title="Appointments (read from the scheduler)">
      {d.appointments.length ? <Table head={["When", "Department", "Doctor", "Type", "Token", "Status", "Consultation"]}>{d.appointments.map((a: Row) => <tr key={a.id} className="align-top"><td className="px-2 py-1.5">{fmtDateTime(a.appointment_date)}</td><td className="px-2 py-1.5">{a.department || "—"}</td><td className="px-2 py-1.5">{a.doctor_name || "—"}</td><td className="px-2 py-1.5">{a.visit_type}</td><td className="px-2 py-1.5">{a.token_no ?? "—"}</td><td className="px-2 py-1.5"><Badge status={a.status} /></td><td className="px-2 py-1.5 text-[11.5px]">{a.chief_complaint && <div>Complaint: {a.chief_complaint}</div>}{a.diagnosis && <div>Dx: {a.diagnosis}</div>}{a.medicines && <div>Rx: {typeof a.medicines === "string" ? a.medicines : JSON.stringify(a.medicines)}</div>}{a.advice && <div>Advice: {a.advice}</div>}{a.follow_up_date && <div>Follow-up: {fmtDate(a.follow_up_date)}</div>}{!a.chief_complaint && !a.diagnosis && !a.medicines && !a.advice && "—"}</td></tr>)}</Table> : <Empty>No appointments.</Empty>}
    </Card>
  )
}

function Labs({ d }: { d: Row }) {
  return (
    <Card title="Labs & Imaging orders">
      {d.investigations.length ? <Table head={["Test", "Ordered", "By", "Status"]}>{d.investigations.map((x: Row) => <tr key={x.id}><td className="px-2 py-1.5">{x.test_name}</td><td className="px-2 py-1.5">{fmtDate(x.created_at)}</td><td className="px-2 py-1.5">{x.doctor_name || "—"}</td><td className="px-2 py-1.5"><Badge tone={labState(x) === "Available" ? "green" : "amber"}>{labState(x)}</Badge> <span className="text-[10.5px] text-[#94A3B8]">{pretty(x.order_status)}</span></td></tr>)}</Table> : <Empty>No investigations ordered.</Empty>}
      <p className="mt-2 text-[10.5px] text-[#94A3B8]">Results and reports are opened from the Laboratory / Radiology module; Patient 360° does not duplicate them.</p>
    </Card>
  )
}

function Documents({ d }: { d: Row }) {
  return (
    <Card title="Documents">
      {d.documents.length ? <Table head={["Type", "File", "Uploaded", "OCR"]}>{d.documents.map((x: Row) => <tr key={x.id}><td className="px-2 py-1.5">{pretty(x.doc_type)}</td><td className="px-2 py-1.5">{x.file_name || "—"}</td><td className="px-2 py-1.5">{fmtDate(x.created_at)}</td><td className="px-2 py-1.5">{x.ocr_extracted ? <Badge tone="amber">Extracted — unverified</Badge> : "—"}</td></tr>)}</Table> : <Empty>No documents uploaded.</Empty>}
    </Card>
  )
}

function Profile({ patientId, onClose, navigate }: { patientId: string; onClose: () => void; navigate: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview")
  const [showTask, setShowTask] = useState(false)
  const { data: raw, error, loading, reload } = useAsync(() => p360.profile(patientId), [patientId])
  // Older backends omit some sections; treat a missing list as empty instead of crashing the page.
  const d = raw ? { ...Object.fromEntries(LISTS.map((k) => [k, []])), ...raw } : null

  if (loading && !d) return <Loading />
  if (error && !d) return <ErrorBox error={error} onRetry={reload} />
  if (!d) return null

  const p = d.patient
  const visit = d.appointments[0]
  const nextAppt = (d.further_appointments && d.further_appointments[0]) || d.appointments.filter((a: Row) => ["scheduled", "checked_in", "confirmed", "booked", "pending"].includes(a.status))[0] || d.appointments[0]
  const latestVisit = d.encounters?.[0] || d.admissions?.[0]
  const isAwaitingTriage = latestVisit && (
    latestVisit.status === "Awaiting Triage" ||
    latestVisit.status === "Registered" ||
    latestVisit.status === "In Queue" ||
    latestVisit.status === "Symptoms Captured" ||
    latestVisit.department === "Awaiting Triage" ||
    (latestVisit.status || "").toLowerCase().includes("triage")
  )
  const whatsappSymptomText = d.whatsapp_symptoms?.symptoms || d.patient?.symptoms || latestVisit?.symptoms || latestVisit?.chief_complaint
  const whatsappSymptomDate = d.whatsapp_symptoms?.received_at || d.patient?.updated_at
  const openTasks = d.tasks.filter((t: Row) => !["resolved", "cancelled"].includes(t.status)).length
  const admitted = d.admissions.some((a: Row) => !a.discharge_date)
  const facts: Array<[string, string, string]> = [
    ["🎂", `${p.age ?? "—"} Years`, `(${p.gender || "—"})`],
    ["📞", p.phone || "No phone on record", "(Mobile)"],
    ["🩸", p.blood_group || "—", "(Blood group)"],
    ["📅", fmtDate(p.created_at), "(Registration)"],
    ["👨‍⚕️", visit?.doctor_name || "—", "(Treating Doctor)"],
    ["🏥", visit?.department || "—", "(Department)"],
  ]

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[#DDE2EC] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#DCE6FB] text-3xl font-bold text-[#1E3A6E]">{initials(p)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold text-gray-900">{fullName(p)}</h2>
              <Badge tone="green">● Active</Badge>
              <Badge tone="blue">{admitted ? "Inpatient" : p.patient_type && p.patient_type !== "regular" ? pretty(p.patient_type) : "OPD Patient"}</Badge>
              {isAwaitingTriage && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300">
                  ⏳ Awaiting Triage
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[13px] text-[#475569]">{p.patient_id}</div>
            <dl className="mt-4 grid grid-cols-2 gap-y-3 md:grid-cols-3 xl:flex xl:divide-x xl:divide-[#E2E8F0]">
              {facts.map(([icon, v, l]) => (
                <div key={l} className="flex items-center gap-2.5 text-[12.5px] xl:px-4 xl:first:pl-0">
                  <span aria-hidden className="text-lg">{icon}</span>
                  <div className="min-w-0"><dd className="truncate font-medium text-gray-900">{v}</dd><dt className="text-[11px] text-[#64748B]">{l}</dt></div>
                </div>
              ))}
            </dl>

            {/* Prominent Banner when Awaiting Triage or displaying Further Appointments & WhatsApp Symptoms */}
            <div className="mt-3.5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3.5 py-2 text-[12px]">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <span className="animate-pulse">⏳</span>
                <span>Awaiting Triage</span>
              </div>
              <span className="text-amber-300">|</span>
              <div className="flex items-center gap-1.5 text-gray-800">
                <span className="font-semibold text-gray-700">📅 Further Appointment:</span>
                {nextAppt ? (
                  <span className="font-bold text-[#1B4FD8]">
                    {fmtDateTime(nextAppt.appointment_date)} · {nextAppt.doctor_name || "Doctor"} ({nextAppt.department || "General"})
                  </span>
                ) : (
                  <span className="text-[#64748B]">None scheduled</span>
                )}
              </div>
              <span className="text-amber-300">|</span>
              <div className="flex items-center gap-1.5 text-gray-800">
                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-300">
                  Symptoms:
                </span>
                <span className="font-medium text-gray-900 italic">
                  {whatsappSymptomText ? `"${whatsappSymptomText}"` : "None reported"}
                </span>
                {whatsappSymptomDate && <span className="text-[10.5px] text-[#64748B]">({fmtDate(whatsappSymptomDate)})</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btnCls.ghost} onClick={() => window.open(patientPageUrl(p.patient_id), "_blank", "noopener")}>✎ Open Full Record</button>
            <button className={btnCls.ghost} onClick={() => setShowTask(true)}>+ Task</button>
            <button className={btnCls.ghost} onClick={reload}>⟳ Refresh</button>
            <button className={btnCls.ghost} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        {(p.allergies || d.clinical_history?.allergies) && <p className="mt-3 rounded border border-[#FDE68A] bg-[#FFFBEB] px-2 py-1 text-[12px] text-[#92400E]">Allergies: {p.allergies || d.clinical_history?.allergies}</p>}
      </section>

      <nav role="tablist" className="flex gap-1.5 overflow-x-auto rounded-xl border border-[#DDE2EC] bg-white p-1.5 shadow-sm">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cx("flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-medium", tab === t.key ? "bg-[#1B4FD8] text-white shadow" : "text-[#475569] hover:bg-[#EEF3FF]")}>
            <span aria-hidden>{t.icon}</span>{t.label}{t.key === "tasks" && openTasks > 0 ? ` (${openTasks})` : ""}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview d={d} go={setTab} />}
      {tab === "timeline" && <TimelineTab patientId={p.patient_id} />}
      {tab === "clinical" && <ClinicalTab d={d} />}
      {tab === "encounters" && <><EncountersTab d={d} /><MoreVisits d={d} /></>}
      {tab === "medications" && <MedicationsTab d={d} />}
      {tab === "labs" && <Labs d={d} />}
      {tab === "appointments" && <Appointments d={d} />}
      {tab === "journey" && <JourneyTab d={d} />}
      {tab === "surveys" && <SurveysTab d={d} />}
      {tab === "communications" && <CommsTab d={d} navigate={navigate} />}
      {tab === "tasks" && <TasksView patientId={p.patient_id} />}
      {tab === "documents" && <Documents d={d} />}
      {tab === "consent" && <ConsentTab patientId={p.patient_id} prefs={d.preferences} onChanged={reload} />}
      <p className="text-[10.5px] text-[#94A3B8]">{d.freshness_note} Loaded {fmtDateTime(d.generated_at)}.</p>
      {showTask && <NewTask patientId={p.patient_id} onClose={() => setShowTask(false)} onCreated={() => { setShowTask(false); reload() }} />}
    </div>
  )
}

// --- Hero landing page data source nodes for circular diagram ---
const DATA_NODES = [
  { icon: "🫀", label: "Medical History",  angle: -135 },
  { icon: "📋", label: "Clinical Records", angle: -90  },
  { icon: "🧪", label: "Lab & Imaging",    angle: -45  },
  { icon: "💊", label: "Medications",      angle: 0    },
  { icon: "📅", label: "Appointments",     angle: 45   },
  { icon: "🧭", label: "Care Journey",     angle: 90   },
  { icon: "💬", label: "Communications",   angle: 135  },
  { icon: "📄", label: "Documents",        angle: 180  },
]

/** Hosp AI → Patient 360°: hero landing page + search. */
export default function PatientSearch360({ navigate }: { navigate: (module: string) => void }) {
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [matches, setMatches] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = normalise(query)
    if (!q) return
    setBusy(true); setError(""); setMatches(null); setOpenId(null)
    try {
      const r = await p360.registry({ q, limit: 10 })
      setTotal(r.total)
      if (r.patients.length === 1) setOpenId(r.patients[0].patient_id)
      else setMatches(r.patients)
    } catch (err) { setError(errMsg(err)) } finally { setBusy(false) }
  }
  const clear = () => { setQuery(""); setMatches(null); setOpenId(null); setError("") }

  // ── When a patient is open show slim header + profile ──
  if (openId) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#F0F2F5]">
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Patient 360°</h1>
              <p className="text-[12.5px] text-[#64748B]">Unified patient profile and care coordination</p>
            </div>
            <form onSubmit={search} role="search" className="flex min-w-[320px] flex-1 gap-2 rounded-xl border border-[#CBD5E1] bg-white p-1.5 shadow-sm md:max-w-2xl">
              <span aria-hidden className="flex items-center pl-2 text-[#64748B]">🔍</span>
              <input aria-label="Search patient" className="w-full bg-transparent px-1 text-[14px] text-gray-900 outline-none"
                value={query} maxLength={80} placeholder="Search by patient ID, name or mobile number"
                onChange={(e) => setQuery(e.target.value)} />
              {query && <button type="button" className="px-2 text-[#64748B] hover:text-gray-900" onClick={clear}>✕</button>}
              <button type="submit" disabled={busy || !query.trim()}
                className="rounded-lg bg-[#1B4FD8] px-6 py-2 text-[13px] font-medium text-white hover:bg-[#1741B0] disabled:opacity-50">
                {busy ? "Searching…" : "Search"}
              </button>
            </form>
          </div>
          {error && <ErrorBox error={error} onRetry={search} />}
          <Profile key={openId} patientId={openId} navigate={navigate} onClose={() => { setOpenId(null); clear() }} />
        </div>
      </div>
    )
  }

  // ── Hero landing page (no patient selected) ──
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative min-h-screen bg-gradient-to-br from-[#E8F0FE] via-[#EEF4FF] to-white overflow-hidden">

        {/* Decorative "+" marks scattered in background */}
        {[
          { top: "8%",  left: "4%",  sz: 20, op: 0.18 },
          { top: "20%", left: "48%", sz: 15, op: 0.12 },
          { top: "55%", left: "2%",  sz: 14, op: 0.11 },
          { top: "72%", left: "62%", sz: 18, op: 0.10 },
          { top: "85%", left: "32%", sz: 12, op: 0.09 },
          { top: "38%", left: "92%", sz: 16, op: 0.11 },
        ].map((p, i) => (
          <span key={i} aria-hidden style={{
            position: "absolute", top: p.top, left: p.left,
            fontSize: p.sz, opacity: p.op, color: "#1B4FD8",
            fontWeight: 900, lineHeight: 1, userSelect: "none", pointerEvents: "none",
          }}>+</span>
        ))}

        {/* Two-column hero */}
        <div className="flex flex-col lg:flex-row min-h-[calc(100vh-56px)]">

          {/* LEFT: title, tagline, pills, search */}
          <div className="flex-1 flex flex-col justify-center px-8 py-10 lg:px-14 lg:py-16 max-w-2xl">

            <h1 className="text-4xl lg:text-5xl font-bold text-[#1E3A6E] leading-tight tracking-tight">
              Patient <span className="text-[#1B4FD8]">360°</span>
            </h1>

            <p className="mt-3 text-xl font-semibold text-[#1B4FD8]">
              One patient. Complete view. Better care.
            </p>

            <p className="mt-3 text-[#475569] text-[13.5px] leading-relaxed max-w-md">
              Get a unified view of your patient's journey — from registration to follow-up — with clinical data, care coordination and PatientReach AI.
            </p>

            {/* Feature pills */}
            <div className="mt-7 flex flex-wrap gap-3">
              {[
                { icon: "🧑‍⚕️", label: "Unified Patient Profile" },
                { icon: "📈",    label: "Clinical Timeline" },
                { icon: "🤝",    label: "Care Coordination" },
                { icon: "💬",    label: "PatientReach AI" },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-2 rounded-xl bg-white border border-[#DCE6FB] px-3.5 py-2.5 text-[12px] font-medium text-[#1E3A6E] shadow-sm">
                  <span className="text-base" aria-hidden>{f.icon}</span>
                  {f.label}
                </div>
              ))}
            </div>

            {/* Search bar */}
            <form onSubmit={search} role="search"
              className="mt-8 flex items-center gap-2 rounded-xl border border-[#CBD5E1] bg-white p-1.5 shadow-md max-w-lg">
              <span aria-hidden className="flex items-center pl-2 text-[#94A3B8] text-lg">🔍</span>
              <input
                autoFocus
                aria-label="Search patient by ID, name or mobile number"
                className="w-full bg-transparent px-2 text-[14px] text-gray-900 outline-none placeholder:text-[#94A3B8]"
                placeholder="Search by Patient ID, name or mobile number..."
                value={query} maxLength={80}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="px-2 text-[#64748B] hover:text-gray-900 text-sm" onClick={clear}>✕</button>
              )}
              <button type="submit" disabled={busy || !query.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[#1B4FD8] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#1741B0] disabled:opacity-50 transition-colors">
                {busy ? "Searching…" : <><span>Search</span><span aria-hidden className="text-base font-bold">›</span></>}
              </button>
            </form>

            {/* Feedback / results */}
            {error && <div className="mt-4"><ErrorBox error={error} onRetry={search} /></div>}

            {!openId && matches && matches.length === 0 && (
              <div className="mt-4"><Empty>No registered patient matches "{query.trim()}". Check the ID, name spelling or mobile number.</Empty></div>
            )}

            {!openId && matches && matches.length > 1 && (
              <section className="mt-4 rounded-lg border border-[#DDE2EC] bg-white shadow-sm">
                <header className="border-b border-[#EEF1F6] px-4 py-2 text-[12.5px] font-semibold">
                  {total} patients match — choose one
                  {total > matches.length ? ` (showing first ${matches.length}; refine to narrow)` : ""}
                </header>
                <ul className="divide-y divide-[#F1F5F9]">
                  {matches.map((m) => (
                    <li key={m.patient_id}>
                      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#EEF3FF]"
                        onClick={() => { setOpenId(m.patient_id); setMatches(null) }}>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#DCE6FB] text-[12px] font-bold text-[#1E3A6E]">{initials(m)}</span>
                        <span className="flex-1">
                          <span className="block text-[13px] font-medium text-gray-900">{fullName(m)}</span>
                          <span className="block text-[11.5px] text-[#64748B]">{m.patient_id} · {m.age ?? "—"} yrs · {m.gender || "—"} · {m.phone || "no phone"}</span>
                        </span>
                        {m.admitted ? <Badge tone="blue">Admitted</Badge> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* RIGHT: Circular data-source diagram */}
          <div className="flex-1 flex items-center justify-center p-8 relative">
            <div style={{ position: "relative", width: 320, height: 320 }}>
              {/* Dashed orbit ring */}
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                border: "1.5px dashed #93C5FD", opacity: 0.5,
              }} />
              {/* Inner ring */}
              <div style={{
                position: "absolute", inset: 24, borderRadius: "50%",
                border: "1px solid #BFDBFE", opacity: 0.5,
              }} />

              {/* Center avatar */}
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%,-50%)",
                width: 72, height: 72, borderRadius: "50%",
                background: "linear-gradient(135deg,#1B4FD8 0%,#3B6EF0 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 4px 20px rgba(27,79,216,0.35)",
                zIndex: 10, fontSize: 32,
              }}>🧑‍⚕️</div>

              {/* SVG lines from center to nodes */}
              <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                {DATA_NODES.map((node) => {
                  const rad = (node.angle * Math.PI) / 180
                  const r = 148, cx = 160 + r * Math.sin(rad), cy = 160 - r * Math.cos(rad)
                  const dx = cx - 160, dy = cy - 160, dist = Math.sqrt(dx * dx + dy * dy)
                  const cr = 36
                  return (
                    <line key={node.label}
                      x1={160 + (cr / dist) * dx} y1={160 + (cr / dist) * dy}
                      x2={cx - (22 / dist) * dx} y2={cy - (22 / dist) * dy}
                      stroke="#93C5FD" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
                  )
                })}
              </svg>

              {/* Node cards */}
              {DATA_NODES.map((node) => {
                const rad = (node.angle * Math.PI) / 180
                const r = 148
                return (
                  <div key={node.label} style={{
                    position: "absolute",
                    left: 160 + r * Math.sin(rad),
                    top: 160 - r * Math.cos(rad),
                    transform: "translate(-50%,-50%)",
                    zIndex: 5,
                  }}>
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                      background: "white", border: "1.5px solid #DCE6FB", borderRadius: 12,
                      padding: "6px 10px", boxShadow: "0 2px 8px rgba(27,79,216,0.10)",
                      minWidth: 70, textAlign: "center",
                    }}>
                      <span style={{ fontSize: 20 }} aria-hidden>{node.icon}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 600, color: "#1E3A6E", lineHeight: 1.3, whiteSpace: "nowrap" }}>{node.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer bar */}
        <div className="border-t border-[#DCE6FB] bg-white/80 backdrop-blur-sm px-8 py-3 flex items-center justify-between text-[12px] text-[#475569]">
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1B4FD8] text-white text-[10px] font-bold">✓</span>
            Better Patient Engagement.&nbsp;&nbsp;Smarter Care Coordination.&nbsp;&nbsp;Improved Health Outcomes.
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-[#1B4FD8]">
            <span className="rounded bg-[#1B4FD8] text-white px-1.5 py-0.5 text-[10px] font-bold leading-none">H</span>
            Powered by HospAi
          </span>
        </div>
      </div>
    </div>
  )
}