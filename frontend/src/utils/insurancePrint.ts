import { getBranding } from "../lib/branding"
import { STATUS_META } from "../services/insuranceDb"
import type { ComprehensiveClaimRecord } from "../types/insurance"

const esc = (v: unknown) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
const inr = (n?: number) => (n ? "₹" + Number(n).toLocaleString("en-IN") : "—")
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN") : "—")
const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN") : "—")

function printHtmlInIframe(html: string) {
  const iframe = document.createElement("iframe")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
  const cleanup = () => {
    try {
      document.body.removeChild(iframe)
    } catch {
      /* already removed */
    }
  }
  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(cleanup, 2000)
  }, 350)
}

/** CSS that makes cloned on-screen content behave on paper: no scroll boxes, no fixed layers, no buttons. */
const PAPER_FIXES = `
  @page { size: A4 portrait; margin: 12mm 12mm 14mm 12mm; }
  html, body { background: #fff !important; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-shadow: none !important; }
  .fixed, .sticky { position: static !important; }
  [class*="overflow-"] { overflow: visible !important; }
  [class*="max-h-"], [class*="h-screen"], [class*="min-h-screen"] { max-height: none !important; height: auto !important; min-height: 0 !important; }
  button, [data-no-print], .print\\:hidden, input[type="file"] { display: none !important; }
  .animate-pulse, .animate-spin { animation: none !important; }
  table, tr, img, .avoid-break { page-break-inside: avoid; }
  h1, h2, h3, h4 { page-break-after: avoid; }
`

/**
 * Print one part of the screen on its own, with the application's styles, instead of
 * window.print() (which prints the whole app: sidebar, header, buttons, cut-off scroll areas).
 * Which part: an element marked data-print-root, else the open modal, else the main content.
 */
export function printPage(title: string, root?: Element | null) {
  const modal = Array.from(document.querySelectorAll(".fixed.inset-0")).pop()
  const target =
    root ??
    document.querySelector("[data-print-root]") ??
    (modal ? (modal.firstElementChild as Element | null) ?? modal : null) ??
    document.querySelector("main") ??
    document.body
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join("\n")
  printHtmlInIframe(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}<style>${PAPER_FIXES}</style></head><body><div style="padding:0">${target.outerHTML}</div></body></html>`)
}

/** A clean, one-document summary of an insurance case for the file, the patient or the insurer. */
export function printCaseSummary(c: ComprehensiveClaimRecord) {
  const b = getBranding()
  const logo = b.hospitalLogo ? `<img src="${b.hospitalLogo.src}" alt="" style="height:38px;width:auto" />` : ""
  const meta = STATUS_META[c.status]
  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")

  const money: [string, number | undefined][] = [
    ["Requested (pre-auth)", c.preAuth?.requestedAmount],
    ["Authorised (pre-auth)", c.approvedPreAuthAmount || c.preAuth?.approvedAmount],
    ["Hospital bill", c.totalHospitalBill],
    ["Claimed from insurer", c.finalClaimAmount],
    ["Sanctioned by insurer", c.settlement?.approvedAmount ?? c.approvedClaimAmount],
    ["Deductions", c.settlement?.deductionsAmount],
    ["Received from insurer", c.settlement?.receivedAmount],
    ["Patient payable", c.patientShareAmount],
  ]
  const docs = c.documents
    .map(
      (d) =>
        `<tr><td>${esc(d.documentType)}${d.isMandatory ? " *" : ""}</td><td>${esc(d.category)}</td><td>${d.status === "Verified" ? "Verified" : d.isUploaded ? "Uploaded, not verified" : "Missing"}</td><td>${esc(d.fileName || "")}</td></tr>`,
    )
    .join("")
  const queries = (c.queries ?? [])
    .map((q) => `<tr><td>${esc(q.id)}</td><td>${esc(q.stage)}</td><td>${esc(q.queryText)}</td><td>${esc(q.status)}</td></tr>`)
    .join("")
  const audit = (c.auditTrail ?? [])
    .slice(-40)
    .map((a) => `<tr><td>${esc(stamp(a.timestamp))}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td></tr>`)
    .join("")

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Insurance case ${esc(c.id)} - ${esc(c.patientName)}</title>
<style>
  ${PAPER_FIXES}
  body { font: 10pt/1.45 "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; }
  .lh { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #1e3a8a; padding-bottom:8px; }
  .lh .h { font-size:14pt; font-weight:800; } .lh .s { font-size:9pt; color:#1e3a8a; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
  .pill { display:inline-block; border:1px solid #94a3b8; border-radius:3px; padding:1px 8px; font-size:8pt; font-weight:700; letter-spacing:.4px; text-transform:uppercase; background:#f1f5f9; }
  h2 { font-size:10.5pt; text-transform:uppercase; letter-spacing:.5px; color:#1e3a8a; border-bottom:1px solid #cbd5e1; padding-bottom:2px; margin:14px 0 6px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid #cbd5e1; }
  .cell { padding:4px 8px; border-right:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; min-width:0; }
  .cell:nth-child(4n){border-right:0}
  .k { font-size:7pt; text-transform:uppercase; letter-spacing:.4px; color:#64748b; font-weight:600; } .v { font-weight:600; overflow-wrap:anywhere; }
  table { width:100%; border-collapse:collapse; } th,td { border:1px solid #cbd5e1; padding:4px 6px; font-size:8.5pt; text-align:left; vertical-align:top; } th { background:#f1f5f9; }
  .sign { display:flex; justify-content:space-between; gap:24px; margin-top:34px; } .sign div { width:30%; border-top:1px solid #64748b; padding-top:3px; font-size:8.5pt; }
  .foot { margin-top:14px; font-size:7.5pt; color:#94a3b8; text-align:center; }
</style></head><body>
  <div class="lh"><div style="display:flex;align-items:center;gap:10px">${logo}<div><div class="h">${esc(b.hospitalName || "Hospital")}</div><div class="s">Insurance Desk — Case Summary</div></div></div>
  <div style="text-align:right;font-size:9pt"><div style="font:700 10pt ui-monospace,Consolas,monospace">${esc(c.id)}</div><div>Printed ${new Date().toLocaleDateString("en-IN")}</div><span class="pill">${esc(meta?.label ?? c.status)}</span></div></div>

  <h2>Patient</h2>
  <div class="grid">${rows([
    ["Patient", c.patientName],
    ["UHID", c.patientId],
    ["Age / Sex", [c.age ? c.age + " yrs" : "", c.gender].filter(Boolean).join(" / ") || "—"],
    ["Encounter", `${c.encounterType} · ${c.department}`],
    ["Admitted", day(c.admissionDate)],
    ["Discharged", c.dischargeDate ? day(c.dischargeDate) : "Not yet"],
    ["Treating doctor", c.attendingDoctor || "—"],
    ["Claim type", c.claimType || "Cashless"],
  ])}</div>

  <h2>Policy</h2>
  <div class="grid">${rows([
    ["Insurer", c.policy.insurerName],
    ["TPA", c.policy.tpaName || "—"],
    ["Policy no.", c.policy.policyNumber || "—"],
    ["Member ID", c.policy.memberId || "—"],
    ["Policy holder", c.policy.policyHolderName || "—"],
    ["Valid until", c.policy.validUntil ? day(c.policy.validUntil) : "—"],
    ["Sum insured", inr(c.policy.sumInsured)],
    ["Balance available", inr(c.policy.balanceAvailable)],
  ])}</div>

  <h2>Amounts</h2>
  <div class="grid">${rows(money.map(([k, v]) => [k, inr(v)] as [string, string]))}</div>

  ${
    c.preAuth
      ? `<h2>Pre-authorisation</h2><div class="grid">${rows([
          ["Request no.", c.preAuth.id],
          ["Status", c.preAuth.status],
          ["Diagnosis", c.preAuth.diagnosis + (c.preAuth.icdCode ? ` (${c.preAuth.icdCode})` : "")],
          ["Approval code", c.preAuth.approvalCode || "—"],
        ])}</div>${c.preAuth.procedures?.length ? `<p style="margin:4px 0 0;font-size:9pt"><b>Procedures:</b> ${esc(c.preAuth.procedures.map((p) => `${p.packageCode} ${p.procedureName}`).join("; "))}</p>` : ""}`
      : ""
  }

  ${
    c.settlement
      ? `<h2>Settlement</h2><div class="grid">${rows([
          ["Advice no.", c.settlement.settlementAdviceNo || "—"],
          ["Expected", inr(c.settlement.expectedAmount)],
          ["Received", inr(c.settlement.receivedAmount)],
          ["Reconciliation", c.settlement.reconciliationStatus],
          ["Payment ref (UTR)", c.settlement.paymentReferenceNo || "—"],
          ["Paid on", c.settlement.paymentDate ? day(c.settlement.paymentDate) : "—"],
          ["Paid to", c.settlement.paidTo || "Hospital"],
          ["Bank account", c.settlement.bankAccountName || "—"],
        ])}</div>`
      : ""
  }

  <h2>Documents</h2>
  <table><tr><th>Document</th><th>Source</th><th>Status</th><th>File</th></tr>${docs || '<tr><td colspan="4">None</td></tr>'}</table>

  ${queries ? `<h2>Insurer queries</h2><table><tr><th>No.</th><th>Stage</th><th>Query</th><th>Status</th></tr>${queries}</table>` : ""}

  <h2>History</h2>
  <table><tr><th style="width:24%">When</th><th style="width:20%">By</th><th>Action</th></tr>${audit || '<tr><td colspan="3">No entries</td></tr>'}</table>

  <div class="sign"><div>Insurance executive</div><div>Insurance manager</div><div>Billing / accounts</div></div>
  <div class="foot">Generated from the hospital information system. * mandatory document.</div>
</body></html>`
  printHtmlInIframe(html)
}
