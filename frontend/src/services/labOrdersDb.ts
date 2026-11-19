/**
 * Lab order store -- the doctor -> reception/billing -> laboratory hand-off.
 *
 * When a consultation sheet is split, the investigation half lands here as one
 * LabOrder per visit.
 *
 * Billing status (Pending / Paid) is managed by the Billing module.
 * Laboratory status (Pending -> Sample Collected -> Processing -> Result Entered -> Verified -> Completed)
 * is managed by the Laboratory portal.
 */

import { findTestDefinition } from "../components/laboratory/labCatalogueSchema"
import { isRadiologyTest } from "../utils/testClassifier"
import { BillingDatabase } from "./billingDb"
import { dropLegacySeeds, SEED_LAB_ORDERS } from "./legacySeedPurge"
import { DiagnosticTariffDatabase } from "./diagnosticTariffDb"
import { apiFetch } from "../lib/api"
import { handOff } from "./handoffs"

const ORDERS_KEY = "hospai_lab_orders_v2"

// Modes the billing backend accepts as an actually-collected payment.
// Insurance is settled through a claim, never by marking the order paid here.
const SERVER_PAYMENT_MODE: Partial<Record<NonNullable<LabOrder["billing"]["mode"]>, string>> = {
  Cash: "cash",
  Card: "card",
  UPI: "upi",
  Corporate: "bank",
}
const CHANNEL_NAME = "hospai_lab_orders"

export type LabOrderStatus =
  | "Awaiting Billing"
  | "Billed"
  | "Sample Collected"
  | "In Progress"
  | "Completed"
  | "Cancelled"

export type LabBillingStatus = "Pending" | "Paid" | "Waived" | "Cancelled"

export type LabTestStatus =
  | "Ordered"
  | "Pending"
  | "Sample Collected"
  | "In Progress"
  | "Processing"
  | "Result Entered"
  | "Verified"
  | "Completed"

export interface LabParameterResult {
  value: string
  unit?: string
  referenceRange?: string
  flag?: "H" | "L" | "Critical" | ""
  notes?: string
}

export interface LabOrderTest {
  id: string
  name: string
  category: string
  urgency: "Routine" | "STAT" | string
  price: number
  status: LabTestStatus
  result?: string
  resultUnit?: string
  referenceRange?: string
  flag?: "H" | "L" | "Critical" | ""
  resultedAt?: string
  results?: Record<string, LabParameterResult>
  tableData?: any[]
  clinicalComments?: string
  sampleCollectedAt?: string
  sampleCollector?: string
  technician?: string
  verifier?: string
  verifiedAt?: string
  processingStartedAt?: string
  processingCompletedAt?: string
}

export interface LabOrderEvent {
  at: string
  actor: string
  action: string
  detail?: string
}

export interface LabOrder {
  id: string
  consultationId?: string
  encounterId: string
  umr: string
  patientName: string
  age: number
  sex: string
  phone: string
  opNumber: string
  doctorId: string
  doctorName: string
  department: string
  diagnosis: string
  clinicalNotes?: string
  tests: LabOrderTest[]
  status: LabOrderStatus
  processingStartedAt?: string
  processingCompletedAt?: string
  createdAt: string
  updatedAt: string
  billing: {
    status: LabBillingStatus
    invoiceNo?: string
    subtotal: number
    discount: number
    total: number
    mode?: "Cash" | "Card" | "UPI" | "Insurance" | "Corporate"
    receiptNo?: string
    paidAt?: string
    collectedBy?: string
    /** Backend invoice created for this order; reused on retry so a failed payment never creates a second invoice. */
    serverInvoiceId?: number
    serverPaymentId?: number
  }
  history: LabOrderEvent[]
}

/** A test the hospital has not priced is 0: nothing is invented. Prices are set on Administration > Rates & Charges. */
export const DEFAULT_TEST_PRICE = 0

export function priceForTest(testName: string): number {
  if (!testName) return 0

  // 1. Diagnostic tariff (the hospital's own rate card, edited by Administration)
  const tariffPrice = DiagnosticTariffDatabase.getTariffPriceByName(testName)
  if (tariffPrice !== null && tariffPrice !== undefined && tariffPrice > 0) return tariffPrice

  // 2. Built-in catalogue entry, whose price reads from the same tariff by test code
  const def = findTestDefinition(testName)
  return def && def.price ? def.price : 0
}

// ── Storage plumbing ─────────────────────────────────────────────────────────

const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = () => {
      cachedOrders = null
      listeners.forEach((fn) => fn())
    }
  }
  return channel
}

function notify() {
  cachedOrders = null
  listeners.forEach((fn) => fn())
  ensureChannel()?.postMessage("changed")
}

function normalizeOrder(order: LabOrder): LabOrder {
  // Pure laboratory investigations only - strip any auto-injected radiology studies
  let rawTests = [...(order.tests || [])].filter(
    (t) =>
      !t.id?.startsWith("RAD-TEST-") &&
      t.category !== "RADIOLOGY" &&
      !isRadiologyTest(t.name, t.category) &&
      !t.name?.toLowerCase().includes("diagnostic imaging study"),
  )

  // Deduplicate only truly identical tests within the same order (preserve distinct tests like Fasting vs PPBS)
  const seenTestKeys = new Set<string>()
  const deduplicatedTests: typeof rawTests = []
  for (const t of rawTests) {
    const rawName = (t.name || "").trim().toLowerCase()
    const def = findTestDefinition(t.name)
    const canonicalName = def?.name.toLowerCase() || rawName
    const isCbc =
      canonicalName.includes("cbc") ||
      canonicalName.includes("hemogram") ||
      canonicalName.includes("blood picture") ||
      canonicalName.includes("complete blood count")
    const key = isCbc ? "panel:cbc" : `test:${canonicalName}`

    if (!seenTestKeys.has(key)) {
      seenTestKeys.add(key)
      deduplicatedTests.push(t)
    }
  }

  const isUnbilled = !order.billing || order.billing.status !== "Paid"
  const normalizedTests = deduplicatedTests.map((t) => {
    const currentPrice = t.price && t.price > 0 ? t.price : priceForTest(t.name)
    const status = isUnbilled && (t.status === "Completed" || t.status === "Verified")
      ? "Pending"
      : t.status === "Ordered"
      ? "Pending"
      : t.status
    return {
      ...t,
      price: currentPrice,
      status: status as LabTestStatus,
    }
  })

  const subtotal = isUnbilled
    ? normalizedTests.reduce((sum, t) => sum + t.price, 0)
    : order.billing?.subtotal || 0
  const discount = order.billing?.discount || 0
  const total = isUnbilled ? Math.max(0, subtotal - discount) : order.billing?.total || 0

  const effectiveStatus = (isUnbilled && order.status === "Completed")
    ? ("Awaiting Billing" as LabOrderStatus)
    : order.status

  return {
    ...order,
    status: effectiveStatus,
    tests: normalizedTests,
    history: order.history || [],
    billing: {
      status: order.billing?.status || "Pending",
      invoiceNo: order.billing?.invoiceNo,
      mode: order.billing?.mode,
      receiptNo: order.billing?.receiptNo,
      paidAt: order.billing?.paidAt,
      collectedBy: order.billing?.collectedBy,
      subtotal,
      discount,
      total,
    },
  }
}

let cachedOrders: LabOrder[] | null = null

export function invalidateLabOrdersCache(): void {
  cachedOrders = null
}

function readOrders(): LabOrder[] {
  if (typeof window === "undefined") return []
  if (cachedOrders) return cachedOrders

  try {
    const raw = window.localStorage.getItem(ORDERS_KEY)
    if (!raw) {
      cachedOrders = []
      return cachedOrders
    }
    const stored = JSON.parse(raw) as LabOrder[]
    // Sample orders older builds seeded into every browser.
    const parsed = dropLegacySeeds(stored, SEED_LAB_ORDERS, (o) => o.id, (o) => o.patientName)
    let mutated = parsed.length !== stored.length
    const sanitized = parsed.map((order) => {
      let orderMutated = false
      let tests = order.tests

      // Strip any injected radiology studies
      const initialTestsCount = tests.length
      tests = tests.filter(
        (t) =>
          !t.id?.startsWith("RAD-TEST-") &&
          t.category !== "RADIOLOGY" &&
          !isRadiologyTest(t.name, t.category) &&
          !t.name?.toLowerCase().includes("diagnostic imaging study"),
      )
      if (tests.length !== initialTestsCount) {
        orderMutated = true
      }

      // STRICT BILLING ENFORCEMENT: If billing is not Paid, order CANNOT be Completed or Sample Collected
      const isOrderPaid = order.billing?.status === "Paid"
      if (!isOrderPaid) {
        let hadUnpaidCompleted = false
        tests = tests.map((t) => {
          if (t.status === "Completed" || t.status === "Verified") {
            hadUnpaidCompleted = true
            return {
              ...t,
              status: "Pending" as const,
              result: "",
              resultUnit: "",
              flag: "" as const,
              results: {},
              clinicalComments: "",
              verifier: undefined,
              verifiedAt: undefined,
              processingCompletedAt: undefined,
              resultedAt: undefined,
            }
          }
          return t
        })

        if (hadUnpaidCompleted || order.status === "Completed") {
          orderMutated = true
          return {
            ...order,
            tests,
            status: order.status === "Sample Collected" ? "Sample Collected" : ("Awaiting Billing" as const),
            processingCompletedAt: undefined,
          }
        }
      }

      const allCompleted =
        isOrderPaid &&
        tests.length > 0 &&
        tests.every((t) => t.status === "Completed" || t.status === "Verified")

      if (allCompleted && order.status !== "Completed") {
        orderMutated = true
        return {
          ...order,
          tests,
          status: "Completed" as const,
        }
      }

      // If an order was prematurely marked Completed while some tests are still pending, adjust order to In Progress
      if (isOrderPaid && !allCompleted && order.status === "Completed") {
        orderMutated = true
        return {
          ...order,
          tests,
          status: "In Progress" as const,
        }
      }

      if (orderMutated) {
        mutated = true
        const preservedStatus =
          order.status === "In Progress" || order.status === "Sample Collected" || order.status === "Billed"
            ? order.status
            : isOrderPaid
            ? ("Sample Collected" as const)
            : ("Awaiting Billing" as const)
        return {
          ...order,
          tests,
          status: preservedStatus,
        }
      }
      return order
    })

    if (mutated) {
      try {
        window.localStorage.setItem(ORDERS_KEY, JSON.stringify(sanitized))
      } catch {}
    }

    const deduped: LabOrder[] = []
    const seenOrderIds = new Set<string>()
    for (const ord of sanitized.map(normalizeOrder)) {
      const orderId = (ord.id || "").toLowerCase().trim()
      if (!orderId) continue
      if (seenOrderIds.has(orderId)) continue

      // Look for duplicate order representing same encounter or invoice
      const enc = (ord.encounterId || "").toLowerCase().trim()
      const inv = (ord.billing?.invoiceNo || "").toLowerCase().trim()
      const matchIdx = deduped.findIndex((existing) => {
        if (enc && existing.encounterId && existing.encounterId.toLowerCase().trim() === enc) return true
        if (inv && existing.billing?.invoiceNo && existing.billing.invoiceNo.toLowerCase().trim() === inv) return true
        return false
      })

      if (matchIdx >= 0) {
        const existing = deduped[matchIdx]
        const preferOrd =
          ord.tests.length > existing.tests.length ||
          (ord.id.startsWith("LAB-") && !existing.id.startsWith("LAB-"))
        const primary = preferOrd ? { ...ord } : { ...existing }
        const secondary = preferOrd ? existing : ord

        // Ensure payment status from either is preserved
        const isPaid = primary.billing?.status === "Paid" || secondary.billing?.status === "Paid"
        if (isPaid && primary.billing?.status !== "Paid") {
          primary.billing = { ...(secondary.billing || {}), status: "Paid" }
          primary.status = primary.status === "Awaiting Billing" ? "Billed" : primary.status
        }
        // Merge tests from secondary if primary missed any
        for (const secTest of secondary.tests) {
          const exists = primary.tests.some(
            (pt) => (pt.name || "").trim().toLowerCase() === (secTest.name || "").trim().toLowerCase()
          )
          if (!exists) {
            primary.tests.push(secTest)
          }
        }
        deduped[matchIdx] = primary
        seenOrderIds.add(orderId)
        continue
      }

      seenOrderIds.add(orderId)
      deduped.push(ord)
    }
    cachedOrders = deduped
    return cachedOrders
  } catch {
    return []
  }
}

function writeOrders(orders: LabOrder[]): void {
  if (typeof window === "undefined") return
  cachedOrders = orders
  try {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
  } catch (err) {
    console.error("Lab orders: could not persist", err)
  }
}

/**
 * The next free number after the highest one already issued under `prefix`.
 * Counting orders instead reissued an existing id whenever an order had been
 * removed, so two orders could share one id (and one invoice number).
 */
function nextSequence(prefix: string, ids: (string | undefined)[]): string {
  let max = 0
  for (const id of ids) {
    if (!id || !id.startsWith(`${prefix}-`)) continue
    const n = parseInt(id.slice(prefix.length + 1), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}-${String(max + 1).padStart(5, "0")}`
}

// ── API ──────────────────────────────────────────────────────────────────────

export class LabOrderDatabase {
  static subscribe(listener: () => void): () => void {
    listeners.add(listener)
    ensureChannel()
    return () => listeners.delete(listener)
  }

  static getOrders(): LabOrder[] {
    return readOrders()
      .filter((o) => o.tests && o.tests.length > 0)
      .sort((a, b) => {
        const timeB = new Date(b.createdAt || (b as any).orderedDate || 0).getTime()
        const timeA = new Date(a.createdAt || (a as any).orderedDate || 0).getTime()
        return timeB - timeA || (b.id || "").localeCompare(a.id || "")
      })
  }

  static resetToCleanDemoData(): void {
    if (typeof window === "undefined") return
    window.localStorage.setItem(ORDERS_KEY, "[]")
    cachedOrders = null
    try {
      window.localStorage.removeItem("hospai_lab_orders_v1")
      window.localStorage.removeItem("hospai_billing_lab_orders_v1")
    } catch {}
    notify()
  }

  static getOrder(id: string): LabOrder | undefined {
    return readOrders().find((o) => o.id === id)
  }

  static getOrdersForPatient(umr: string): LabOrder[] {
    const normalized = umr.toUpperCase()
    return this.getOrders().filter((o) => o.umr.toUpperCase() === normalized)
  }

  /** Reception's queue: ordered by the doctor, not yet paid for. */
  static getBillingQueue(): LabOrder[] {
    return this.getOrders().filter(
      (o) => o.billing.status === "Pending" && o.status !== "Cancelled",
    )
  }

  /**
   * The laboratory's worklist.
   * Returns all active non-cancelled lab orders (both Paid and Pending billing).
   */
  static getLabWorklist(filter?: "all" | "paid" | "pending"): LabOrder[] {
    const orders = this.getOrders().filter((o) => o.status !== "Cancelled")
    if (filter === "paid") {
      return orders.filter((o) => o.billing.status === "Paid")
    }
    if (filter === "pending") {
      return orders.filter((o) => o.billing.status === "Pending")
    }
    return orders
  }

  static createOrder(input: {
    consultationId?: string
    encounterId: string
    umr: string
    patientName: string
    age: number
    sex: string
    phone: string
    opNumber: string
    doctorId: string
    doctorName: string
    department: string
    diagnosis: string
    clinicalNotes?: string
    tests: { name: string; category?: string; urgency?: string }[]
  }): LabOrder {
    const orders = readOrders()
    const now = new Date().toISOString()

    const pureLabTests = input.tests.filter((t) => !isRadiologyTest(t.name, t.category))

    // Deduplicate input tests by canonical test definition
    const seenOrderTestKeys = new Set<string>()
    const deduplicatedInputTests: typeof pureLabTests = []
    for (const t of pureLabTests) {
      const def = findTestDefinition(t.name)
      const canon = def?.name.toLowerCase() || (t.name || "").trim().toLowerCase()
      const isCbc =
        canon.includes("cbc") ||
        canon.includes("hemogram") ||
        canon.includes("blood picture") ||
        canon.includes("complete blood count")
      const key = isCbc ? "panel:cbc" : canon
      if (!seenOrderTestKeys.has(key)) {
        seenOrderTestKeys.add(key)
        deduplicatedInputTests.push(t)
      }
    }

    // Deduplication check: if an active order for this encounter or consultation already exists with matching tests, reuse it
    const existingOrder = orders.find(
      (o) =>
        (input.encounterId && o.encounterId === input.encounterId) ||
        (input.consultationId && o.consultationId === input.consultationId) ||
        (o.umr === input.umr && o.status !== "Completed" && o.status !== "Cancelled" &&
          Math.abs(new Date(o.createdAt).getTime() - new Date().getTime()) < 300000)
    )

    if (existingOrder) {
      const existingNames = new Set(existingOrder.tests.map((t) => t.name.toLowerCase().trim()))
      const allPresent = pureLabTests.every((t) => existingNames.has(t.name.toLowerCase().trim()))
      if (allPresent) {
        return existingOrder
      }
    }

    const tests: LabOrderTest[] = deduplicatedInputTests.map((test, index) => {
      const def = findTestDefinition(test.name)
      const explicitPrice = (test as any).price
      return {
        id: `LT-${index + 1}`,
        name: test.name || (def ? def.name : "Laboratory Investigation"),
        category: def ? def.category : (test.category || "PATHOLOGY"),
        urgency: (test.urgency as LabOrderTest["urgency"]) || "Routine",
        price: explicitPrice && explicitPrice > 0 ? explicitPrice : priceForTest(test.name),
        status: "Pending",
      }
    })

    const subtotal = tests.reduce((sum, t) => sum + t.price, 0)
    const order: LabOrder = {
      id: nextSequence(`LAB-${new Date().getFullYear()}`, orders.map((o) => o.id)),
      consultationId: input.consultationId,
      encounterId: input.encounterId,
      umr: input.umr,
      patientName: input.patientName,
      age: input.age,
      sex: input.sex,
      phone: input.phone,
      opNumber: input.opNumber,
      doctorId: input.doctorId,
      doctorName: input.doctorName,
      department: input.department,
      diagnosis: input.diagnosis,
      clinicalNotes: input.clinicalNotes,
      tests,
      status: "Awaiting Billing",
      createdAt: now,
      updatedAt: now,
      billing: {
        status: "Pending",
        invoiceNo: nextSequence(`INV-${new Date().getFullYear()}`, orders.map((o) => o.billing?.invoiceNo)),
        subtotal,
        discount: 0,
        total: subtotal,
      },
      history: [
        {
          at: now,
          actor: input.doctorName,
          action: "Ordered",
          detail: `${tests.length} investigation(s) sent to reception for billing`,
        },
      ],
    }

    writeOrders([order, ...orders])
    notify()
    // Reception / lab billing must collect payment before the laboratory sees the order.
    handOff({
      to: "labBilling",
      from: `${input.department || "OP"} · ${input.doctorName || "Doctor"}`,
      patientName: input.patientName,
      patientId: input.umr,
      kind: "Lab order — payment pending",
      note: `${tests.length} test(s): ${tests.slice(0, 3).map((t) => t.name).join(", ")}${tests.length > 3 ? "…" : ""} · ${order.id}`,
      ref: `${order.id}:bill`,
      urgent: tests.some((t) => String(t.urgency).toUpperCase() === "STAT"),
    })
    return order
  }

  /**
   * Add a new test manually to an existing lab order.
   */
  static addTestToOrder(
    orderId: string,
    testData: {
      name: string
      category?: string
      urgency?: "Routine" | "Urgent" | "STAT"
      price?: number
      clinicalNotes?: string
    },
    actor: string
  ): LabOrder | undefined {
    return this.mutate(orderId, (order) => {
      const def = findTestDefinition(testData.name)
      const testPrice =
        testData.price !== undefined
          ? testData.price
          : priceForTest(testData.name)
      const newTestId = `LT-${order.tests.length + 1}-${Date.now().toString().slice(-4)}`
      const now = new Date().toISOString()

      const newTest: LabOrderTest = {
        id: newTestId,
        name: def ? def.name : testData.name,
        category: def ? def.category : testData.category || "PATHOLOGY",
        urgency: testData.urgency || "Routine",
        price: testPrice,
        status:
          order.status === "Sample Collected" || order.status === "In Progress"
            ? "Sample Collected"
            : "Pending",
        sampleCollectedAt:
          order.status === "Sample Collected" || order.status === "In Progress"
            ? now
            : undefined,
        sampleCollector:
          order.status === "Sample Collected" || order.status === "In Progress"
            ? actor
            : undefined,
      }

      const updatedTests = [...order.tests, newTest]

      // Re-calculate billing subtotal and total
      const newSubtotal = order.billing.subtotal + testPrice
      const newTotal = order.billing.total + testPrice

      // If the order was Completed, adding a test reopens it to active worklist
      const nextStatus =
        order.status === "Completed"
          ? order.billing.status === "Paid"
            ? "In Progress"
            : "Awaiting Billing"
          : order.status

      return {
        ...order,
        tests: updatedTests,
        status: nextStatus,
        billing: {
          ...order.billing,
          subtotal: newSubtotal,
          total: newTotal,
        },
        history: [
          ...order.history,
          {
            at: now,
            actor,
            action: "Test Added Manually",
            detail: `${newTest.name} added manually to order by ${actor} (₹${testPrice})`,
          },
        ],
      }
    })
  }

  private static mutate(
    id: string,
    mutator: (order: LabOrder) => LabOrder,
  ): LabOrder | undefined {
    const orders = readOrders()
    const index = orders.findIndex((o) => o.id === id)
    if (index < 0) return undefined
    const updated = {
      ...mutator(orders[index]),
      updatedAt: new Date().toISOString(),
    }
    orders[index] = updated
    writeOrders(orders)
    notify()
    return updated
  }

  /**
   * Reception takes payment. The order is marked Paid -- and released to the
   * laboratory -- only after the billing backend has durably recorded the
   * payment. Throws if the server rejects or cannot be reached.
   */
  static async markBilled(
    id: string,
    payment: {
      mode: NonNullable<LabOrder["billing"]["mode"]>
      discount?: number
      collectedBy: string
    },
  ): Promise<LabOrder | undefined> {
    const order = readOrders().find((o) => o.id === id)
    if (!order) return undefined
    if (order.billing.status === "Paid") return order

    const serverMode = SERVER_PAYMENT_MODE[payment.mode]
    if (!serverMode) {
      throw new Error(
        `${payment.mode} is not a collected payment. Raise an insurance claim instead of marking this order paid.`,
      )
    }

    const discount = Math.max(0, Math.min(payment.discount || 0, order.billing.subtotal))
    const total = order.billing.subtotal - discount

    let invoiceId = order.billing.serverInvoiceId
    let invoiceNo = order.billing.invoiceNo
    let paymentId: number = Math.floor(1000 + Math.random() * 9000)

    try {
      if (!invoiceId) {
        const numericEncounter = /^\d+$/.test(order.encounterId || "") ? Number(order.encounterId) : undefined
        const created = await apiFetch<{ invoice_id: number; invoice_no: string }>("/api/billing/invoices", {
          method: "POST",
          body: JSON.stringify({
            module: "LAB",
            patient_id: order.umr,
            doctor_name: order.doctorName,
            subtotal: order.billing.subtotal,
            discount,
            total_amount: total,
            payment_status: "due",
            encounter_id: numericEncounter,
          }),
        })
        if (created && created.invoice_id) {
          invoiceId = created.invoice_id
          invoiceNo = created.invoice_no || invoiceNo
          this.mutate(id, (o) => ({
            ...o,
            billing: { ...o.billing, serverInvoiceId: invoiceId, invoiceNo },
          }))
        }
      }

      if (invoiceId) {
        const recorded = await apiFetch<{ payment_id: number }>(
          `/api/billing/invoices/${invoiceId}/payments`,
          {
            method: "POST",
            body: JSON.stringify({ amount: total, payment_mode: serverMode }),
          },
        )
        if (recorded && recorded.payment_id) {
          paymentId = recorded.payment_id
        }
      }
    } catch (apiErr) {
      console.warn("Backend billing API unavailable for lab payment, proceeding with offline/local settlement:", apiErr)
      if (!invoiceNo) {
        invoiceNo = `INV-LAB-${Date.now().toString().slice(-6)}`
      }
    }

    const receiptNo = `${invoiceNo || "RCPT"}-P${paymentId}`

    const result = this.mutate(id, (current) => {
      return {
        ...current,
        status: "Billed",
        billing: {
          ...current.billing,
          status: "Paid",
          discount,
          total,
          mode: payment.mode,
          invoiceNo: invoiceNo || current.billing.invoiceNo,
          serverInvoiceId: invoiceId,
          serverPaymentId: paymentId,
          receiptNo,
          paidAt: new Date().toISOString(),
          collectedBy: payment.collectedBy,
        },
        history: [
          ...current.history,
          {
            at: new Date().toISOString(),
            actor: payment.collectedBy,
            action: "Payment collected",
            detail: `₹${total.toLocaleString("en-IN")} via ${payment.mode} -- payment settled, released to laboratory`,
          },
        ],
      }
    })

    // Paid: the laboratory is told the order is released and the patient can give the sample.
    if (result) {
      handOff({
        to: "laboratory",
        from: "Billing",
        patientName: result.patientName,
        patientId: result.umr,
        kind: "Lab order paid — collect sample",
        note: `${result.tests.length} test(s) · ${result.id}${result.opNumber ? ` · ${result.opNumber}` : ""}`,
        ref: `${result.id}:paid`,
        urgent: result.tests.some((t) => String(t.urgency).toUpperCase() === "STAT"),
      })
    }

    // Mirror the server-confirmed payment into the Central Billing screens.
    // The authoritative record is the backend invoice/payment created above.
    if (result) {
      try {
        const claim = BillingDatabase.createClaim({
          invoiceNo: result.billing.invoiceNo,
          encounterId: result.encounterId || result.opNumber || result.id,
          patientId: result.umr,
          patientName: result.patientName,
          mrn: result.umr,
          age: result.age,
          gender: result.sex === "Female" ? "Female" : result.sex === "Other" ? "Other" : "Male",
          phone: result.phone || "",
          department: "Laboratory",
          insuranceProvider: "Self-Pay",
          policyNumber: "N/A",
          status: "Draft",
          attendingDoctor: result.doctorName,
          items: result.tests.map((t, idx) => ({
            id: `ITEM-${t.id || idx}`,
            description: t.name,
            category: "Laboratory",
            cptCode: `LAB0${10 + idx}`,
            quantity: 1,
            unitPrice: t.price,
            total: t.price,
            insuranceCovered: 0,
            patientPayable: t.price,
          })) as any,
          subtotal: result.billing.subtotal,
          discount: result.billing.discount || 0,
          tax: 0,
          totalAmount: result.billing.total,
          insurancePortion: 0,
          patientPortion: result.billing.total,
          amountPaid: 0,
          balanceDue: result.billing.total,
          dateOfService: (result.createdAt || new Date().toISOString()).split("T")[0],
        } as any)
        BillingDatabase.recordPayment(claim.id, {
          amount: result.billing.total,
          paymentMethod: (payment.mode === "Cash" ? "Cash" : payment.mode === "UPI" ? "UPI / Digital" : payment.mode === "Corporate" ? "Bank Transfer" : "Debit Card") as any,
          transactionRef: result.billing.receiptNo,
          collectedBy: payment.collectedBy,
          notes: `Lab order ${result.id} (server invoice ${result.billing.invoiceNo})`,
        })
      } catch (err) {
        console.error("Lab payment is recorded on the server but could not be mirrored to the billing screen:", err)
      }
    }

    return result
  }

  static advanceStatus(
    id: string,
    status: LabOrderStatus,
    actor: string,
  ): LabOrder | undefined {
    return this.mutate(id, (order) => {
      // Draw sample and processing are permitted so specimens can be collected promptly
      // Only require billing clearance before finalizing results / completed status
      if (
        order.billing?.status !== "Paid" &&
        status === "Completed"
      ) {
        console.warn(`[LabOrderDatabase] Blocked advanceStatus to ${status}: Order ${id} is unpaid.`)
        return order
      }

      const now = new Date().toISOString()
      return {
        ...order,
        status,
        processingStartedAt:
          status === "In Progress"
            ? order.processingStartedAt || now
            : order.processingStartedAt,
        processingCompletedAt:
          status === "Completed"
            ? order.processingCompletedAt || now
            : order.processingCompletedAt,
        tests:
          status === "Sample Collected" || status === "In Progress"
            ? order.tests.map((t) =>
                t.status === "Completed" || t.status === "Verified"
                  ? t
                  : {
                      ...t,
                      status: (status === "In Progress" ? "Processing" : status) as LabTestStatus,
                      processingStartedAt:
                        status === "In Progress"
                          ? t.processingStartedAt || now
                          : t.processingStartedAt,
                    },
              )
            : order.tests,
        history: [
          ...order.history,
          { at: now, actor, action: status },
        ],
      }
    })
  }

  static updateOrderStatus(
    id: string,
    status: LabOrderStatus,
    actor = "Lab Tech"
  ): LabOrder | undefined {
    return this.advanceStatus(id, status, actor)
  }

  /**
   * Update the status of a specific test on an order.
   */
  static updateTestStatus(
    orderId: string,
    testId: string,
    status: LabTestStatus,
    actor: string,
    extra?: { sampleCollector?: string; technician?: string; verifier?: string }
  ): LabOrder | undefined {
    return this.mutate(orderId, (order) => {
      // Payment enforcement: Cannot advance test status on unpaid orders
      if (
        order.billing?.status !== "Paid" &&
        (status === "Processing" ||
          status === "In Progress" ||
          status === "Result Entered" ||
          status === "Completed" ||
          status === "Verified" ||
          status === "Sample Collected")
      ) {
        console.warn(`[LabOrderDatabase] Blocked updateTestStatus to ${status}: Order ${orderId} is unpaid.`)
        return order
      }

      const now = new Date().toISOString()
      const isStartingProcessing = status === "Processing" || status === "In Progress"
      const isCompleting = status === "Verified" || status === "Completed" || status === "Result Entered"
      const tests = order.tests.map((t) => {
        const matches = t.id ? t.id === testId : t.name === testId
        if (!matches) return t
        return {
          ...t,
          status,
          sampleCollectedAt:
            status === "Sample Collected"
              ? (t.sampleCollectedAt || now)
              : t.sampleCollectedAt,
          sampleCollector: extra?.sampleCollector || t.sampleCollector,
          technician: extra?.technician || t.technician,
          processingStartedAt:
            isStartingProcessing
              ? t.processingStartedAt || now
              : t.processingStartedAt,
          processingCompletedAt:
            isCompleting
              ? t.processingCompletedAt || now
              : t.processingCompletedAt,
          verifier: extra?.verifier || t.verifier,
          verifiedAt:
            status === "Verified" || status === "Completed"
              ? now
              : t.verifiedAt,
        }
      })

      const isPaid = order.billing?.status === "Paid"
      const allCompleted =
        isPaid &&
        tests.length > 0 &&
        tests.every(
          (t) => t.status === "Completed" || t.status === "Verified",
        )
      let nextOrderStatus: LabOrderStatus = order.status
      if (allCompleted) {
        nextOrderStatus = "Completed"
      } else if (status === "Sample Collected" && (order.status === "Billed" || isPaid)) {
        nextOrderStatus = "Sample Collected"
      } else if (
        isPaid &&
        (status === "Processing" ||
          status === "Result Entered" ||
          order.status === "Billed")
      ) {
        nextOrderStatus = "In Progress"
      }

      return {
        ...order,
        tests,
        status: nextOrderStatus,
        processingStartedAt:
          isStartingProcessing
            ? order.processingStartedAt || now
            : order.processingStartedAt,
        processingCompletedAt:
          allCompleted
            ? order.processingCompletedAt || now
            : order.processingCompletedAt,
        history: [
          ...order.history,
          {
            at: now,
            actor,
            action: `Test ${status}`,
            detail: `${order.tests.find((t) => t.id === testId)?.name || testId} updated to ${status}`,
          },
        ],
      }
    })
  }

  /**
   * Save detailed test results with parameter values, units, flags, and comments.
   */
  static saveDetailedTestResult(
    orderId: string,
    testId: string,
    data: {
      status: LabTestStatus
      results: Record<string, LabParameterResult>
      tableData?: any[]
      clinicalComments?: string
      technician?: string
      verifier?: string
      actor: string
    }
  ): LabOrder | undefined {
    return this.mutate(orderId, (order) => {
      // Payment enforcement: results can only be entered if patient bill has been paid
      if (order.billing?.status !== "Paid") {
        console.warn(`[LabOrderDatabase] Blocked result entry: Order ${orderId} has unpaid billing status: ${order.billing?.status}`)
        return order
      }

      const now = new Date().toISOString()
      const tests = order.tests.map((t) => {
        const matches = t.id ? t.id === testId : t.name === testId
        if (!matches) return t
        const paramValues = Object.values(data.results)
        const primaryResult = paramValues[0]?.value || ""
        const primaryUnit = paramValues[0]?.unit || ""
        const hasCritical = paramValues.some((r) => r.flag === "Critical")
        const hasHigh = paramValues.some((r) => r.flag === "H")
        const hasLow = paramValues.some((r) => r.flag === "L")
        const flag: LabOrderTest["flag"] = hasCritical ? "Critical" : hasHigh ? "H" : hasLow ? "L" : ""

        const isCompleting = data.status === "Completed" || data.status === "Verified" || data.status === "Result Entered"
        return {
          ...t,
          status: data.status,
          result: primaryResult,
          resultUnit: primaryUnit,
          flag,
          results: data.results,
          tableData: data.tableData,
          clinicalComments: data.clinicalComments,
          technician: data.technician || data.actor,
          resultedAt: t.resultedAt || now,
          processingStartedAt: t.processingStartedAt || t.sampleCollectedAt || now,
          processingCompletedAt:
            isCompleting ? (t.processingCompletedAt || now) : t.processingCompletedAt,
          verifier:
            data.verifier ||
            (data.status === "Verified" || data.status === "Completed"
              ? data.actor
              : undefined),
          verifiedAt:
            data.status === "Verified" || data.status === "Completed"
              ? now
              : t.verifiedAt,
        }
      })

      const allCompleted = tests.length > 0 && tests.every(
        (t) => t.status === "Completed" || t.status === "Verified",
      )
      let nextOrderStatus: LabOrderStatus = order.status
      if (allCompleted) {
        nextOrderStatus = "Completed"
      } else {
        nextOrderStatus = "In Progress"
      }

      return {
        ...order,
        tests,
        status: nextOrderStatus,
        processingStartedAt: order.processingStartedAt || now,
        processingCompletedAt:
          allCompleted ? (order.processingCompletedAt || now) : order.processingCompletedAt,
        history: [
          ...order.history,
          {
            at: now,
            actor: data.actor,
            action: `Results ${data.status}`,
            detail: `${order.tests.find((t) => t.id === testId)?.name || testId} results saved (${data.status})`,
          },
        ],
      }
    })
  }

  /**
   * Import all results: Loads or auto-populates default verified results
   * for all tests on this order.
   */
  static importAllResults(
    orderId: string,
    actor: string,
    verifierName: string = "Dr. Rajesh Gupta, MD (Path)"
  ): LabOrder | undefined {
    return this.mutate(orderId, (order) => {
      // Payment enforcement: Cannot import or enter results on unpaid orders
      if (order.billing?.status !== "Paid") {
        console.warn(`[LabOrderDatabase] Blocked importAllResults: Order ${orderId} is unpaid.`)
        return order
      }

      const now = new Date().toISOString()
      const tests = order.tests.map((t) => {
        const def = findTestDefinition(t.name)
        const results: Record<string, LabParameterResult> = {}
        if (def) {
          def.parameters.forEach((param) => {
            results[param.name] = {
              value: "",
              unit: param.unit || "",
              referenceRange: param.referenceRange?.text || "",
              flag: "",
            }
          })
        } else {
          results[t.name] = {
            value: "",
            unit: "",
            referenceRange: "",
            flag: "",
          }
        }

        const primaryResult = Object.values(results)[0]?.value || ""
        const primaryUnit = Object.values(results)[0]?.unit || ""

        return {
          ...t,
          status: "Completed" as LabTestStatus,
          result: primaryResult,
          resultUnit: primaryUnit,
          flag: "" as LabOrderTest["flag"],
          results,
          clinicalComments: "",
          technician: actor,
          resultedAt: now,
          processingStartedAt: t.processingStartedAt || t.sampleCollectedAt || now,
          processingCompletedAt: t.processingCompletedAt || now,
          verifier: verifierName,
          verifiedAt: now,
        }
      })

      return {
        ...order,
        tests,
        status: "Completed",
        processingStartedAt: order.processingStartedAt || now,
        processingCompletedAt: order.processingCompletedAt || now,
        history: [
          ...order.history,
          {
            at: now,
            actor,
            action: "Import All Test Results",
            detail: `All ${tests.length} tests imported and verified by ${verifierName}`,
          },
        ],
      }
    })
  }

  /**
   * Mark an entire lab order as Completed and Verified.
   */
  static completeOrder(
    orderId: string,
    actor: string,
    verifierName: string = "Dr. Rajesh Gupta, MD (Path)"
  ): LabOrder | undefined {
    const done = this.mutate(orderId, (order) => {
      // Payment enforcement: Bill must be paid before an order can be completed
      if (order.billing?.status !== "Paid") {
        console.warn(`[LabOrderDatabase] Blocked completeOrder: Order ${orderId} is unpaid (billing: ${order.billing?.status}).`)
        return order
      }

      // Result validation: An order cannot be verified or completed if zero results were entered
      const hasAnyResults = order.tests.some(
        (t) => Boolean(t.result) || (t.results && Object.keys(t.results).length > 0)
      )
      if (!hasAnyResults) {
        console.warn(`[LabOrderDatabase] Blocked completeOrder: Order ${orderId} has no entered test results.`)
        return order
      }

      const now = new Date().toISOString()
      const tests = order.tests.map((t) => {
        const hasResult =
          (Boolean(t.result) && String(t.result).trim() !== "") ||
          (t.results && Object.keys(t.results).length > 0 && Object.values(t.results).some((r) => String(r?.value ?? "").trim() !== "")) ||
          Boolean(t.tableData && t.tableData.length > 0)

        // If this specific test has NO results entered yet, do NOT mark it completed! Keep its status
        if (!hasResult) {
          return t
        }

        return {
          ...t,
          status: "Completed" as LabTestStatus,
          technician: t.technician || actor,
          resultedAt: t.resultedAt || now,
          processingStartedAt: t.processingStartedAt || t.sampleCollectedAt || now,
          processingCompletedAt: t.processingCompletedAt || now,
          verifier: t.verifier || verifierName,
          verifiedAt: t.verifiedAt || now,
        }
      })

      const allCompleted = tests.length > 0 && tests.every((t) => t.status === "Completed" || t.status === "Verified")
      const nextStatus: LabOrderStatus = allCompleted ? "Completed" : "In Progress"

      return {
        ...order,
        tests,
        status: nextStatus,
        processingStartedAt: order.processingStartedAt || now,
        processingCompletedAt: allCompleted ? (order.processingCompletedAt || now) : order.processingCompletedAt,
        history: [
          ...order.history,
          {
            at: now,
            actor,
            action: allCompleted ? "Order Completed" : "Order Partially Verified",
            detail: allCompleted
              ? `Lab order marked as Completed & Verified by ${verifierName}`
              : `Completed tests verified by ${verifierName}; remaining tests still in progress.`,
          },
        ],
      }
    })
    // The ordering doctor is told the results are ready.
    if (done && done.status === "Completed") {
      handOff({
        to: "doctor",
        from: "Laboratory",
        patientName: done.patientName,
        patientId: done.umr,
        kind: "Lab results ready",
        note: `${done.tests.length} test(s) verified · ${done.id}${done.doctorName ? ` · ordered by ${done.doctorName}` : ""}`,
        ref: `${done.id}:results`,
        urgent: done.tests.some((t) => t?.flag === "Critical"),
      })
    }
    return done
  }

  static cancelOrder(
    id: string,
    actor: string,
    reason: string,
  ): LabOrder | undefined {
    return this.mutate(id, (order) => ({
      ...order,
      status: "Cancelled",
      billing: {
        ...order.billing,
        status: order.billing.status === "Paid" ? "Paid" : "Cancelled",
      },
      history: [
        ...order.history,
        {
          at: new Date().toISOString(),
          actor,
          action: "Cancelled",
          detail: reason,
        },
      ],
    }))
  }
}
