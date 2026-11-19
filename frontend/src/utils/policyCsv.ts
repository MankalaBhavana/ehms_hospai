import type { PatientPolicy, PolicyRelationship } from "../types/insurance"

/**
 * CSV import / export for the Patient Insurance register. Pure functions (no storage, no UI) so they can be tested.
 * The export writes exactly the columns the import reads, so a file can be exported, corrected in Excel and imported back.
 */

export const POLICY_COLUMNS = ["UMR", "Patient name", "Insurance company", "TPA", "Policy number", "Member ID", "Policy holder", "Relationship", "Valid until", "Sum insured", "Balance available", "Co-pay %", "Bed limit per day", "ICU limit per day"] as const

const ALIASES: Record<string, string> = {
  umr: "umr", uhid: "umr", patientid: "umr", patientumr: "umr", mrn: "umr",
  patientname: "name", name: "name",
  insurancecompany: "insurer", insurer: "insurer", insurancename: "insurer", company: "insurer", insuranceprovider: "insurer",
  tpa: "tpa", tpaname: "tpa",
  policynumber: "policyNo", policyno: "policyNo", policy: "policyNo", policyid: "policyNo",
  memberid: "memberId", member: "memberId", memberno: "memberId", cardno: "memberId",
  policyholder: "holder", holder: "holder", policyholdername: "holder",
  relationship: "relationship", relation: "relationship",
  validuntil: "validUntil", validtill: "validUntil", validupto: "validUntil", expiry: "validUntil", expirydate: "validUntil", validto: "validUntil",
  suminsured: "sum", sum: "sum", coverage: "sum",
  balanceavailable: "balance", balance: "balance",
  copay: "copay", copaypercent: "copay", copaypercentage: "copay",
  bedlimitperday: "roomRent", bedlimit: "roomRent", roomrentperday: "roomRent", roomrent: "roomRent", roomrentlimit: "roomRent", bedrentperday: "roomRent",
  icu: "icuRent", iculimitperday: "icuRent", iculimit: "icuRent", icurentperday: "icuRent", icurent: "icuRent",
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Quote-aware CSV reader (commas, semicolons or tabs; Excel's BOM; CRLF). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "")
  const first = src.split(/\r?\n/, 1)[0] || ""
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') (cell += '"', i++)
        else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) (row.push(cell), (cell = ""))
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(cell)
      cell = ""
      if (row.some((c) => c.trim() !== "")) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== "")) rows.push(row)
  return rows
}

const esc = (v: unknown) => {
  let s = String(v ?? "")
  // A cell that starts like a formula is neutralised so Excel never runs it.
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv(head: readonly string[], lines: unknown[][]): string {
  return "﻿" + [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\r\n")
}

/** yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy or "12 Mar 2027"  ->  yyyy-mm-dd; "" when empty; null when not a real date. */
export function parseDate(v: string): string | "" | null {
  const s = v.trim()
  if (!s) return ""
  let y: number, m: number, d: number
  let r: RegExpMatchArray | null
  if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, m, d] = [+r[1], +r[2], +r[3]]
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]]
  else {
    const t = new Date(s)
    if (Number.isNaN(t.getTime())) return null
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
  }
  const t = new Date(y, m - 1, d)
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

const money = (v: string): number | null => {
  const s = v.replace(/[₹,\s]|rs\.?|inr/gi, "")
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const RELATIONS: PolicyRelationship[] = ["Self", "Spouse", "Child", "Parent", "Other"]

export interface ImportContext {
  /** Looks a UMR up in the patient registry. */
  patient: (umr: string) => { umr: string; name: string } | undefined
  /** Insurance company master (name, id, default TPA). */
  insurers: { id: string; name: string; tpa?: string }[]
  /** `UMR|policy number` (upper / lower) keys that are already on record. */
  existing: Set<string>
}

export interface ImportRow {
  line: number
  status: "new" | "update" | "error"
  errors: string[]
  warnings: string[]
  policy?: PatientPolicy
  label: string
}

export const policyKey = (umr: string, no: string) => `${umr.trim().toUpperCase()}|${no.trim().toLowerCase()}`

export function checkImport(text: string, ctx: ImportContext): { rows: ImportRow[]; fileError?: string } {
  const grid = parseCsv(text)
  if (grid.length < 2) return { rows: [], fileError: "The file has no data rows. Use the template: first row is the column names, then one policy per row." }
  const cols: Record<string, number> = {}
  grid[0].forEach((h, i) => {
    const key = ALIASES[norm(h)]
    if (key && cols[key] === undefined) cols[key] = i
  })
  const missing = (["umr", "insurer", "policyNo"] as const).filter((k) => cols[k] === undefined)
  if (missing.length) {
    const names = { umr: "UMR", insurer: "Insurance company", policyNo: "Policy number" } as const
    return { rows: [], fileError: `The file is missing the column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => names[m]).join(", ")}. Download the template to see the expected columns.` }
  }
  const cell = (r: string[], k: string) => (cols[k] === undefined ? "" : (r[cols[k]] ?? "").trim())
  const seen = new Set<string>()
  const rows: ImportRow[] = grid.slice(1).map((r, i) => {
    const line = i + 2
    const errors: string[] = []
    const warnings: string[] = []
    const umrRaw = cell(r, "umr")
    const no = cell(r, "policyNo")
    const insurerRaw = cell(r, "insurer")
    const pat = umrRaw ? ctx.patient(umrRaw) : undefined
    if (!umrRaw) errors.push("UMR is empty")
    else if (!pat) errors.push(`No patient with UMR ${umrRaw} in the registry`)
    if (!no) errors.push("Policy number is empty")
    if (!insurerRaw) errors.push("Insurance company is empty")
    const ins = insurerRaw ? ctx.insurers.find((x) => x.name.trim().toLowerCase() === insurerRaw.toLowerCase()) : undefined
    if (insurerRaw && !ins) warnings.push("Company is not in Insurance Setup; saved as typed")
    const validUntil = parseDate(cell(r, "validUntil"))
    if (validUntil === null) errors.push(`"${cell(r, "validUntil")}" is not a date (use dd/mm/yyyy or yyyy-mm-dd)`)
    const sum = money(cell(r, "sum"))
    if (sum === null) errors.push("Sum insured is not a number")
    const bal = money(cell(r, "balance"))
    if (bal === null) errors.push("Balance available is not a number")
    const copayRaw = cell(r, "copay").replace(/%/g, "")
    const copay = copayRaw ? Number(copayRaw) : 0
    if (!Number.isFinite(copay) || copay < 0 || copay > 100) errors.push("Co-pay % must be between 0 and 100")
    const roomRent = money(cell(r, "roomRent"))
    if (roomRent === null) errors.push("Bed limit per day is not a number")
    const icuRent = money(cell(r, "icuRent"))
    if (icuRent === null) errors.push("ICU limit per day is not a number")
    const relRaw = cell(r, "relationship")
    const rel = RELATIONS.find((x) => x.toLowerCase() === relRaw.toLowerCase())
    if (relRaw && !rel) warnings.push(`Relationship "${relRaw}" not recognised; saved as Other`)
    const key = umrRaw && no ? policyKey(umrRaw, no) : ""
    if (key && seen.has(key)) errors.push("Same patient and policy number appears earlier in this file")
    if (key) seen.add(key)
    const label = [pat?.name || cell(r, "name") || umrRaw, no].filter(Boolean).join(" · ")
    if (errors.length) return { line, status: "error", errors, warnings, label }
    const patientName = pat!.name
    const policy: PatientPolicy = {
      id: "",
      patientId: pat!.umr,
      patientName,
      insurerId: ins?.id || "",
      insurerName: ins?.name || insurerRaw,
      tpaName: cell(r, "tpa") || ins?.tpa || undefined,
      policyNumber: no,
      memberId: cell(r, "memberId"),
      policyHolderName: cell(r, "holder") || patientName,
      relationship: rel || (relRaw ? "Other" : "Self"),
      validUntil: validUntil || "",
      sumInsured: sum || 0,
      // A blank balance means "nothing used yet"; an explicit 0 is kept as 0 (cover exhausted).
      balanceAvailable: cell(r, "balance") === "" ? sum || 0 : bal || 0,
      copayPercentage: copay,
      roomRentPerDay: roomRent || 0,
      icuRentPerDay: icuRent || 0,
      status: "Active",
      createdAt: "",
    }
    return { line, status: ctx.existing.has(policyKey(pat!.umr, no)) ? "update" : "new", errors, warnings, policy, label }
  })
  return { rows }
}
