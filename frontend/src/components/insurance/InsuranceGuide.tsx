import { useMemo, useState } from "react"
import { BookOpen, Search, ChevronDown, Mail, ShieldCheck, Wallet, AlertCircle, Printer } from "lucide-react"
import { DESK_STEPS } from "./deskGuide"
import { printPage } from "../../utils/insurancePrint"

type Nav = (module: string) => void

interface Section {
  id: string
  title: string
  keywords: string
  body: React.ReactNode
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
    <div className="text-sm text-slate-700 leading-relaxed">{children}</div>
  </li>
)

const Tip = ({ tone = "blue", children }: { tone?: "blue" | "amber" | "rose"; children: React.ReactNode }) => {
  const cls = { blue: "bg-blue-50 border-blue-200 text-blue-900", amber: "bg-amber-50 border-amber-200 text-amber-900", rose: "bg-rose-50 border-rose-200 text-rose-900" }[tone]
  return <div className={`text-xs border rounded-lg px-3 py-2 leading-relaxed ${cls}`}>{children}</div>
}

const Menu = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-slate-900 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-[12px]">{children}</span>
)

/**
 * How to use the Insurance module in this application, in the order a case really moves.
 * The 8 stages come from deskGuide (the same source the case screens use), so they cannot drift.
 */
export default function InsuranceGuide({ onNavigate }: { onNavigate?: Nav }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string>("start")
  const [printAll, setPrintAll] = useState(false)

  const go = (m: string, label: string) =>
    onNavigate ? (
      <button type="button" onClick={() => onNavigate(m)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900 cursor-pointer font-semibold">
        {label}
      </button>
    ) : (
      <Menu>{label}</Menu>
    )

  const sections: Section[] = useMemo(
    () => [
      {
        id: "start",
        title: "Start here: how a case moves",
        keywords: "overview journey flow steps order stages",
        body: (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              Every insured admission is one <strong>case</strong>. A case moves through eight stages, always in this order. A stage turns green only when its work is on record, so you can see at a glance what is
              done and what is still missing. A stage cannot be skipped: if you try, the application tells you what to finish first.
            </p>
            <Tip>
              Want the detailed version for a real patient? Open {go("insurance_plan", "Step-by-Step Plan")}: pick the patient and every step is ticked from that case's records, with the next action highlighted.
            </Tip>
            <ol className="space-y-2">
              {DESK_STEPS.map((s) => (
                <li key={s.id} className="border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{s.n}</span>
                    <span className="text-sm font-bold text-slate-900">{s.title}</span>
                    <span className="text-xs text-slate-500">· {s.short}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{s.meaning}</p>
                  <div className="grid sm:grid-cols-2 gap-3 mt-2">
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">What you do</div>
                      <ul className="text-xs text-slate-700 list-disc pl-4 space-y-0.5 mt-0.5">{s.tasks.map((t) => <li key={t}>{t}</li>)}</ul>
                    </div>
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Keep ready</div>
                      <ul className="text-xs text-slate-700 list-disc pl-4 space-y-0.5 mt-0.5">{s.needs.map((t) => <li key={t}>{t}</li>)}</ul>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ),
      },
      {
        id: "cashless",
        title: "Cashless claim, step by step",
        keywords: "cashless pre-auth preauthorization eligibility discharge final bill claim settlement",
        body: (
          <div className="space-y-3">
            <Tip>Cashless: the insurer pays the hospital directly. The patient pays only what the insurer does not cover.</Tip>
            <ol className="space-y-3">
              <Step n={1}>
                Open <Menu>Insurance → Intake &amp; Eligibility</Menu> (or press <strong>New case</strong> in Claims). Choose <strong>Cashless</strong>, pick the admitted patient from the bed board, then enter the policy
                details from the card: insurer, TPA, policy number, member ID. The case starts at <strong>Eligibility</strong>.
              </Step>
              <Step n={2}>
                <strong>Verify eligibility.</strong> Check the policy with the insurer or TPA (portal, phone or email). Record what they confirmed: eligible or not, sum insured, balance, whether pre-auth is needed. Use{" "}
                <Menu>Send email</Menu> if you ask by email. If the insurer says the policy is not eligible, the case stops at <em>Not eligible</em>: re-check, or move the patient to self-pay.
              </Step>
              <Step n={3}>
                <strong>Pre-authorisation.</strong> Open {go("insurance_preauth", "Pre-Authorization")}. Fill diagnosis, planned procedures (packages price themselves) and the estimated cost. Upload and{" "}
                <strong>verify</strong> every required document, then email the request. The status becomes <em>Pre-auth submitted</em>.
              </Step>
              <Step n={4}>
                <strong>Record the insurer's answer.</strong> When the reply arrives (see “Email” below), open the case and record <em>Approved</em> (enter the amount and the insurer's approval code),{" "}
                <em>Query</em> (answer it with documents) or <em>Rejected</em> (revise and resubmit). Treatment starts once it is approved.
              </Step>
              <Step n={5}>
                <strong>During treatment.</strong> Watch the running bill against the approved amount. If it will cross it, press <Menu>Request enhancement</Menu> with the reason and the new amount.
              </Step>
              <Step n={6}>
                <strong>Discharge.</strong> When the patient is discharged, press <Menu>Initiate discharge</Menu>. Only then can billing hand the final bill to insurance. Collect and verify the discharge documents.
              </Step>
              <Step n={7}>
                <strong>Submit the claim.</strong> Once the final bill is ready and all claim documents are verified, email the claim. Reply to any query the insurer raises.
              </Step>
              <Step n={8}>
                <strong>Settlement.</strong> Record the decision (approved, partly approved with deductions, or rejected; you can appeal a rejection). Then record the settlement advice number, the payment with its
                UTR, and <strong>reconcile</strong> it against the bank. Close the claim last.
              </Step>
            </ol>
            <Tip tone="amber">Approval is not payment. A claim is settled only after the money is received and reconciled; a short payment needs an explanation before it can be reconciled.</Tip>
          </div>
        ),
      },
      {
        id: "reimb",
        title: "Reimbursement claim (patient pays first)",
        keywords: "reimbursement patient pays claim pack receipts",
        body: (
          <div className="space-y-3">
            <Tip>Reimbursement: the patient pays the hospital, then claims the money back from the insurer. The hospital prepares the papers; the patient files the claim.</Tip>
            <ol className="space-y-3">
              <Step n={1}>When opening the case choose <strong>Reimbursement</strong>. There is no pre-authorisation; verify the policy, then treatment can start.</Step>
              <Step n={2}>After discharge, record each payment the patient made: <strong>receipt number and amount</strong>. A receipt number can be used once.</Step>
              <Step n={3}>Verify the documents, then press <Menu>Generate / print claim pack</Menu>. It prints the patient and policy details, the itemised bill, receipts and the document checklist, with signature blocks.</Step>
              <Step n={4}>Hand the pack to the patient. When they tell you they filed the claim, press <Menu>Patient has submitted to insurer</Menu> and enter the insurer's claim reference.</Step>
              <Step n={5}>Record the insurer's decision and the payment as usual. The payment is recorded as paid <strong>to the patient</strong>, then reconcile and close.</Step>
            </ol>
          </div>
        ),
      },
      {
        id: "email",
        title: "Email: link the hospital mailbox",
        keywords: "email mail smtp imap mailbox link reply tpa send",
        body: (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              Link the desk's email account once and the application can send pre-auth and claim emails itself and bring the insurer's replies back into the right case.
            </p>
            <ol className="space-y-3">
              <Step n={1}>
                Open {go("insurance_mail_setup", "Insurance → Mail Setup")}. Choose a quick-fill (Gmail, Microsoft 365, Zoho) or type your mail server.
              </Step>
              <Step n={2}>
                Enter the desk's email address and password. Gmail and Microsoft need an <strong>app password</strong> (create it in the account's security page); a normal password will be refused. Fill the
                incoming (IMAP) server too if you want replies to arrive in the application.
              </Step>
              <Step n={3}>Press <Menu>Save mailbox</Menu>, then <Menu>Test connection</Menu>. You should see “Sending works” (and “Receiving works” if IMAP is set).</Step>
              <Step n={4}>
                <strong>Sending:</strong> in any case, open the email box, check the insurer's address, tick the documents and add the real files with <Menu>Add files</Menu>, then send. The email goes out from your
                mailbox with the claim number in the subject (for example <span className="font-mono">[CLM-2026-E12345]</span>) and is recorded on the case.
              </Step>
              <Step n={5}>
                <strong>Receiving:</strong> press <Menu>Check mailbox for replies</Menu>. The application reads your inbox (read-only, mail is not marked as read) and keeps only replies that carry the claim number or reply
                to a mail it sent. Everything else is ignored and never stored. Open the case and record the insurer's decision from the reply.
              </Step>
            </ol>
            <Tip tone="amber">
              Do not remove the <span className="font-mono">[CLM-…]</span> tag from the subject when replying to an insurer; it is how replies find their case. If the mailbox is not linked, the email box still works but only{" "}
              <em>records</em> the email on the case (it says so on the button); use “Open in mail app” to actually send it.
            </Tip>
            <Tip tone="rose">Checklist documents are listed in the email text, but their files are not stored in the application. Attach the files yourself with “Add files”.</Tip>
          </div>
        ),
      },
      {
        id: "amounts",
        title: "The amounts on a case",
        keywords: "amounts money requested authorised billed claimed sanctioned received patient payable deductions",
        body: (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">The case page shows these figures separately. They are never mixed, because each one means something different.</p>
            <dl className="grid sm:grid-cols-2 gap-2">
              {[
                ["Requested", "What the pre-auth asked the insurer to approve (the estimate)."],
                ["Authorised", "What the insurer approved in the pre-auth. Treatment should stay within it, or request an enhancement."],
                ["Hospital bill", "The total of the final bill from billing."],
                ["Claimed", "The part of the bill sent to the insurer (the bill minus what the patient pays)."],
                ["Sanctioned", "What the insurer finally approved on the claim."],
                ["Deductions", "The difference between claimed and sanctioned, with a reason for each part."],
                ["Received", "Money that actually reached the bank. Compare with sanctioned."],
                ["Patient payable", "The part the patient pays: non-payable items, co-pay and shortfalls."],
              ].map(([k, v]) => (
                <div key={k} className="border border-slate-200 rounded-lg p-2.5">
                  <dt className="text-xs font-bold text-slate-900">{k}</dt>
                  <dd className="text-xs text-slate-600 mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ),
      },
      {
        id: "daily",
        title: "Daily routine for the insurance desk",
        keywords: "daily routine checklist morning queue tasks",
        body: (
          <ol className="space-y-3">
            <Step n={1}>Open {go("insurance_emails", "the Email Hub")} and press <Menu>Check mailbox for replies</Menu>. Record every decision that arrived.</Step>
            <Step n={2}>Open {go("insurance_claims", "Claims, Queries & Denials")} and start with <strong>Needs my action</strong>: cases where the next step is yours.</Step>
            <Step n={3}>Answer insurer queries first: they have due dates and the claim is on hold until they are answered.</Step>
            <Step n={4}>Start eligibility checks and pre-auths for new admissions, so approval is there before treatment is far along.</Step>
            <Step n={5}>For discharges today, press <Menu>Initiate discharge</Menu> and verify the discharge documents so billing can hand over the final bill.</Step>
            <Step n={6}>In {go("insurance_settlement", "Settlement & Reconciliation")}, record payments received and reconcile them against the bank statement.</Step>
          </ol>
        ),
      },
      {
        id: "roles",
        title: "Who can do what",
        keywords: "roles permissions access who",
        body: (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">What each person sees depends on their role (set under Administration → Roles). Typical use:</p>
            <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
              <li><strong>Insurance executive:</strong> opens cases, verifies eligibility, prepares and sends pre-auths and claims, answers queries.</li>
              <li><strong>Insurance manager:</strong> reviews escalations, rejections and appeals.</li>
              <li><strong>Billing executive:</strong> raises the final bill and hands it to insurance after discharge.</li>
              <li><strong>Accounts executive:</strong> records payments and reconciles them.</li>
              <li><strong>Doctor / nursing:</strong> provide the diagnosis, clinical notes and discharge summary that the documents need.</li>
            </ul>
            <Tip>If a button is missing or says “Your role does not allow this”, ask an administrator to give your role the matching insurance permission.</Tip>
          </div>
        ),
      },
      {
        id: "print",
        title: "Printing and downloading",
        keywords: "print pdf download case summary form dossier",
        body: (
          <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1.5">
            <li><strong>Case summary:</strong> the Print button on a case prints a clean A4 sheet: patient, policy, amounts, pre-auth, settlement, documents, queries and history, with signature lines.</li>
            <li><strong>Pre-authorisation form:</strong> Print in the pre-auth screen prints all four pages of the form.</li>
            <li><strong>Reimbursement claim pack:</strong> from a reimbursement case, for the patient.</li>
            <li>Printing shows only the document, not the menus or buttons. If a printout looks cut off, check the paper size is A4.</li>
          </ul>
        ),
      },
      {
        id: "problems",
        title: "Messages you may see, and what to do",
        keywords: "error problem message fix cannot blocked stuck",
        body: (
          <dl className="space-y-2">
            {[
              ["“Submit the pre-authorisation request to the insurer before recording its response”", "Send the pre-auth first (email or portal). A decision can only be recorded for a request that was submitted."],
              ["“Insurance case … is not ready for the final bill”", "Billing tried to hand the bill over too early. Finish eligibility, pre-authorisation, treatment and discharge in the case first."],
              ["A step shows an amber “!” and “Not completed”", "A later stage was reached without that stage's work on record. Open the case and complete it."],
              ["“Upload and verify these documents first”", "Required documents must be uploaded and checked (Verify) before a pre-auth or claim can be sent."],
              ["“already has an insurance case in progress”", "A patient can have only one open case. Open the existing one instead of creating another."],
              ["“Explain the short payment before reconciling”", "The bank amount is less than sanctioned. Write why (for example TDS or a deduction), then reconcile."],
              ["“The mail server refused the message”", "Check the mailbox settings and press Test connection. For Gmail/Microsoft use an app password."],
              ["The email button says “(record only)”", "The mailbox is not linked, so nothing is sent. Link it in the Email Hub, or use Open in mail app."],
            ].map(([m, f]) => (
              <div key={m} className="border border-slate-200 rounded-lg p-2.5">
                <dt className="text-xs font-bold text-slate-900">{m}</dt>
                <dd className="text-xs text-slate-600 mt-0.5">{f}</dd>
              </div>
            ))}
          </dl>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNavigate],
  )

  const q = query.trim().toLowerCase()
  const shown = q ? sections.filter((s) => (s.title + " " + s.keywords).toLowerCase().includes(q)) : sections

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]" data-print-root="insurance-guide">
      <div className="max-w-4xl mx-auto px-5 py-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">How to use Insurance</h1>
              <p className="text-sm text-slate-500 mt-0.5">A short guide to the module, in the order a patient's claim really moves.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrintAll(true) // print every section, not only the open one
              setTimeout(() => {
                printPage("Insurance module guide")
                setPrintAll(false)
              }, 150)
            }}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Printer size={13} /> Print guide
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { icon: <ShieldCheck size={16} />, t: "One case per admission", d: "Eligibility → pre-auth → treatment → discharge → claim → settlement." },
            { icon: <Mail size={16} />, t: "Link the mailbox", d: "Send to insurers and receive their replies inside the case." },
            { icon: <Wallet size={16} />, t: "Approved ≠ paid", d: "A claim closes only after the money is received and reconciled." },
          ].map((x) => (
            <div key={x.t} className="bg-white border border-slate-200 rounded-xl p-3 flex gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">{x.icon}</div>
              <div>
                <div className="text-xs font-bold text-slate-900">{x.t}</div>
                <div className="text-[11.5px] text-slate-500 mt-0.5">{x.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="relative" data-no-print>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the guide: pre-auth, reimbursement, email, query, payment…"
            className="w-full pl-9 pr-3 h-10 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="space-y-2.5">
          {shown.length === 0 && (
            <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-2">
              <AlertCircle size={15} /> Nothing matches “{query}”. Try a shorter word.
            </div>
          )}
          {shown.map((s) => {
            const isOpen = q || printAll ? true : open === s.id
            return (
              <section key={s.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen && !q ? "" : s.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-50"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-bold text-slate-900">{s.title}</span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && <div className="px-4 pb-4 pt-1">{s.body}</div>}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
