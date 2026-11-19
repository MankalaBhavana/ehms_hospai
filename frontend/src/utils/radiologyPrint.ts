import { RadiologyStudyRecord } from "../services/billingDb"
import { getBranding } from "../lib/branding"
import { ReconstructedDocument } from "../services/templateExtractionService"
import { substitutePlaceholders, PatientReportContext } from "../components/radiology/ReconstructedReportRenderer"

export interface ImagingCatalogItemMinimal {
  study: string
  indication?: string
  technique?: string
  defaultFindings?: string[]
  defaultImpression?: string[]
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function renderReconstructedDocToHtml(
  doc: ReconstructedDocument,
  context: PatientReportContext
): string {
  const pagesHtml = doc.pages
    .map((page, pIdx) => {
      const elementsHtml = page.elements
        .map((el) => {
          const raw = el.content || ""
          const text = escapeHtml(substitutePlaceholders(raw, context))
          const fontSize = el.fontSize || 10
          const weight = el.fontWeight || "normal"
          const fontStyle = el.fontStyle || "normal"
          const align = el.textAlign || "left"
          const color = el.color || "#0f172a"
          const marginTop = el.marginTop ?? 2
          const marginBottom = el.marginBottom ?? 3

          if (el.type === "heading") {
            return `<div style="font-size: ${fontSize}pt; font-weight: ${weight}; text-align: ${align}; color: ${color}; text-transform: uppercase; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px; line-height: 1.35;">${text}</div>`
          }

          if (el.type === "divider") {
            return `<div style="margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;"><hr style="border: 0; border-top: ${el.border || '1.5px solid #cbd5e1'}; margin: 0;" /></div>`
          }

          if (el.type === "image" && el.src) {
            const alignClass = align === "center" ? "text-align: center;" : align === "right" ? "text-align: right;" : "text-align: left;"
            const imgWidth = el.width ? (typeof el.width === "number" ? `${el.width}px` : el.width) : "140px"
            return `<div style="${alignClass} margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;"><img src="${el.src}" alt="${el.alt || 'Logo'}" style="max-width: 100%; width: ${imgWidth}; height: auto;" /></div>`
          }

          if (el.type === "table" && el.tableData) {
            const borderStyle = el.tableData.borderStyle || "1px solid #cbd5e1"
            const headerCount = el.tableData.headerRowCount || 1
            const rows = (el.tableData.rows || [])
              .map((row, rIdx) => {
                const isHeader = rIdx < headerCount
                const cells = (row.cells || [])
                  .map((cell) => {
                    const cellText = escapeHtml(substitutePlaceholders(cell.content, context))
                    return `<td colspan="${cell.colSpan || 1}" rowspan="${cell.rowSpan || 1}" style="border: ${cell.border || borderStyle}; padding: 4px 6px; text-align: ${cell.align || 'left'}; font-weight: ${cell.bold || isHeader ? 'bold' : 'normal'}; font-style: ${cell.italic ? 'italic' : 'normal'}; background-color: ${cell.backgroundColor || (isHeader ? '#f8fafc' : '#ffffff')}; color: ${cell.color || '#0f172a'}; font-size: 8.5pt; vertical-align: top;">${cellText}</td>`
                  })
                  .join("")
                return `<tr style="background-color: ${isHeader ? '#f8fafc' : '#ffffff'};">${cells}</tr>`
              })
              .join("")
            return `<div style="margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px; overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; border: ${borderStyle};">${rows}</table></div>`
          }

          return `<div style="font-size: ${fontSize}pt; font-weight: ${weight}; font-style: ${fontStyle}; text-align: ${align}; color: ${color}; line-height: 1.5; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px; white-space: pre-wrap;">${text}</div>`
        })
        .join("")

      return `
        <section class="page">
          ${elementsHtml}
        </section>
      `
    })
    .join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Radiology Diagnostic Report - ${escapeHtml(context.study || "Report")}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm 16mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 100%; }
    .page + .page { page-break-before: always; }
    table { page-break-inside: auto; }
    tr, img { page-break-inside: avoid; }
    .print-footer {
      position: fixed;
      left: 0; right: 0; bottom: 0;
      font-size: 7.5pt;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 3px;
      background: #ffffff;
    }
    @media screen {
      body { background: #e2e8f0; }
      .page { width: 210mm; min-height: 297mm; margin: 12px auto; padding: 14mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
      .print-footer { display: none; }
    }
  </style>
</head>
<body>
  ${pagesHtml}
  <div class="print-footer">Radiology Diagnostic Report &bull; ${escapeHtml(context.patientName || "")} &bull; ${escapeHtml(context.accessionNo || "")}</div>
</body>
</html>`
}

export function printRadiologyDocument(
  study: RadiologyStudyRecord,
  defaultCatalog?: ImagingCatalogItemMinimal[],
  reconstructedDoc?: ReconstructedDocument,
  /** The context the on-screen preview used -- so print shows exactly what was previewed,
   *  including findings that live in structured field values rather than study.findings. */
  contextOverride?: PatientReportContext
): void {
  // If reconstructed document layout is supplied, print faithful reconstructed layout
  if (reconstructedDoc) {
    const findingsStr = study.findings && study.findings.length > 0
      ? (Array.isArray(study.findings) ? study.findings.join("\n") : String(study.findings))
      : ""
    const impressionStr = study.impression && study.impression.length > 0
      ? (Array.isArray(study.impression) ? study.impression.join("\n") : String(study.impression))
      : ""

    const context: PatientReportContext = {
      patientName: study.patient,
      mrn: study.mrn,
      umr: study.umr,
      study: study.study,
      modality: study.modality,
      indication: study.indication,
      technique: study.technique,
      comparison: study.comparison,
      findings: findingsStr,
      impression: impressionStr,
      radiologist: study.radiologist || "Consultant Radiologist",
      referringDoctor: study.provider,
      date: study.signedAt || study.finalizedAt || study.ordered || new Date().toLocaleDateString("en-IN"),
      accessionNo: study.accessionNo,
      billingStatus: study.paymentStatus || "Settled",
    }

    const effective: PatientReportContext = contextOverride ? { ...context, ...contextOverride } : context
    let html = renderReconstructedDocToHtml(reconstructedDoc, effective)
    // Templates without {{findings}} / {{impression}} slots used to print without the
    // radiologist's actual findings. Append them so nothing entered is lost.
    const docJson = JSON.stringify(reconstructedDoc)
    const hasSlot = (name: string) => new RegExp("\\{\\{\\s*" + name + "\\s*\\}\\}", "i").test(docJson)
    const toText = (v?: string | string[]) => (Array.isArray(v) ? v.join("\n") : v || "").trim()
    const missing: { title: string; body: string }[] = []
    if (!hasSlot("findings") && toText(effective.findings)) missing.push({ title: "Findings", body: toText(effective.findings) })
    if (!hasSlot("impression") && toText(effective.impression)) missing.push({ title: "Impression", body: toText(effective.impression) })
    if (missing.length) {
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      const block = missing
        .map(
          (m) =>
            `<div style="margin:10px 16mm;font:10pt/1.5 Arial,sans-serif"><strong style="text-transform:uppercase">${m.title}</strong><div style="white-space:pre-wrap">${esc(m.body)}</div></div>`,
        )
        .join("")
      html = html.replace("</body>", `${block}</body>`)
    }

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "0"
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) return

    doc.open()
    doc.write(html)
    doc.close()

    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        try {
          document.body.removeChild(iframe)
        } catch {}
      }, 2000)
    }, 300)
    return
  }

  const catalogMatch = defaultCatalog?.find((c) => c.study === study.study)
  const branding = getBranding()
  const hospitalName = escapeHtml(branding.hospitalName || "Hospital")
  const logoHtml = branding.hospitalLogo
    ? `<img src="${branding.hospitalLogo.src}" alt="" style="height:42px;width:auto;" />`
    : ""

  // Structured field values (template reports) -> findings / impression
  let findingsFromFieldValues = ""
  let impressionFromFieldValues = ""
  if (study.fieldValues && typeof study.fieldValues === "object") {
    const list: string[] = []
    Object.entries(study.fieldValues).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) {
        const keyLower = k.toLowerCase()
        if (keyLower.includes("impression") || keyLower.includes("conclusion")) {
          if (!impressionFromFieldValues) impressionFromFieldValues = v.trim()
        } else {
          const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim()
          list.push(`${label}: ${v.trim()}`)
        }
      }
    })
    if (list.length > 0) findingsFromFieldValues = list.join("\n")
  }

  const toLines = (v: unknown): string[] =>
    (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => String(x).trim()).filter(Boolean)

  // Only what was actually reported (template defaults only if the radiologist left it blank).
  const findingLines = toLines(study.findings).length
    ? toLines(study.findings)
    : toLines(findingsFromFieldValues).length
      ? toLines(findingsFromFieldValues)
      : toLines(catalogMatch?.defaultFindings)
  const impressionLines = toLines(study.impression).length
    ? toLines(study.impression)
    : toLines(impressionFromFieldValues).length
      ? toLines(impressionFromFieldValues)
      : toLines(catalogMatch?.defaultImpression)

  const v = (x: unknown, fallback = "—") => escapeHtml(String(x ?? "").trim() || fallback)
  const patientName = v(study.patient, "Patient")
  const accessionNo = v(study.accessionNo)
  const umr = v(study.umr || study.mrn)
  const encounterId = v(study.encounterId)
  const referringDoc = v(study.provider)
  const department = v(study.department)
  const studyTitle = v(study.study, "Imaging Study")
  const modality = v(study.modality)
  const suite = v(study.room)
  const indication = v(study.indication || catalogMatch?.indication, "Not specified")
  const technique = v(study.technique || catalogMatch?.technique, "Standard protocol")
  const comparison = (study as any).comparison ? v((study as any).comparison) : ""
  const dateStr = v(study.signedAt || study.finalizedAt || study.ordered || new Date().toLocaleDateString("en-IN"))
  const statusRaw = String(study.status || study.reportStatus || "").toUpperCase()
  const isFinal = /FINAL|SIGNED/.test(statusRaw)
  const statusStr = escapeHtml(isFinal ? "FINAL REPORT" : statusRaw ? `${statusRaw} (PRELIMINARY)` : "PRELIMINARY")
  const ageSex = [
    (study as any).age ? `${(study as any).age} yrs` : "",
    (study as any).gender || (study as any).sex || "",
  ]
    .filter(Boolean)
    .join(" / ")
  const techName = v(study.technician)
  const radName = v(study.radiologist || study.finalizedBy, "Consultant Radiologist")
  const radReg = (study as any).radiologistRegNo ? v((study as any).radiologistRegNo) : ""
  const techNotes = String(study.operationalNotes || study.technicianNotes || (study as any).operatorNotes || "").trim()

  const cell = (label: string, value: string, mono = false) =>
    `<div class="cell"><div class="lbl">${label}</div><div class="val${mono ? " mono" : ""}">${value}</div></div>`

  const listHtml = (lines: string[], numbered: boolean) =>
    lines.length === 0
      ? `<p class="muted">Not recorded.</p>`
      : numbered
        ? `<ol>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\d+[.)]\s*/, ""))}</li>`).join("")}</ol>`
        : lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Radiology Report - ${accessionNo} - ${patientName}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm 16mm 14mm; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: #fff; color: #0f172a;
      font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 10pt; line-height: 1.5;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    table.sheet { width: 100%; border-collapse: collapse; }
    table.sheet > thead { display: table-header-group; }
    table.sheet > tfoot { display: table-footer-group; }
    table.sheet td { padding: 0; vertical-align: top; }

    .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #1e3a8a; }
    .lh-left { display: flex; align-items: center; gap: 10px; }
    .hosp { font-size: 14pt; font-weight: 800; color: #0f172a; line-height: 1.2; }
    .dept { font-size: 9pt; font-weight: 600; color: #1e3a8a; letter-spacing: .4px; text-transform: uppercase; }
    .lh-right { text-align: right; font-size: 8.5pt; color: #475569; }
    .lh-right .acc { font: 700 9.5pt ui-monospace, Consolas, monospace; color: #0f172a; }
    .badge { display: inline-block; margin-top: 3px; padding: 1px 8px; border: 1px solid #94a3b8; border-radius: 3px; font-size: 7.5pt; font-weight: 700; letter-spacing: .5px; color: ${isFinal ? "#166534" : "#92400e"}; background: ${isFinal ? "#dcfce7" : "#fef3c7"}; }

    .patient { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #cbd5e1; margin: 8px 0 0; }
    .cell { padding: 4px 8px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; min-width: 0; }
    .cell:nth-child(4n) { border-right: 0; }
    .patient .cell:nth-last-child(-n+4) { border-bottom: 0; }
    .lbl { font-size: 7pt; text-transform: uppercase; letter-spacing: .4px; color: #64748b; font-weight: 600; }
    .val { font-size: 9.5pt; font-weight: 600; color: #0f172a; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }

    .exam { margin-top: 12px; padding: 8px 10px; border-left: 4px solid #1e3a8a; background: #f1f5f9; page-break-inside: avoid; }
    .exam h2 { margin: 0 0 4px; font-size: 12pt; text-transform: uppercase; color: #0f172a; }
    .exam dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 2px 10px; font-size: 9pt; }
    .exam dt { color: #64748b; font-weight: 600; }
    .exam dd { margin: 0; }

    h3 { margin: 14px 0 5px; font-size: 10.5pt; text-transform: uppercase; letter-spacing: .6px; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; page-break-after: avoid; }
    .body p { margin: 0 0 5px; text-align: justify; }
    .body ol { margin: 0; padding-left: 20px; }
    .body li { margin-bottom: 4px; }
    .muted { color: #94a3b8; font-style: italic; }
    .impression { margin-top: 14px; border: 1px solid #1e3a8a; page-break-inside: avoid; }
    .impression .hd { background: #1e3a8a; color: #fff; padding: 3px 10px; font-size: 9.5pt; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
    .impression .bd { padding: 8px 12px; font-weight: 600; }
    .impression ol { margin: 0; padding-left: 20px; }
    .impression li { margin-bottom: 3px; }
    .tech { margin-top: 10px; font-size: 8.5pt; color: #475569; page-break-inside: avoid; }

    .signs { display: flex; justify-content: space-between; gap: 24px; margin-top: 28px; page-break-inside: avoid; }
    .sign { width: 46%; }
    .sign .line { border-top: 1px solid #64748b; margin-bottom: 4px; height: 26px; }
    .sign .nm { font-weight: 700; font-size: 10pt; }
    .sign .rl { font-size: 8.5pt; color: #475569; }
    .sign.r { text-align: right; }
    .note { margin-top: 14px; font-size: 7.5pt; color: #94a3b8; text-align: center; page-break-inside: avoid; }
    .foot { font-size: 7.5pt; color: #94a3b8; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 3px; }
  </style>
</head>
<body>
  <table class="sheet">
    <thead><tr><td>
      <div class="letterhead">
        <div class="lh-left">
          ${logoHtml}
          <div>
            <div class="hosp">${hospitalName}</div>
            <div class="dept">Department of Radiology &amp; Imaging</div>
          </div>
        </div>
        <div class="lh-right">
          <div class="acc">ACC ${accessionNo}</div>
          <div>Exam date: ${dateStr}</div>
          <span class="badge">${statusStr}</span>
        </div>
      </div>
    </td></tr></thead>

    <tfoot><tr><td>
      <div class="foot"><span>${patientName} &bull; ${umr}</span><span>${studyTitle} &bull; ${accessionNo}</span></div>
    </td></tr></tfoot>

    <tbody><tr><td>
      <div class="patient">
        ${cell("Patient", patientName)}
        ${cell("Age / Sex", escapeHtml(ageSex || "—"))}
        ${cell("UMR / MRN", umr, true)}
        ${cell("Visit No", encounterId, true)}
        ${cell("Referred by", referringDoc)}
        ${cell("Department", department)}
        ${cell("Modality", modality)}
        ${cell("Suite", suite)}
      </div>

      <div class="exam">
        <h2>${studyTitle}</h2>
        <dl>
          <dt>Indication</dt><dd>${indication}</dd>
          <dt>Technique</dt><dd>${technique}</dd>
          ${comparison ? `<dt>Comparison</dt><dd>${comparison}</dd>` : ""}
        </dl>
      </div>

      <h3>Findings</h3>
      <div class="body">${listHtml(findingLines, false)}</div>

      <div class="impression">
        <div class="hd">Impression</div>
        <div class="bd">${listHtml(impressionLines, impressionLines.length > 1)}</div>
      </div>

      ${techNotes ? `<div class="tech"><strong>Technologist notes:</strong> ${escapeHtml(techNotes)}</div>` : ""}

      <div class="signs">
        <div class="sign">
          <div class="line"></div>
          <div class="nm">${techName}</div>
          <div class="rl">Technologist</div>
        </div>
        <div class="sign r">
          <div class="line"></div>
          <div class="nm">${radName}</div>
          <div class="rl">Consultant Radiologist${radReg ? ` &bull; Reg. No ${radReg}` : ""}</div>
        </div>
      </div>

      <div class="note">
        Electronically generated report. Please correlate clinically. Report ID ${escapeHtml(String(study.id ?? ""))}.
      </div>
    </td></tr></tbody>
  </table>
</body>
</html>`

  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => {
      try {
        document.body.removeChild(iframe)
      } catch {}
    }, 2000)
  }, 300)
}
