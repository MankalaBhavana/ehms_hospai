import "./shim"
import { BillingDatabase, ClaimRecord } from "../src/services/billingDb"

const sampleClaims: Partial<ClaimRecord>[] = [
  {
    id: "CLM-TEST-01",
    invoiceNo: "INV-TEST-01",
    patientName: "Alice Smith",
    patientId: "UMR10001",
    mrn: "UMR10001",
    department: "Outpatient",
    insuranceProvider: "Self-Pay",
    status: "Draft",
    items: [],
    subtotal: 500,
    discount: 0,
    tax: 0,
    totalAmount: 500,
    insurancePortion: 0,
    patientPortion: 500,
    amountPaid: 0,
    balanceDue: 500,
    payments: [],
    diagnosisCodes: [],
    attendingDoctor: "Dr. Rao",
    createdAt: "2026-03-15T09:30:00.000Z",
    dateOfService: "2026-03-15",
  },
  {
    id: "CLM-TEST-02",
    invoiceNo: "INV-TEST-02",
    patientName: "Bob Jones",
    patientId: "UMR10002",
    mrn: "UMR10002",
    department: "Inpatient",
    insuranceProvider: "Self-Pay",
    status: "Draft",
    items: [],
    subtotal: 12000,
    discount: 0,
    tax: 0,
    totalAmount: 12000,
    insurancePortion: 0,
    patientPortion: 12000,
    amountPaid: 12000,
    balanceDue: 0,
    payments: [],
    diagnosisCodes: [],
    attendingDoctor: "Dr. Sharma",
    createdAt: "2026-11-10T14:15:00.000Z",
    dateOfService: "2026-11-10",
  },
  {
    id: "CLM-TEST-03",
    invoiceNo: "INV-TEST-03",
    patientName: "Charlie Brown",
    patientId: "UMR10003",
    mrn: "UMR10003",
    department: "Emergency",
    insuranceProvider: "Self-Pay",
    status: "Draft",
    items: [],
    subtotal: 3500,
    discount: 0,
    tax: 0,
    totalAmount: 3500,
    insurancePortion: 0,
    patientPortion: 3500,
    amountPaid: 2000,
    balanceDue: 1500,
    payments: [],
    diagnosisCodes: [],
    attendingDoctor: "Dr. Verma",
    createdAt: "2026-11-19T10:00:00.000Z",
    dateOfService: "2026-11-19",
  },
]

// Inject sample test claims into storage
BillingDatabase.saveClaims(sampleClaims as ClaimRecord[])

const results: string[] = []
const check = (name: string, ok: boolean, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " -> " + extra : ""}`)

// Test 1: Month and Year filter (Nov 2026)
const novClaims = BillingDatabase.getClaims({ month: 11, year: 2026 })
check(
  "Filter by Month=11 & Year=2026 returns only November 2026 bills",
  novClaims.some((c) => c.id === "CLM-TEST-02") &&
    novClaims.some((c) => c.id === "CLM-TEST-03") &&
    !novClaims.some((c) => c.id === "CLM-TEST-01"),
  `Found ${novClaims.length} bills`,
)

// Test 2: Month and Year filter (March 2026)
const marClaims = BillingDatabase.getClaims({ month: 3, year: 2026 })
check(
  "Filter by Month=3 & Year=2026 returns only March 2026 bills",
  marClaims.some((c) => c.id === "CLM-TEST-01") &&
    !marClaims.some((c) => c.id === "CLM-TEST-02"),
  `Found ${marClaims.length} bills`,
)

// Test 3: Time-to-time range (From 2026-11-15T00:00:00 to 2026-11-19T23:59:59)
const rangeClaims = BillingDatabase.getClaims({
  fromDate: "2026-11-15T00:00:00",
  toDate: "2026-11-19T23:59:59",
})
check(
  "Filter by time-to-time range returns only bills inside that time window",
  rangeClaims.some((c) => c.id === "CLM-TEST-03") &&
    !rangeClaims.some((c) => c.id === "CLM-TEST-02") &&
    !rangeClaims.some((c) => c.id === "CLM-TEST-01"),
  `Found ${rangeClaims.length} bills`,
)

// Test 4: Export CSV with filtered subset
const csv = BillingDatabase.exportClaimsToCSV(novClaims)
check(
  "exportClaimsToCSV with filtered claims includes filtered data",
  csv.includes("Bob Jones") && csv.includes("Charlie Brown"),
  "CSV includes Bob and Charlie",
)

console.log(results.join("\n"))
const allPassed = results.every((r) => r.startsWith("PASS"))
if (!allPassed) {
  process.exit(1)
}
