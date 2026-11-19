import { useEffect, useState } from "react"
import { Mail, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { InsuranceMail, type MailboxSettings as Settings } from "../../services/insuranceMail"
import { fieldCls, type Notify } from "./ui"

const PRESETS: { label: string; smtp: [string, number, "ssl" | "starttls"]; imap: [string, number] }[] = [
  { label: "Gmail / Google Workspace", smtp: ["smtp.gmail.com", 587, "starttls"], imap: ["imap.gmail.com", 993] },
  { label: "Microsoft 365 / Outlook", smtp: ["smtp.office365.com", 587, "starttls"], imap: ["outlook.office365.com", 993] },
  { label: "Zoho Mail", smtp: ["smtp.zoho.in", 465, "ssl"], imap: ["imap.zoho.in", 993] },
]

/** Connect the hospital's insurance mailbox: send to insurers from the app and pull their replies back. */
export default function MailboxSettings({ notify, onChanged }: { notify: Notify; onChanged?: (s: Settings) => void }) {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [busy, setBusy] = useState<"" | "save" | "test">("")
  const [testTo, setTestTo] = useState("")
  const [testResult, setTestResult] = useState<{ smtp: { ok: boolean; error?: string }; imap: { ok: boolean | null; error?: string }; testSent?: string } | null>(null)
  const [f, setF] = useState({
    fromAddress: "",
    fromName: "Insurance Desk",
    username: "",
    password: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls" as "ssl" | "starttls" | "none",
    imapHost: "",
    imapPort: 993,
    imapSecurity: "ssl" as "ssl" | "starttls" | "none",
  })

  useEffect(() => {
    InsuranceMail.getSettings()
      .then((s) => {
        setSaved(s)
        onChanged?.(s)
        if (s.configured)
          setF((x) => ({
            ...x,
            fromAddress: s.fromAddress ?? "",
            fromName: s.fromName ?? "Insurance Desk",
            username: s.username ?? "",
            smtpHost: s.smtpHost ?? "",
            smtpPort: s.smtpPort ?? 587,
            smtpSecurity: s.smtpSecurity ?? "starttls",
            imapHost: s.imapHost ?? "",
            imapPort: s.imapPort ?? 993,
            imapSecurity: s.imapSecurity ?? "ssl",
          }))
      })
      .catch(() => setSaved({ configured: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    setBusy("save")
    try {
      const s = await InsuranceMail.saveSettings({ ...f, password: f.password || undefined })
      setSaved(s)
      onChanged?.(s)
      set("password", "")
      notify("Mailbox saved. Press “Test connection” to check it.", "success")
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save the mailbox", "error")
    } finally {
      setBusy("")
    }
  }

  const test = async () => {
    setBusy("test")
    setTestResult(null)
    try {
      const r = await InsuranceMail.test(testTo.trim() || undefined)
      setTestResult(r)
      setSaved(await InsuranceMail.getSettings())
      notify(r.smtp.ok ? "Sending works." : "Sending failed — see the details.", r.smtp.ok ? "success" : "error")
    } catch (e) {
      notify(e instanceof Error ? e.message : "Test failed", "error")
    } finally {
      setBusy("")
    }
  }

  const Row = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      <div className="mt-0.5">{children}</div>
      {hint && <span className="block text-[10.5px] font-normal text-slate-400 mt-0.5">{hint}</span>}
    </label>
  )

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Mail size={17} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            Hospital insurance mailbox
            {saved?.configured ? (
              <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Linked · {saved.fromAddress}</span>
            ) : (
              <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Not linked</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Link the desk's email account so pre-auth and claim emails are sent from the application, and the insurer's replies come back into the right case. The inbox is read-only; only messages that carry a claim tag
            such as <span className="font-mono">[CLM-2026-…]</span> in the subject (or reply to a mail we sent) are kept. Nothing else is stored.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-500 font-semibold">Quick fill:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setF((x) => ({ ...x, smtpHost: p.smtp[0], smtpPort: p.smtp[1], smtpSecurity: p.smtp[2], imapHost: p.imap[0], imapPort: p.imap[1], imapSecurity: "ssl" }))}
            className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Row label="Email address (From) *">
          <input className={fieldCls} value={f.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder="insurance@yourhospital.com" />
        </Row>
        <Row label="Sender name">
          <input className={fieldCls} value={f.fromName} onChange={(e) => set("fromName", e.target.value)} />
        </Row>
        <Row label="Login username" hint="Usually the same as the email address. Leave blank for an internal relay with no login.">
          <input className={fieldCls} value={f.username} onChange={(e) => set("username", e.target.value)} />
        </Row>
        <Row label={saved?.passwordSet ? "Password (saved — leave blank to keep)" : "Password / app password"} hint="Stored encrypted; never shown again. Gmail and Microsoft need an app password.">
          <input type="password" autoComplete="new-password" className={fieldCls} value={f.password} onChange={(e) => set("password", e.target.value)} />
        </Row>
        <Row label="Outgoing server (SMTP) *">
          <input className={fieldCls} value={f.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Port">
            <input className={fieldCls} inputMode="numeric" value={f.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value) || 587)} />
          </Row>
          <Row label="Security">
            <select className={fieldCls} value={f.smtpSecurity} onChange={(e) => set("smtpSecurity", e.target.value as typeof f.smtpSecurity)}>
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL (465)</option>
              <option value="none">None</option>
            </select>
          </Row>
        </div>
        <Row label="Incoming server (IMAP)" hint="Needed to receive replies in the app.">
          <input className={fieldCls} value={f.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.gmail.com" />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Port">
            <input className={fieldCls} inputMode="numeric" value={f.imapPort} onChange={(e) => set("imapPort", Number(e.target.value) || 993)} />
          </Row>
          <Row label="Security">
            <select className={fieldCls} value={f.imapSecurity} onChange={(e) => set("imapSecurity", e.target.value as typeof f.imapSecurity)}>
              <option value="ssl">SSL (993)</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">None</option>
            </select>
          </Row>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== ""} onClick={save} className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer inline-flex items-center gap-1.5">
          {busy === "save" && <Loader2 size={13} className="animate-spin" />} Save mailbox
        </button>
        <input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="Send a test email to… (optional)"
          aria-label="Send a test email to"
          className="px-2.5 h-8.5 w-56 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
        <button type="button" disabled={busy !== "" || !saved?.configured} onClick={test} className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold rounded-lg cursor-pointer inline-flex items-center gap-1.5">
          {busy === "test" && <Loader2 size={13} className="animate-spin" />} Test connection
        </button>
        {testResult && (
          <div className="text-xs flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1 ${testResult.smtp.ok ? "text-emerald-700" : "text-rose-700"}`}>
              {testResult.smtp.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} Sending {testResult.smtp.ok ? (testResult.testSent ? `works — test email sent to ${testResult.testSent}` : "works") : `failed: ${testResult.smtp.error}`}
            </span>
            {testResult.imap.ok !== null && (
              <span className={`inline-flex items-center gap-1 ${testResult.imap.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {testResult.imap.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} Receiving {testResult.imap.ok ? "works" : `failed: ${testResult.imap.error ?? "could not open the inbox"}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
