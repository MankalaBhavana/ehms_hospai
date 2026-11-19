import { useState } from "react"
import { CheckCircle2, Mail, Send, Inbox, ShieldCheck } from "lucide-react"
import MailboxSettings from "./MailboxSettings"
import { useNotify } from "./ui"
import type { MailboxSettings as MailboxState } from "../../services/insuranceMail"

/** Insurance → Mail Setup: link the desk's email account (send to insurers, receive their replies). */
export default function InsuranceMailSetup({ onNavigate }: { onNavigate?: (module: string) => void }) {
  const { notify, toastNode } = useNotify()
  const [state, setState] = useState<MailboxState | null>(null)

  const steps = [
    { icon: <Mail size={16} />, t: "1. Enter the desk's email", d: "Use one shared address for the insurance desk, for example insurance@yourhospital.com, so replies are not tied to one person." },
    { icon: <ShieldCheck size={16} />, t: "2. Use an app password", d: "Gmail and Microsoft 365 do not accept the normal password here. Create an app password in the account's security settings and paste that." },
    { icon: <CheckCircle2 size={16} />, t: "3. Test the connection", d: "Press Test connection. “Sending works” is needed to email insurers; “Receiving works” is needed to bring their replies in." },
    { icon: <Send size={16} />, t: "4. Send from any case", d: "Open a case → Send email. It leaves from this mailbox with the claim number in the subject and is recorded on the case." },
    { icon: <Inbox size={16} />, t: "5. Check for replies", d: "In the Email Hub press Check mailbox for replies. Only mail carrying a claim number, or answering a mail we sent, is brought in." },
  ]

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
      {toastNode}
      <div className="max-w-5xl mx-auto px-5 py-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Mail setup</h1>
            <p className="text-sm text-slate-500 mt-0.5">Connect the insurance desk's email so the application can send to insurers and TPAs and receive their replies.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => onNavigate?.("insurance_emails")} className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer">
              Open Email Hub
            </button>
            <button type="button" onClick={() => onNavigate?.("insurance_plan")} className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer">
              Step-by-step plan
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {steps.map((s) => (
            <div key={s.t} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-1.5">{s.icon}</div>
              <div className="text-xs font-bold text-slate-900">{s.t}</div>
              <div className="text-[11.5px] text-slate-500 mt-0.5 leading-snug">{s.d}</div>
            </div>
          ))}
        </div>

        <MailboxSettings notify={notify} onChanged={setState} />

        <div className={`text-sm rounded-xl border px-4 py-3 ${state?.configured ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          {state?.configured
            ? `Mailbox linked: ${state.fromAddress}. ${state.imapHost ? "Replies can be received." : "Add the incoming (IMAP) server to receive replies in the application."}`
            : "No mailbox is linked yet. Until one is, the “Send email” button only records the email on the case (it says “record only”); nothing leaves the application."}
        </div>
      </div>
    </div>
  )
}
