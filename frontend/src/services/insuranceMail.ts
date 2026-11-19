/** Client for the hospital's insurance mailbox (SMTP send + IMAP replies), see backend modules/insurance/mail.py. */
import { apiFetch } from "../lib/api"

export interface MailboxSettings {
  configured: boolean
  fromAddress?: string
  fromName?: string
  username?: string
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: "ssl" | "starttls" | "none"
  imapHost?: string
  imapPort?: number
  imapSecurity?: "ssl" | "starttls" | "none"
  imapFolder?: string
  passwordSet?: boolean
  lastTest?: { at: string; smtp: boolean | null; imap: boolean | null } | null
}

export interface InboundMail {
  id: string
  caseId: string
  from: string
  subject: string
  body: string
  attachments: string[]
  at: string | null
}

export interface OutgoingAttachment {
  name: string
  type: string
  contentBase64: string
}

export const InsuranceMail = {
  getSettings: () => apiFetch<MailboxSettings>("/api/insurance-mail/settings"),

  saveSettings: (s: Omit<MailboxSettings, "configured" | "passwordSet" | "lastTest"> & { password?: string }) =>
    apiFetch<MailboxSettings>("/api/insurance-mail/settings", { method: "PUT", body: JSON.stringify(s) }),

  test: (to?: string) =>
    apiFetch<{ smtp: { ok: boolean; error?: string }; imap: { ok: boolean | null; error?: string }; testSent?: string }>("/api/insurance-mail/test", {
      method: "POST",
      body: JSON.stringify({ to: to || undefined }),
    }),

  send: (m: { caseId: string; to: string; cc?: string; subject: string; body: string; attachments?: OutgoingAttachment[] }) =>
    apiFetch<{ ok: boolean; messageId: string; subject: string; from: string; attachments: string[] }>("/api/insurance-mail/send", {
      method: "POST",
      body: JSON.stringify(m),
    }),

  /** Reads the inbox (read-only). Only replies that belong to a case come back. */
  sync: (days = 14) =>
    apiFetch<{ scanned: number; ignored: number; new: InboundMail[] }>("/api/insurance-mail/sync", {
      method: "POST",
      body: JSON.stringify({ days }),
    }),

  /** File -> base64 for an attachment. */
  async toAttachment(file: File): Promise<OutgoingAttachment> {
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ""
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { name: file.name, type: file.type || "application/octet-stream", contentBase64: btoa(bin) }
  },
}
