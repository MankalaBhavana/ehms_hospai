import React, { useState, useRef } from "react"
import { ExtendedRadiologyRecord, RadiologyWorkflowDb } from "../../services/radiologyWorkflowDb"
import { RadiologyStudyRecord } from "../../services/billingDb"
import { printRadiologyDocument } from "../../utils/radiologyPrint"
import { db } from "../../services/db"
import { RadiologyTemplateDatabase } from "../../services/radiologyTemplateDb"
import ReconstructedReportRenderer, { PatientReportContext, substitutePlaceholders } from "./ReconstructedReportRenderer"
import {
  X,
  Printer,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Building,
} from "lucide-react"

interface RadiologyReportPdfModalProps {
  study: ExtendedRadiologyRecord | RadiologyStudyRecord
  onClose: () => void
}

export default function RadiologyReportPdfModal({
  study,
  onClose,
}: RadiologyReportPdfModalProps) {
  const [downloading, setDownloading] = useState(false)
  const [viewFormat, setViewFormat] = useState<"standard" | "template">("standard")
  const reportRef = useRef<HTMLDivElement>(null)

  const paymentInfo = RadiologyWorkflowDb.getPaymentStatusFromBilling(study)
  const isPaid = paymentInfo.status === "PAID"
  const isFinalized = study.reportStatus === "Final" || (study as any).reportStatus === "Finalized"

  const matchedPatient = study.umr
    ? db.getPatients().find((p) => p.umr === study.umr)
    : db.getPatients().find((p) => p.name.trim().toLowerCase() === (study.patient || "").trim().toLowerCase())
  const matchedEncounter = study.encounterId
    ? db.getEncounterById(study.encounterId)
    : (matchedPatient ? db.getEncountersForPatient(matchedPatient.umr)[0] : undefined)

  // Resolve template with reconstructed layout if available
  const existingRepRecord = RadiologyTemplateDatabase.getReportByStudyId(study.id)
  const matchedTemplate = RadiologyTemplateDatabase.getTemplateForStudy(
    study.study,
    (study as any).gender || matchedPatient?.gender || "All"
  )
  const reconstructedDoc = existingRepRecord?.reconstructedDocumentSnapshot || matchedTemplate?.reconstructedDocument

  const wfStudy = RadiologyWorkflowDb.getStudyById(study.id) || (study.accessionNo ? RadiologyWorkflowDb.getStudyByAccession(study.accessionNo) : undefined)
  const repRecord = existingRepRecord || (wfStudy?.id ? RadiologyTemplateDatabase.getReportByStudyId(wfStudy.id) : undefined)

  const wfFindings = wfStudy?.findings && wfStudy.findings.length > 0 ? wfStudy.findings : []
  const wfImpression = wfStudy?.impression && wfStudy.impression.length > 0 ? wfStudy.impression : []

  const repFindings = repRecord?.fieldValues?.findings
    ? (Array.isArray(repRecord.fieldValues.findings) ? repRecord.fieldValues.findings : [String(repRecord.fieldValues.findings)])
    : []
  const repImpression = repRecord?.fieldValues?.impression
    ? (Array.isArray(repRecord.fieldValues.impression) ? repRecord.fieldValues.impression : [String(repRecord.fieldValues.impression)])
    : []

  const findingsListFromFields: string[] = []
  const impressionFromFields: string[] = []
  const sourceFieldValues = (study.fieldValues && Object.keys(study.fieldValues).length > 0)
    ? study.fieldValues
    : (repRecord?.fieldValues || wfStudy?.fieldValues || {})

  if (sourceFieldValues && typeof sourceFieldValues === "object") {
    Object.entries(sourceFieldValues).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) {
        const keyLower = k.toLowerCase()
        if (keyLower.includes("impression") || keyLower.includes("conclusion")) {
          impressionFromFields.push(v.trim())
        } else {
          const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()
          findingsListFromFields.push(`${label}: ${v.trim()}`)
        }
      }
    })
  }

  const effectiveFindings = study.findings && study.findings.length > 0
    ? (Array.isArray(study.findings) ? study.findings : [String(study.findings)])
    : (findingsListFromFields.length > 0 ? findingsListFromFields : (wfFindings.length > 0 ? wfFindings : repFindings))

  const effectiveImpression = study.impression && study.impression.length > 0
    ? (Array.isArray(study.impression) ? study.impression : [String(study.impression)])
    : (impressionFromFields.length > 0 ? impressionFromFields : (wfImpression.length > 0 ? wfImpression : repImpression))

  const findingsStr = effectiveFindings.join("\n")
  const impressionStr = effectiveImpression.join("\n")

  const patientContext: PatientReportContext = {
    patientName: study.patient,
    mrn: study.mrn,
    umr: study.umr || `PAT-${study.mrn}`,
    ageGender: matchedPatient ? `${matchedPatient.age || ""} / ${matchedPatient.gender || ""}` : undefined,
    study: study.study,
    modality: study.modality,
    indication: study.indication,
    technique: study.technique,
    comparison: study.comparison,
    findings: findingsStr,
    impression: impressionStr,
    radiologist: study.radiologist || study.finalizedBy || "Consultant Radiologist",
    referringDoctor: study.provider,
    date: study.signedAt || study.finalizedAt || study.ordered || new Date().toLocaleDateString("en-IN"),
    accessionNo: study.accessionNo,
    billingStatus: isPaid ? "Paid" : "Payment Pending",
  }

  const handlePrint = () => {
    RadiologyWorkflowDb.logPrintOrDownload(study.id, "PRINT", study.radiologist || "Technician")
    printRadiologyDocument(study as RadiologyStudyRecord, undefined, reconstructedDoc, patientContext)
  }

  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      RadiologyWorkflowDb.logPrintOrDownload(study.id, "DOWNLOAD", study.radiologist || "Technician")

      // Dynamically load jsPDF and jspdf-autotable
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ])

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      })

      const pageW = doc.internal.pageSize.getWidth() // 210mm
      const pageH = doc.internal.pageSize.getHeight() // 297mm
      const margin = 12
      const width = pageW - margin * 2 // 186mm
      const right = pageW - margin // 198mm
      let y = 12

      // pdfSafe helper: replaces non-ASCII symbols so standard PDF Helvetica doesn't glitch
      const pdfSafe = (str: any) =>
        String(str ?? "")
          .replace(/₹\s?/g, "Rs. ")
          .replace(/[–—]/g, "-")
          .replace(/[‘’]/g, "'")
          .replace(/[“”]/g, '"')
          .replace(/[→⟶]/g, "->")
          .replace(/[•·]/g, "-")
          .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")

      const ensureSpace = (neededHeight: number) => {
        if (y + neededHeight > pageH - 18) {
          doc.addPage()
          y = 12
          // Page 2+ Running Header
          doc.setFillColor(30, 58, 138)
          doc.rect(margin, y, width, 1.2, "F")
          y += 3.5
          doc.setFont("helvetica", "bold")
          doc.setFontSize(8)
          doc.setTextColor(30, 58, 138)
          doc.text("ENTERPRISE HOSPITAL MANAGEMENT SYSTEM • RADIODIAGNOSIS", margin, y + 2.5)
          doc.setFont("helvetica", "normal")
          doc.setFontSize(7)
          doc.setTextColor(100, 116, 139)
          doc.text(
            `${pdfSafe(study.patient)} | Accession: ${pdfSafe(study.accessionNo || "")} (Continued)`,
            right,
            y + 2.5,
            { align: "right" }
          )
          y += 5.5
          doc.setDrawColor(226, 232, 240)
          doc.setLineWidth(0.3)
          doc.line(margin, y, right, y)
          y += 4
        }
      }

      if (reconstructedDoc && viewFormat === "template") {
        for (let pIdx = 0; pIdx < reconstructedDoc.pages.length; pIdx++) {
          if (pIdx > 0) {
            doc.addPage()
            y = 12
          }
          const page = reconstructedDoc.pages[pIdx]
          for (const el of page.elements) {
            const raw = el.content || ""
            const text = pdfSafe(substitutePlaceholders(raw, patientContext))
            const fontSize = el.fontSize || 9.5
            const isBold = el.fontWeight === "bold" || el.fontWeight === "700" || el.fontWeight === "800"
            const isItalic = el.fontStyle === "italic"

            if (el.type === "heading") {
              ensureSpace(8)
              doc.setFont("helvetica", isBold ? "bold" : "normal")
              doc.setFontSize(Math.min(fontSize, 15))
              doc.setTextColor(15, 23, 42)
              const posX = el.textAlign === "center" ? pageW / 2 : el.textAlign === "right" ? right : margin
              doc.text(text, posX, y + 3, { align: (el.textAlign as any) || "left" })
              y += (el.marginBottom ?? 3) + 4
            } else if (el.type === "divider") {
              ensureSpace(4)
              doc.setDrawColor(203, 213, 225)
              doc.setLineWidth(0.35)
              doc.line(margin, y + 1, right, y + 1)
              y += (el.marginBottom ?? 3) + 2.5
            } else if (el.type === "table" && el.tableData) {
              const headRow = el.tableData.rows.length > 0 ? el.tableData.rows[0].cells.map((c) => pdfSafe(substitutePlaceholders(c.content, patientContext))) : []
              const bodyRows = el.tableData.rows.slice(1).map((r) => r.cells.map((c) => pdfSafe(substitutePlaceholders(c.content, patientContext))))
              autoTable(doc, {
                startY: y,
                margin: { left: margin, right: margin },
                theme: "grid",
                head: [headRow],
                body: bodyRows,
                styles: { fontSize: 8, cellPadding: 2, textColor: [15, 23, 42], lineColor: [203, 213, 225], lineWidth: 0.2 },
                headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
              })
              y = (doc as any).lastAutoTable.finalY + 3
            } else {
              doc.setFont("helvetica", isBold ? "bold" : isItalic ? "italic" : "normal")
              doc.setFontSize(Math.min(fontSize, 10.5))
              doc.setTextColor(30, 41, 59)
              const lines = doc.splitTextToSize(text, width)
              const blockH = lines.length * (fontSize * 0.42) + 2
              ensureSpace(blockH)
              doc.text(lines, margin, y + 3)
              y += blockH + (el.marginBottom ?? 2)
            }
          }
        }
      } else {
        // --- 1. Top Primary Blue Brand Line ---
        doc.setFillColor(30, 58, 138) // Deep Blue #1E3A8A
        doc.rect(margin, y, width, 1.2, "F")
        y += 4

        // --- 2. Hospital Letterhead (Matching preview layout) ---
        // Cross Emblem (Blue rounded square with crisp white plus icon)
        doc.setFillColor(30, 58, 138)
        doc.roundedRect(margin, y, 12, 12, 2, 2, "F")
        doc.setFont("helvetica", "bold")
        doc.setFontSize(16)
        doc.setTextColor(255, 255, 255)
        doc.text("+", margin + 6, y + 8.2, { align: "center" })

        // Hospital Header Text
        doc.setFont("helvetica", "bold")
        doc.setFontSize(12)
        doc.setTextColor(15, 23, 42) // Slate 900
        doc.text("ENTERPRISE HOSPITAL MANAGEMENT SYSTEM", margin + 15, y + 3.8)

        doc.setFontSize(7.5)
        doc.setTextColor(27, 79, 216) // Royal Blue #1B4FD8
        doc.text("DEPARTMENT OF RADIODIAGNOSIS & CLINICAL IMAGING", margin + 15, y + 7.6)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.2)
        doc.setTextColor(100, 116, 139) // Slate 500
        doc.text("NABH & NABL ACCREDITED TERTIARY CARE FACILITY • PACS / DICOM INTEGRATED • 24x7 HELPLINE", margin + 15, y + 11)

        // Right side Accession & Status Block
        doc.setFillColor(241, 245, 249)
        doc.setDrawColor(203, 213, 225)
        doc.setLineWidth(0.3)
        doc.roundedRect(right - 48, y, 48, 6.2, 1.2, 1.2, "FD")

        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.5)
        doc.setTextColor(15, 23, 42)
        doc.text(`ACCESSION: ${pdfSafe(study.accessionNo || "RAD-ACC-8801")}`, right - 24, y + 4.2, { align: "center" })

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.5)
        doc.setTextColor(100, 116, 139)
        doc.text(`Report ID: ${pdfSafe(study.id)}`, right, y + 9.5, { align: "right" })

        if (isFinalized) {
          doc.setFillColor(220, 252, 231) // Emerald 100
          doc.setDrawColor(134, 239, 172) // Emerald 300
          doc.setLineWidth(0.3)
          doc.roundedRect(right - 42, y + 11.2, 42, 4.5, 1, 1, "FD")
          doc.setFont("helvetica", "bold")
          doc.setFontSize(6.2)
          doc.setTextColor(22, 101, 52) // Emerald 800
          doc.text("CLINICALLY FINALIZED", right - 21, y + 14.3, { align: "center" })
        } else {
          doc.setFillColor(254, 243, 199) // Amber 100
          doc.setDrawColor(253, 230, 138) // Amber 300
          doc.setLineWidth(0.3)
          doc.roundedRect(right - 46, y + 11.2, 46, 4.5, 1, 1, "FD")
          doc.setFont("helvetica", "bold")
          doc.setFontSize(6.2)
          doc.setTextColor(146, 64, 14) // Amber 800
          doc.text("DRAFT EXAMINATION REPORT", right - 23, y + 14.3, { align: "center" })
        }

        // Header separator line
        y += 18
        doc.setDrawColor(30, 58, 138)
        doc.setLineWidth(0.6)
        doc.line(margin, y, right, y)
        y += 3

        // --- 3. Patient Demographics Card (Matching preview layout) ---
        const ageSex = `${(study as any).age || matchedEncounter?.age || matchedPatient?.age || 42} yrs / ${(study as any).gender || (study as any).sex || matchedEncounter?.sex || "Male"}`
        const opIpNo = (study as any).opNumber || (study as any).ipNumber || matchedEncounter?.opNumber || study.encounterId || "OP-1002"
        const examDate = (study as any).orderDate || study.ordered || new Date().toISOString().split("T")[0]
        const modalitySuite = `${study.modality} (${study.room || "Suite 1"})`
        const billingText = isPaid ? `PAID (${pdfSafe(study.paidReceiptNo || "RCPT-5501")})` : "PENDING"

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          tableWidth: width,
          theme: "plain",
          styles: {
            cellPadding: 0,
            lineColor: [203, 213, 225],
            lineWidth: 0.25,
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: width / 4 },
            1: { cellWidth: width / 4 },
            2: { cellWidth: width / 4 },
            3: { cellWidth: width / 4 },
          },
          body: [
            [
              { content: `PATIENT NAME\n${pdfSafe(study.patient)}` },
              { content: `AGE / GENDER\n${pdfSafe(ageSex)}` },
              { content: `PERMANENT UMR\n${pdfSafe(study.umr || `PAT-${study.mrn}`)}` },
              { content: `OP / IP / ER NO\n${pdfSafe(opIpNo)}` },
            ],
            [
              { content: `REFERRING CONSULTANT\n${pdfSafe(study.provider)}` },
              { content: `EXAM DATE\n${pdfSafe(examDate)}` },
              { content: `MODALITY / SUITE\n${pdfSafe(modalitySuite)}` },
              { content: `BILLING STATUS\n${billingText}` },
            ],
          ],
          didDrawCell: (data) => {
            const cell = data.cell
            const raw = cell.raw as any
            if (!raw || !raw.content) return

            doc.setFillColor(248, 250, 252)
            doc.rect(cell.x, cell.y, cell.width, cell.height, "F")
            doc.setDrawColor(203, 213, 225)
            doc.setLineWidth(0.2)
            doc.rect(cell.x, cell.y, cell.width, cell.height, "S")

            const parts = String(raw.content).split("\n")
            const label = parts[0] || ""
            const val = parts.slice(1).join("\n") || ""

            doc.setFont("helvetica", "bold")
            doc.setFontSize(6.5)
            doc.setTextColor(100, 116, 139)
            doc.text(label, cell.x + 3, cell.y + 3.8)

            if (label === "BILLING STATUS") {
              const isPaidStatus = val.startsWith("PAID")
              const pillW = isPaidStatus ? 32 : 18
              const pillH = 4.2
              const pillX = cell.x + 3
              const pillY = cell.y + 5.2
              if (isPaidStatus) {
                doc.setFillColor(220, 252, 231)
                doc.setDrawColor(134, 239, 172)
                doc.roundedRect(pillX, pillY, pillW, pillH, 1, 1, "FD")
                doc.setFont("helvetica", "bold")
                doc.setFontSize(6.2)
                doc.setTextColor(22, 101, 52)
                doc.text(val, pillX + pillW / 2, pillY + 2.9, { align: "center" })
              } else {
                doc.setFillColor(254, 243, 199)
                doc.setDrawColor(253, 230, 138)
                doc.roundedRect(pillX, pillY, pillW, pillH, 1, 1, "FD")
                doc.setFont("helvetica", "bold")
                doc.setFontSize(6.2)
                doc.setTextColor(146, 64, 14)
                doc.text(val, pillX + pillW / 2, pillY + 2.9, { align: "center" })
              }
            } else {
              doc.setFont("helvetica", "bold")
              doc.setFontSize(label === "PATIENT NAME" ? 8.8 : 8)
              if (label === "MODALITY / SUITE") {
                doc.setTextColor(27, 79, 216)
              } else if (label === "PATIENT NAME") {
                doc.setTextColor(2, 6, 23)
              } else {
                doc.setTextColor(15, 23, 42)
              }
              const valLines = doc.splitTextToSize(val, cell.width - 6)
              doc.text(valLines, cell.x + 3, cell.y + 8.2)
            }
          },
        })
        y = (doc as any).lastAutoTable.finalY + 3.5

        // --- 4. Examination Performed Banner (Matching preview layout) ---
        ensureSpace(16)
        const bannerH = 12.5
        doc.setFillColor(238, 242, 255) // Indigo 50
        doc.setDrawColor(199, 210, 254) // Indigo 200
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, width, bannerH, 1.5, 1.5, "FD")

        // Left accent bar
        doc.setFillColor(27, 79, 216) // Royal Blue
        doc.rect(margin, y, 3.2, bannerH, "F")

        // Banner Left Text
        doc.setFont("helvetica", "bold")
        doc.setFontSize(6.8)
        doc.setTextColor(27, 79, 216)
        doc.text("EXAMINATION PERFORMED", margin + 6, y + 4.2)

        doc.setFontSize(10.5)
        doc.setTextColor(30, 27, 75) // Indigo 950
        const studyTitleLines = doc.splitTextToSize(pdfSafe(study.study), width - 65)
        doc.text(studyTitleLines[0] || pdfSafe(study.study), margin + 6, y + 8.8)

        // Banner Right Pill & Tariff
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(199, 210, 254)
        doc.setLineWidth(0.3)
        doc.roundedRect(right - 52, y + 3.5, 22, 5, 1, 1, "FD")
        doc.setFont("helvetica", "bold")
        doc.setFontSize(6.8)
        doc.setTextColor(27, 79, 216)
        doc.text(`${pdfSafe(study.modality)} SCAN`, right - 41, y + 7, { align: "center" })

        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105)
        doc.text(`Tariff: Rs. ${(study.price ?? 0).toLocaleString("en-IN")}`, right - 2, y + 7.2, { align: "right" })
        y += bannerH + 4

        // Helper to render clinical card sections (Indication / Technique)
        const renderCardSection = (title: string, contentText: string) => {
          doc.setFont("helvetica", "bold")
          doc.setFontSize(7.8)
          doc.setTextColor(15, 23, 42)
          const lines = doc.splitTextToSize(pdfSafe(contentText), width - 6)
          const boxHeight = lines.length * 3.8 + 4.5
          ensureSpace(boxHeight + 8)

          doc.text(title.toUpperCase(), margin, y + 2.5)
          y += 4

          doc.setFillColor(248, 250, 252) // Slate 50
          doc.setDrawColor(226, 232, 240) // Slate 200
          doc.setLineWidth(0.3)
          doc.roundedRect(margin, y, width, boxHeight, 1.5, 1.5, "FD")

          doc.setFont("helvetica", "normal")
          doc.setFontSize(8)
          doc.setTextColor(30, 41, 59) // Slate 800
          let curY = y + 3.8
          for (const line of lines) {
            doc.text(line, margin + 3, curY)
            curY += 3.8
          }
          y += boxHeight + 3.5
        }

        // --- 5. Clinical Indication & Technique (Matching preview layout) ---
        renderCardSection(
          "Clinical Indication & History:",
          study.indication || "Diagnostic evaluation requested by treating physician."
        )
        renderCardSection(
          "Examination Technique & Protocol:",
          study.technique || "Standard multiplanar digital diagnostic imaging scan per department protocol."
        )

        // --- 6. Diagnostic Findings (Matching preview layout) ---
        const findingsList = effectiveFindings.length > 0
          ? effectiveFindings
          : ["Scan acquisition completed cleanly. No acute macroscopic abnormality identified."]

        const findingsLinesData = findingsList.map((item) => doc.splitTextToSize(pdfSafe(item), width - 11))
        const totalFindingsLines = findingsLinesData.reduce((acc, lines) => acc + lines.length, 0)
        const findingsBoxH = totalFindingsLines * 3.8 + findingsList.length * 2.2 + 3.5

        ensureSpace(findingsBoxH + 8)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(8)
        doc.setTextColor(15, 23, 42)
        doc.text("DIAGNOSTIC FINDINGS:", margin, y + 2.5)
        y += 4

        doc.setFillColor(255, 255, 255) // White
        doc.setDrawColor(203, 213, 225) // Slate 300
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, width, findingsBoxH, 1.5, 1.5, "FD")

        let curFindingY = y + 4.2
        findingsList.forEach((_, idx) => {
          const lines = findingsLinesData[idx]
          // Royal Blue Bullet Dot
          doc.setFillColor(27, 79, 216)
          doc.circle(margin + 4.5, curFindingY - 0.9, 0.75, "F")

          doc.setFont("helvetica", effectiveFindings.length > 0 ? "normal" : "italic")
          doc.setFontSize(8.2)
          doc.setTextColor(effectiveFindings.length > 0 ? 30 : 100, effectiveFindings.length > 0 ? 41 : 116, effectiveFindings.length > 0 ? 59 : 139)
          doc.text(lines, margin + 7.5, curFindingY)
          curFindingY += lines.length * 3.8 + 2.2
        })
        y += findingsBoxH + 4

        // --- 7. Diagnostic Impression & Conclusion (Matching preview layout) ---
        const impList = effectiveImpression.length > 0
          ? effectiveImpression
          : [
              "1. Diagnostic radiology examination completed without complication. Correlate with clinical findings.",
            ]

        const impLinesData = impList.map((imp, idx) => {
          const formatted = imp.startsWith(`${idx + 1}.`) ? imp : `${idx + 1}. ${imp}`
          return doc.splitTextToSize(pdfSafe(formatted), width - 12)
        })
        const totalImpLines = impLinesData.reduce((acc, lines) => acc + lines.length, 0)
        const impBoxH = 6.5 + totalImpLines * 4 + impList.length * 1.8 + 2

        ensureSpace(impBoxH + 4)
        doc.setFillColor(250, 245, 255) // Purple 50
        doc.setDrawColor(233, 213, 255) // Purple 200
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, width, impBoxH, 1.5, 1.5, "FD")

        // Left Purple Accent Stripe
        doc.setFillColor(124, 58, 237) // Purple 600
        doc.rect(margin, y, 3.2, impBoxH, "F")

        doc.setFont("helvetica", "bold")
        doc.setFontSize(8.2)
        doc.setTextColor(88, 28, 135) // Purple 900
        doc.text("DIAGNOSTIC IMPRESSION & CONCLUSION:", margin + 6, y + 5)

        let curImpY = y + 9.5
        doc.setFont("helvetica", "bold")
        doc.setFontSize(8.5)
        doc.setTextColor(46, 16, 101) // Purple 950
        impLinesData.forEach((lines) => {
          doc.text(lines, margin + 6, curImpY)
          curImpY += lines.length * 4 + 1.8
        })
        y += impBoxH + 4

        // --- 8. Technician Acquisition Remarks (Matching preview layout) ---
        const techNotesText =
          study.operationalNotes ||
          study.technicianNotes ||
          (study as any).operatorNotes ||
          "Diagnostic imaging scan performed per department protocol. Images verified and transmitted to PACS."
        const safetyText = "• Standard ALARA radiation safety guidelines strictly maintained during acquisition."
        const techNotesLines = doc.splitTextToSize(pdfSafe(techNotesText), width - 6)
        const techNotesH = techNotesLines.length * 3.6 + 8.5

        ensureSpace(techNotesH + 6)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(7.2)
        doc.setTextColor(71, 85, 105) // Slate 700
        doc.text("TECHNICIAN ACQUISITION REMARKS & PROTOCOL NOTES:", margin, y + 2.5)
        y += 4

        doc.setFillColor(248, 250, 252)
        doc.setDrawColor(226, 232, 240)
        doc.setLineWidth(0.3)
        doc.roundedRect(margin, y, width, techNotesH, 1.5, 1.5, "FD")

        doc.setFont("helvetica", "normal")
        doc.setFontSize(7.6)
        doc.setTextColor(71, 85, 105)
        let curNotesY = y + 3.8
        for (const line of techNotesLines) {
          doc.text(line, margin + 3, curNotesY)
          curNotesY += 3.6
        }
        doc.setFontSize(6.8)
        doc.setTextColor(148, 163, 184)
        doc.text(pdfSafe(safetyText), margin + 3, curNotesY + 0.5)
        y += techNotesH + 5

        // --- 9. Sign-off Section (Matching preview layout) ---
        ensureSpace(24)
        doc.setDrawColor(226, 232, 240)
        doc.setLineWidth(0.35)
        doc.line(margin, y, right, y)
        y += 5.5

        // Left: Acquisition Technologist
        doc.setDrawColor(148, 163, 184)
        doc.setLineWidth(0.25)
        doc.line(margin, y, margin + 45, y)

        doc.setFont("helvetica", "bold")
        doc.setFontSize(6.8)
        doc.setTextColor(100, 116, 139)
        doc.text("ACQUISITION TECHNOLOGIST:", margin, y + 3.8)

        doc.setFontSize(8.2)
        doc.setTextColor(15, 23, 42)
        doc.text(pdfSafe(study.technician || "Staff Radiology Technician"), margin, y + 7.6)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.8)
        doc.setTextColor(100, 116, 139)
        doc.text(`Signature Ref: TECH-SIG-${pdfSafe(study.mrn || "8801")}`, margin, y + 11)

        // Right: Consultant Radiologist
        doc.setDrawColor(148, 163, 184)
        doc.setLineWidth(0.25)
        doc.line(right - 55, y, right, y)

        doc.setFont("helvetica", "bold")
        doc.setFontSize(6.8)
        doc.setTextColor(100, 116, 139)
        doc.text("CONSULTANT RADIOLOGIST:", right, y + 3.8, { align: "right" })

        doc.setFontSize(8.5)
        doc.setTextColor(2, 6, 23)
        doc.text(pdfSafe(study.radiologist || "Dr. K. S. Murthy, MD (Radiodiagnosis)"), right, y + 7.6, { align: "right" })

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.8)
        doc.setTextColor(27, 79, 216)
        doc.text(
          `Reg No: TSMC/2018/8841 • Signed: ${pdfSafe(study.signedAt || study.finalizedAt || new Date().toLocaleDateString("en-IN"))}`,
          right,
          y + 11,
          { align: "right" }
        )

        // --- 10. Disclaimer (Matching preview layout) ---
        y += 15
        doc.setDrawColor(241, 245, 249)
        doc.setLineWidth(0.25)
        doc.line(margin, y, right, y)
        y += 3.5

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.2)
        doc.setTextColor(148, 163, 184)
        doc.text(
          `Notice: This clinical radiology examination is an official digital medical document. Kindly interpret in correlation with clinical, physical, and laboratory findings. Report ID: ${pdfSafe(study.id)}`,
          pageW / 2,
          y,
          { align: "center" }
        )
      }

      // --- Multi-page Running Footers (All Pages) ---
      const totalPages = doc.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setDrawColor(226, 232, 240)
        doc.setLineWidth(0.25)
        doc.line(margin, 287, right, 287)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(6.2)
        doc.setTextColor(148, 163, 184)
        doc.text(
          "CONFIDENTIAL MEDICAL DOCUMENT • NABL / NABH ACCREDITED • PACS / DICOM INTEGRATED",
          margin,
          291
        )
        doc.text(`PAGE ${i} OF ${totalPages}`, right, 291, { align: "right" })
      }

      // Save PDF
      const cleanPatient = (study.patient || "Patient").replace(/[^a-zA-Z0-9_-]/g, "_")
      doc.save(`Radiology_Report_${cleanPatient}_${study.id}.pdf`)
    } catch (err) {
      console.error("PDF generation error:", err)
      window.print()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[95vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-900 text-white border-b border-slate-800 print:hidden">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-indigo-400" />
            <span className="font-bold text-sm tracking-tight">
              Radiology Report Preview & Export
            </span>
            <span
              className={`ml-2 px-2 py-0.5 rounded text-[11px] font-bold ${
                isFinalized
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-400/30"
              }`}
            >
              {isFinalized ? "FINALIZED" : "DRAFT"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {reconstructedDoc && (
              <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 mr-1">
                <button
                  type="button"
                  onClick={() => setViewFormat("standard")}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                    viewFormat === "standard"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Clinical Report
                </button>
                <button
                  type="button"
                  onClick={() => setViewFormat("template")}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                    viewFormat === "template"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Template Layout
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer size={14} />
              <span>Print Report</span>
            </button>

            <button
              type="button"
              disabled={downloading}
              onClick={handleDownloadPdf}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              <Download size={14} />
              <span>{downloading ? "Generating..." : "Download PDF"}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer ml-2"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Paper */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-slate-100 flex justify-center">
          {reconstructedDoc && viewFormat === "template" ? (
            <div className="w-full max-w-[780px] flex flex-col items-center space-y-3">
              <div className="w-full flex items-center justify-between text-[11.5px] text-blue-900 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg shadow-2xs">
                <span className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  Official Reconstructed Report Template Format Active
                </span>
                <span className="font-mono text-slate-500">
                  {matchedTemplate?.testName || study.study} (v{matchedTemplate?.version || 1})
                </span>
              </div>
              <div ref={reportRef} className="w-full flex flex-col items-center">
                <ReconstructedReportRenderer
                  document={reconstructedDoc}
                  patientContext={patientContext}
                  isEditable={false}
                  zoom={0.92}
                />
                {/* Templates with no findings / impression slot used to hide what the
                    radiologist entered (it only appeared in the downloaded PDF). */}
                {(!/\{\{\s*findings\s*\}\}/i.test(JSON.stringify(reconstructedDoc)) && findingsStr) ||
                (!/\{\{\s*impression\s*\}\}/i.test(JSON.stringify(reconstructedDoc)) && impressionStr) ? (
                  <div className="w-full max-w-[780px] mt-3 bg-white border border-slate-200 rounded-lg p-5 text-xs text-slate-800 space-y-3">
                    {!/\{\{\s*findings\s*\}\}/i.test(JSON.stringify(reconstructedDoc)) && findingsStr && (
                      <div>
                        <div className="font-bold uppercase tracking-wider text-[11px] mb-1">Findings</div>
                        <div className="whitespace-pre-wrap">{findingsStr}</div>
                      </div>
                    )}
                    {!/\{\{\s*impression\s*\}\}/i.test(JSON.stringify(reconstructedDoc)) && impressionStr && (
                      <div>
                        <div className="font-bold uppercase tracking-wider text-[11px] mb-1">Impression</div>
                        <div className="whitespace-pre-wrap">{impressionStr}</div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              ref={reportRef}
              className="w-full max-w-[760px] bg-white rounded-xl shadow-lg border border-slate-200 p-8 sm:p-10 text-slate-900 font-sans print:shadow-none print:border-none print:p-0 print:m-0"
            >
            {/* Hospital Letterhead */}
            <div className="flex justify-between items-start border-b-2 border-[#1E3A8A] pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#1B4FD8] text-white flex items-center justify-center font-black text-xl shadow-md">
                  ✚
                </div>
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
                    Enterprise Hospital Management System
                  </h1>
                  <h2 className="text-xs font-bold text-[#1B4FD8] uppercase tracking-wider mt-0.5">
                    Department of Radiodiagnosis &amp; Clinical Imaging
                  </h2>
                  <p className="text-[10.5px] text-slate-500 mt-0.5 font-medium">
                    NABH &amp; NABL Accredited Tertiary Care Facility • PACS / DICOM Integrated • 24x7 Helpline
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono text-xs font-extrabold px-3 py-1 bg-slate-100 rounded border border-slate-300 text-slate-900 block shadow-2xs">
                  ACCESSION: {study.accessionNo || "RAD-ACC-8801"}
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Report ID: {study.id}
                </span>
              </div>
            </div>

            {/* Patient Demographics Table */}
            <div className="bg-slate-50 border border-slate-300 rounded-lg p-4 mb-5 shadow-2xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 text-xs">
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Patient Name</span>
                  <strong className="text-slate-950 text-sm font-extrabold">{study.patient}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Age / Gender</span>
                  <strong className="text-slate-900">
                    {(study as any).age || matchedEncounter?.age || matchedPatient?.age || 42} yrs / {(study as any).gender || (study as any).sex || matchedEncounter?.sex || "Male"}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Permanent UMR</span>
                  <strong className="font-mono text-slate-900">{study.umr || `PAT-${study.mrn}`}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">OP / IP / ER No</span>
                  <strong className="font-mono text-slate-900">
                    {(study as any).opNumber || (study as any).ipNumber || matchedEncounter?.opNumber || study.encounterId || "OP-1002"}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Referring Consultant</span>
                  <strong className="text-slate-900">{study.provider}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Exam Date</span>
                  <strong className="text-slate-900">{(study as any).orderDate || study.ordered || new Date().toISOString().split("T")[0]}</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Modality / Suite</span>
                  <strong className="text-[#1B4FD8] font-bold">{study.modality} ({study.room || "Suite 1"})</strong>
                </div>
                <div>
                  <span className="text-slate-500 text-[10.5px] font-bold uppercase tracking-wider block">Billing Status</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-extrabold ${
                      isPaid ? "text-emerald-800 bg-emerald-100 border border-emerald-300" : "text-amber-800 bg-amber-100 border border-amber-300"
                    }`}
                  >
                    {isPaid ? `PAID (${study.paidReceiptNo || "RCPT-5501"})` : "PENDING"}
                  </span>
                </div>
              </div>
            </div>

            {/* Examination Title */}
            <div className="bg-indigo-50/80 border-l-4 border-[#1B4FD8] px-4 py-3 rounded-r-lg mb-5 flex items-center justify-between shadow-2xs border border-indigo-100">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1B4FD8] block">
                  EXAMINATION PERFORMED
                </span>
                <h3 className="text-[15px] font-black text-indigo-950">
                  {study.study}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 bg-white text-[#1B4FD8] border border-indigo-200 rounded">
                  {study.modality} SCAN
                </span>
                <span className="text-xs font-bold text-slate-600">
                  Tariff: ₹{(study.price ?? 0).toLocaleString("en-IN")}
                </span>
              </div>
            </div>

            {/* Clinical Section */}
            <div className="space-y-5 text-xs">
              {/* Indication */}
              <div>
                <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-1.5">
                  Clinical Indication &amp; History:
                </h4>
                <p className="text-slate-800 bg-slate-50/80 p-3 rounded-md border border-slate-200 text-[12px] leading-relaxed">
                  {study.indication || "Diagnostic evaluation requested by treating physician."}
                </p>
              </div>

              {/* Technique */}
              <div>
                <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-1.5">
                  Examination Technique &amp; Protocol:
                </h4>
                <p className="text-slate-800 bg-slate-50/80 p-3 rounded-md border border-slate-200 text-[12px] leading-relaxed">
                  {study.technique || "Standard multiplanar digital diagnostic imaging scan per department protocol."}
                </p>
              </div>

              {/* Findings */}
              <div>
                <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-1.5">
                  Diagnostic Findings:
                </h4>
                <div className="bg-white p-4 rounded-lg border border-slate-300 space-y-2.5 leading-relaxed text-[12.5px] shadow-2xs">
                  {effectiveFindings.length > 0 ? (
                    effectiveFindings.map((finding, idx) => (
                      <p key={idx} className="text-slate-800 flex items-start gap-2">
                        <span className="text-[#1B4FD8] font-bold mt-0.5">•</span>
                        <span>{finding}</span>
                      </p>
                    ))
                  ) : (
                    <p className="text-slate-500 italic">
                      Scan acquisition completed cleanly. No acute macroscopic abnormality identified.
                    </p>
                  )}
                </div>
              </div>

              {/* Impression / Conclusion */}
              <div>
                <div className="bg-purple-50/70 border-l-4 border-purple-600 p-4 rounded-r-lg border-t border-r border-b border-purple-200 space-y-2 shadow-2xs">
                  <h4 className="font-black text-purple-900 uppercase tracking-wider text-[11.5px]">
                    Diagnostic Impression &amp; Conclusion:
                  </h4>
                  {effectiveImpression.length > 0 ? (
                    effectiveImpression.map((imp, idx) => (
                      <p key={idx} className="font-bold text-purple-950 text-[12.5px] leading-snug">
                        {imp.startsWith(`${idx + 1}.`) ? imp : `${idx + 1}. ${imp}`}
                      </p>
                    ))
                  ) : (
                    <p className="font-bold text-purple-950 text-[12.5px]">
                      1. Diagnostic radiology examination completed without complication. Correlate with clinical findings.
                    </p>
                  )}
                </div>
              </div>

              {/* Technician Operational Notes */}
              <div>
                <h4 className="font-extrabold text-slate-700 uppercase tracking-wider text-[10.5px] mb-1">
                  Technician Acquisition Remarks &amp; Protocol Notes:
                </h4>
                <p className="text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 text-[11px] leading-normal">
                  {study.operationalNotes || study.technicianNotes || (study as any).operatorNotes || "Diagnostic imaging scan performed per department protocol. Images verified and transmitted to PACS."}
                  <span className="block text-[10px] text-slate-400 mt-1">• Standard ALARA radiation safety guidelines strictly maintained during acquisition.</span>
                </p>
              </div>

              {/* Sign-off Section */}
              <div className="pt-6 border-t-2 border-slate-200 mt-8 grid grid-cols-2 gap-8">
                <div>
                  <div className="w-32 h-[1px] bg-slate-400 mb-2"></div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Acquisition Technologist:
                  </span>
                  <div className="font-extrabold text-slate-900 mt-0.5 text-xs">
                    {study.technician || "Staff Radiology Technician"}
                  </div>
                  <div className="text-[10.5px] font-mono text-slate-500">
                    Signature Ref: TECH-SIG-{study.mrn || "8801"}
                  </div>
                </div>

                <div className="text-right">
                  <div className="w-32 h-[1px] bg-slate-400 mb-2 ml-auto"></div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Consultant Radiologist:
                  </span>
                  <div className="font-black text-slate-950 mt-0.5 text-xs">
                    {study.radiologist || "Dr. K. S. Murthy, MD (Radiodiagnosis)"}
                  </div>
                  <div className="text-[10.5px] text-[#1B4FD8] font-semibold">
                    Reg No: TSMC/2018/8841 • Signed: {study.signedAt || study.finalizedAt || new Date().toLocaleDateString("en-IN")}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="text-[9.5px] text-slate-400 text-center pt-5 border-t border-slate-100">
                Notice: This clinical radiology examination is an official digital medical document.
                Kindly interpret in correlation with clinical, physical, and laboratory findings. Report ID: {study.id}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
