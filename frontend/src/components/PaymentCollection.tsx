import React, { useState, useEffect, useMemo } from "react"
import {
  BillingDatabase,
  ClaimRecord,
  DepartmentType,
  PaymentRecord,
  normalizeUmr,
} from "../services/billingDb"
import HospitalReceiptModal from "./HospitalReceiptModal"
import { BillingHeader, KpiTile, headerBtnSoft } from "./billing/BillingChrome"
import {
  CalendarDays,
  Download,
  History,
  Hourglass,
  IndianRupee,
  Receipt,
} from "lucide-react"

export default function PaymentCollection() {
  // ── Tab State ───────────────────────────────────────────────────────────────
  // Only the ledger lives here; collecting payment is the Billing Counter's
  // job (its own sidebar page), so the old in-page POS desk was removed.
  const activeTab = "payment_history" as const

  // ── Data State ──────────────────────────────────────────────────────────────
  const [claims, setClaims] = useState<ClaimRecord[]>([])
  const [paymentsList, setPaymentsList] = useState<(PaymentRecord & {
    patientName: string;
    patientId: string;
    mrn: string;
    invoiceNo: string;
    department: DepartmentType;
  })[]>([])

  // "By patient" shows what each patient has paid the hospital in total; "All receipts" is the ledger.
  const [viewMode, setViewMode] = useState<"patients" | "receipts">("patients")
  const [focusPatientKey, setFocusPatientKey] = useState<string | null>(null)

  // ── Filters for Payment History Ledger ──────────────────────────────────────
  const [historySearch, setHistorySearch] = useState("")
  const [historyDeptFilter, setHistoryDeptFilter] =
    useState<DepartmentType | "All">("All")
  const [historyMethodFilter, setHistoryMethodFilter] = useState<string>("All")
  const [historyDateFilter, setHistoryDateFilter] =
    useState<"all" | "today" | "week" | "month">("all")

  // ── Receipt Modal State (Standard Reference Layout) ─────────────────────────
  const [receiptModalData, setReceiptModalData] = useState<{
    claim: ClaimRecord
    payment: PaymentRecord
  } | null>(null)

  // ── Toast Notifications ─────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Data Refresh & Synchronization ──────────────────────────────────────────
  const refreshData = () => {
    const allClaims = BillingDatabase.getClaims()
    setClaims(allClaims)
    const allPayments = BillingDatabase.getAllPayments()
    setPaymentsList(allPayments)
  }

  useEffect(() => {
    refreshData()
    const unsub = BillingDatabase.onUpdate(refreshData)
    return () => unsub()
  }, [])

  const patientKeyOf = (p: { patientId?: string; mrn?: string; patientName?: string }) =>
    normalizeUmr(p.patientId || p.mrn) || (p.patientName || "").trim().toLowerCase()

  // ── The ledger: every receipt exactly once ───────────────────────────────────
  // The same payment can be reachable from more than one bill (the OP bill, a consolidated
  // investigation bill, a lab order), so the raw list can contain it twice. Every figure on this
  // screen is computed from this de-duplicated list, never from the bills' own "amount paid"
  // fields, so the totals add up to the receipts shown.
  const ledger = useMemo(() => {
    const seen = new Set<string>()
    return paymentsList.filter((p) => {
      // Receipt + patient + amount: the same payment reached through two bills matches on all three,
      // while two different patients who were given the same receipt number do not.
      const key = p.receiptNo ? `R:${p.receiptNo}|${patientKeyOf(p)}|${Number(p.amount)}` : `I:${p.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return Number(p.amount) > 0 || Number(p.amount) < 0
    })
  }, [paymentsList])

  // ── Per-patient totals ──────────────────────────────────────────────────────
  const patientSummaries = useMemo(() => {
    type Row = {
      key: string
      name: string
      umr: string
      paid: number
      receipts: number
      last: string
      byMode: Record<string, number>
      billed: number
      due: number
      bills: number
      billsPaid: number
    }
    const rows = new Map<string, Row>()
    const row = (key: string, name: string, umr: string): Row => {
      let r = rows.get(key)
      if (!r) rows.set(key, (r = { key, name, umr, paid: 0, receipts: 0, last: "", byMode: {}, billed: 0, due: 0, bills: 0, billsPaid: 0 }))
      return r
    }
    for (const p of ledger) {
      const r = row(patientKeyOf(p), p.patientName || "Patient", p.patientId || p.mrn || "")
      r.paid += Number(p.amount) || 0
      r.receipts += 1
      r.byMode[p.paymentMethod] = (r.byMode[p.paymentMethod] || 0) + (Number(p.amount) || 0)
      if (p.paymentDate && (!r.last || new Date(p.paymentDate) > new Date(r.last))) r.last = p.paymentDate
    }
    const seenBill = new Set<string>()
    for (const c of claims) {
      if (c.status === "Voided" || seenBill.has(c.id)) continue
      seenBill.add(c.id)
      const r = row(patientKeyOf(c), c.patientName, c.patientId || c.mrn || "")
      r.billed += Number(c.totalAmount) || 0
      r.due += Number(c.balanceDue) || 0
      r.billsPaid += Number(c.amountPaid) || 0
      r.bills += 1
    }
    const q = historySearch.trim().toLowerCase()
    return [...rows.values()]
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.umr.toLowerCase().includes(q))
      .filter((r) => r.paid > 0 || r.billed > 0)
      .sort((a, b) => b.paid - a.paid)
  }, [ledger, claims, historySearch])

  // ── Financial Metrics ───────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalCollected = ledger.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
    const seenBill = new Set<string>()
    const totalOutstanding = claims.reduce((sum, c) => {
      if (c.status === "Voided" || seenBill.has(c.id)) return sum
      seenBill.add(c.id)
      return sum + (c.balanceDue || 0)
    }, 0)
    // "Today" is the calendar day in the user's own timezone (IST here). It used the UTC date, so
    // between midnight and 05:30 IST it counted yesterday's receipts as today's.
    const todayLocal = new Date().toDateString()
    const todayPayments = ledger.filter(
      (p) => p.paymentDate && new Date(p.paymentDate).toDateString() === todayLocal,
    )
    const todayCollected = todayPayments.reduce((sum, p) => sum + p.amount, 0)

    return {
      totalCollected,
      totalOutstanding,
      // Real ledger figures only -- no estimated fallbacks.
      totalReceipts: ledger.length,
      todayCollected,
      avgReceipt:
        ledger.length > 0
          ? Math.round(totalCollected / ledger.length)
          : 0,
    }
  }, [claims, ledger])

  // ── Filtered Payment History Ledger ─────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    // Only receipts that were actually issued. (An empty ledger used to be
    // padded with invented receipts carrying random numbers.)
    return ledger.filter((p) => {
      if (focusPatientKey && patientKeyOf(p) !== focusPatientKey) return false
      // Search
      if (historySearch.trim() && !focusPatientKey) {
        const q = historySearch.toLowerCase()
        const matchName = p.patientName?.toLowerCase().includes(q)
        const matchUmr =
          p.patientId?.toLowerCase().includes(q) ||
          p.mrn?.toLowerCase().includes(q)
        const matchRcpt = p.receiptNo?.toLowerCase().includes(q)
        const matchInv = p.invoiceNo?.toLowerCase().includes(q)
        const matchTxn = p.transactionRef?.toLowerCase().includes(q)
        if (!matchName && !matchUmr && !matchRcpt && !matchInv && !matchTxn)
          return false
      }

      // Department
      if (historyDeptFilter !== "All") {
        const filterLower = historyDeptFilter.toLowerCase()
        const pDeptLower = (p.department || "").toLowerCase()
        const matchDept =
          pDeptLower === filterLower ||
          (filterLower === "laboratory" && (pDeptLower.includes("lab") || pDeptLower.includes("diag"))) ||
          (filterLower === "radiology" && (pDeptLower.includes("rad") || pDeptLower.includes("imag")))
        if (!matchDept) return false
      }

      // Method
      if (
        historyMethodFilter !== "All" &&
        p.paymentMethod !== historyMethodFilter
      ) {
        return false
      }

      // Date Range (calendar based: "today" is today, not "within 24 hours")
      if (historyDateFilter !== "all" && p.paymentDate) {
        const d = new Date(p.paymentDate)
        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const diffDays = (startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000
        if (historyDateFilter === "today" && diffDays !== 0) return false
        if (historyDateFilter === "week" && diffDays > 6) return false
        if (historyDateFilter === "month" && diffDays > 29) return false
      }

      return true
    })
  }, [
    ledger,
    focusPatientKey,
    claims,
    historySearch,
    historyDeptFilter,
    historyMethodFilter,
    historyDateFilter,
  ])

  // ── Export Payment History CSV ──────────────────────────────────────────────
  const handleExportHistoryCSV = () => {
    try {
      const headers = [
        "Receipt No",
        "Date",
        "Patient Name",
        "UMR",
        "Invoice No",
        "Department",
        "Payment Mode",
        "Amount (INR)",
        "Txn Reference",
        "Cashier",
      ]
      const rows = filteredHistory.map((p) => [
        p.receiptNo || "",
        p.paymentDate ? new Date(p.paymentDate).toLocaleString() : "",
        `"${p.patientName || ""}"`,
        p.patientId || p.mrn || "",
        p.invoiceNo || "",
        p.department || "",
        p.paymentMethod || "",
        p.amount || 0,
        p.transactionRef || "",
        `"${p.collectedBy || ""}"`,
      ])

      const csvContent = [
        headers.join(","),
        ...rows.map((r) => r.join(",")),
      ].join("\n")
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.setAttribute("href", url)
      link.setAttribute(
        "download",
        `Payment_History_Ledger_${new Date().toISOString().split("T")[0]}.csv`,
      )
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      showToast("Payment History CSV exported successfully!", "success")
    } catch {
      showToast("Failed to export payment history CSV", "error")
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F1F5F9] overflow-hidden">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-[13px] font-medium flex items-center gap-2.5 ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : toast.type === "info"
              ? "bg-blue-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "info" ? "ℹ️" : "⚠️"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      <BillingHeader
        icon={History}
        title="Payment History"
        pill="Ledger"
        subtitle="Every collection and receipt issued at all billing counters."
        actions={
          <button type="button" onClick={handleExportHistoryCSV} className={headerBtnSoft}>
            <Download size={13} /> Export CSV
          </button>
        }
      />

      <div className="px-5 pt-5 grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <KpiTile tone="emerald" icon={IndianRupee} label="Total collections" value={`₹${metrics.totalCollected.toLocaleString("en-IN")}`} />
        <KpiTile tone="blue" icon={CalendarDays} label="Today's collections" value={`₹${metrics.todayCollected.toLocaleString("en-IN")}`} />
        <KpiTile tone="amber" icon={Hourglass} label="Outstanding dues" value={`₹${metrics.totalOutstanding.toLocaleString("en-IN")}`} />
        <KpiTile tone="purple" icon={Receipt} label="Receipts issued" value={metrics.totalReceipts} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-5">
        {/* =========================================================================
            VIEW 1: PAYMENT HISTORY & RECEIPTS LEDGER
           ========================================================================= */}
        {activeTab === "payment_history" && (
          <div className="bg-white border border-[#CBD5E1] shadow-2xs overflow-hidden flex flex-col w-full">
            {/* Filter Bar */}
            <div className="p-4 border-b border-[#DDE2EC] bg-[#F8FAFC] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[280px] max-w-md">
                  <div className="relative w-full">
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search patient, UMR, Receipt #, Invoice #, Txn Ref..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#CBD5E1] focus:outline-none focus:border-[#1B4FD8] bg-white text-gray-900"
                    />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                      🔍
                    </span>
                    {historySearch && (
                      <button
                        type="button"
                        onClick={() => setHistorySearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Department Filter */}
                  <select
                    value={historyDeptFilter}
                    onChange={(e) =>
                      setHistoryDeptFilter(e.target.value as any)
                    }
                    className="px-2.5 py-1.5 bg-white border border-[#CBD5E1] font-medium text-slate-700 focus:outline-none focus:border-[#1B4FD8]"
                  >
                    <option value="All">All Departments</option>
                    <option value="Outpatient">Outpatient</option>
                    <option value="Inpatient">Inpatient Wards</option>
                    <option value="Emergency">Emergency</option>
                    <option value="ICU">ICU</option>
                    <option value="Surgery">Surgery &amp; OT</option>
                    <option value="Laboratory">Laboratory</option>
                    <option value="Radiology">Radiology</option>
                  </select>

                  {/* Payment Method Filter */}
                  <select
                    value={historyMethodFilter}
                    onChange={(e) => setHistoryMethodFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-[#CBD5E1] font-medium text-slate-700 focus:outline-none focus:border-[#1B4FD8]"
                  >
                    <option value="All">All Payment Modes</option>
                    <option value="UPI / Digital">UPI / Digital</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Debit Card">Debit Card</option>
                    <option value="Insurance Copay">Insurance Copay</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>

                  {/* Date Range Filter */}
                  <div className="flex items-center bg-white border border-[#CBD5E1] text-[11px] font-semibold">
                    {(["all", "today", "week", "month"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setHistoryDateFilter(r)}
                        className={`px-2.5 py-1 cursor-pointer transition-colors capitalize ${
                          historyDateFilter === r
                            ? "bg-[#0F172A] text-white"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {r === "all" ? "All Time" : r === "week" ? "7 Days" : r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* View switch + patient totals */}
            <div className="px-4 pt-3 flex items-center gap-2 border-b border-[#DDE2EC] bg-white">
              {([["patients", "By patient (total spent)"], ["receipts", "All receipts"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setViewMode(k); if (k === "patients") setFocusPatientKey(null) }}
                  className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px cursor-pointer ${
                    viewMode === k ? "border-[#1B4FD8] text-[#1B4FD8]" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {focusPatientKey && (() => {
              const r = patientSummaries.find((x) => x.key === focusPatientKey)
              if (!r) return null
              return (
                <div className="px-4 py-3 bg-[#EFF6FF] border-b border-[#BFDBFE] flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
                  <span className="font-bold text-[#1E3A8A]">{r.name} <span className="font-mono font-normal text-slate-500">{r.umr}</span></span>
                  <span>Total paid to hospital: <strong className="text-emerald-700">₹{r.paid.toLocaleString("en-IN")}</strong> across {r.receipts} receipt{r.receipts === 1 ? "" : "s"}</span>
                  <span className="text-slate-600">{Object.entries(r.byMode).map(([m, v]) => `${m} ₹${v.toLocaleString("en-IN")}`).join(" · ")}</span>
                  {r.due > 0 && <span className="text-amber-700">Still due: ₹{r.due.toLocaleString("en-IN")}</span>}
                  <button type="button" onClick={() => { setFocusPatientKey(null); setViewMode("patients") }} className="ml-auto text-[#1B4FD8] font-bold hover:underline cursor-pointer">← All patients</button>
                </div>
              )
            })()}

            {viewMode === "patients" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#DDE2EC] bg-[#FAFCFF] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                      <th className="px-4 py-3">Patient &amp; UMR</th>
                      <th className="px-4 py-3 text-right">Bills</th>
                      <th className="px-4 py-3 text-right">Total billed</th>
                      <th className="px-4 py-3 text-right">Total paid to hospital</th>
                      <th className="px-4 py-3 text-right">Outstanding</th>
                      <th className="px-4 py-3 text-right">Receipts</th>
                      <th className="px-4 py-3">Last payment</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] text-[12px]">
                    {patientSummaries.length === 0 ? (
                      <tr><td colSpan={8} className="py-12 text-center text-slate-500">No patient has been billed or has paid yet.</td></tr>
                    ) : (
                      patientSummaries.map((r) => (
                        <tr key={r.key} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[#0F172A]">{r.name}</div>
                            <div className="font-mono text-[11px] text-slate-500">{r.umr || "—"}</div>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">{r.bills}</td>
                          <td className="px-4 py-3 text-right font-mono">₹{r.billed.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">
                            ₹{r.paid.toLocaleString("en-IN")}
                            {r.billsPaid - r.paid > 0.5 && (
                              <div className="text-[10px] font-normal text-amber-700" title="The bills record more as paid than there are receipts for">
                                bills show ₹{r.billsPaid.toLocaleString("en-IN")} paid · ₹{(r.billsPaid - r.paid).toLocaleString("en-IN")} has no receipt
                              </div>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono ${r.due > 0 ? "text-amber-700 font-semibold" : "text-slate-400"}`}>₹{r.due.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{r.receipts}</td>
                          <td className="px-4 py-3 text-slate-600">{r.last ? new Date(r.last).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => { setFocusPatientKey(r.key); setViewMode("receipts") }}
                              className="px-2.5 py-1 border border-[#CBD5E1] text-[11px] font-bold text-[#1B4FD8] hover:bg-[#EFF6FF] cursor-pointer"
                            >
                              View receipts
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {patientSummaries.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#F8FAFC] border-t-2 border-[#CBD5E1] font-bold text-[12px]">
                        <td className="px-4 py-3">Total ({patientSummaries.length} patients)</td>
                        <td className="px-4 py-3 text-right">{patientSummaries.reduce((a, r) => a + r.bills, 0)}</td>
                        <td className="px-4 py-3 text-right font-mono">₹{patientSummaries.reduce((a, r) => a + r.billed, 0).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">₹{patientSummaries.reduce((a, r) => a + r.paid, 0).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-700">₹{patientSummaries.reduce((a, r) => a + r.due, 0).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right">{patientSummaries.reduce((a, r) => a + r.receipts, 0)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {/* Payment Ledger Table */}
            <div className={`overflow-x-auto ${viewMode === "patients" ? "hidden" : ""}`}>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DDE2EC] bg-[#FAFCFF] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                    <th className="px-4 py-3">Receipt No</th>
                    <th className="px-4 py-3">Payment Date</th>
                    <th className="px-4 py-3">Patient Name &amp; UMR</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Invoice #</th>
                    <th className="px-4 py-3">Payment Mode</th>
                    <th className="px-4 py-3 text-right">Amount Collected</th>
                    <th className="px-4 py-3">Txn Reference</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[12px]">
                  {filteredHistory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-12 text-center text-slate-500"
                      >
                        No transactions found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((p, idx) => {
                      const relatedClaim =
                        claims.find(
                          (c) =>
                            c.id === p.invoiceId || c.invoiceNo === p.invoiceNo,
                        ) ||
                        {
                          id: p.invoiceId || `CLM-${idx}`,
                          invoiceNo: p.invoiceNo || "—",
                          patientId: p.patientId || "—",
                          patientName: p.patientName || "Patient",
                          mrn: p.mrn || "—",
                          age: 0,
                          gender: "",
                          phone: "",
                          department: p.department || "Outpatient",
                          dateOfService: p.paymentDate
                            ? p.paymentDate.split("T")[0]
                            : "",
                          insuranceProvider: "Self-Pay",
                          policyNumber: "",
                          status: "Paid",
                          items: [
                            {
                              id: "ITEM-1",
                              description: `${p.department || "Hospital"} Services & Consultation`,
                              category: "Consultation",
                              cptCode: "99213",
                              quantity: 1,
                              unitPrice: p.amount,
                              total: p.amount,
                              insuranceCovered: 0,
                              patientPayable: p.amount,
                            },
                          ],
                          subtotal: p.amount,
                          discount: 0,
                          tax: 0,
                          totalAmount: p.amount,
                          insurancePortion: 0,
                          patientPortion: p.amount,
                          amountPaid: p.amount,
                          balanceDue: 0,
                          payments: [p],
                          diagnosisCodes: [],
                          attendingDoctor: "",
                          createdAt: p.paymentDate || new Date().toISOString(),
                          updatedAt: p.paymentDate || new Date().toISOString(),
                        } as unknown as ClaimRecord

                      return (
                        <tr
                          key={p.id || idx}
                          className="hover:bg-[#F8FAFC] transition-colors"
                        >
                          <td className="px-4 py-3 font-mono font-semibold text-[#0F172A]">
                            {p.receiptNo || "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {p.paymentDate
                              ? new Date(p.paymentDate).toLocaleString()
                              : "Today"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-gray-900">
                              {p.patientName}
                            </div>
                            <div className="text-[10.5px] font-mono text-slate-500">
                              UMR: {p.patientId || p.mrn}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-1.5 py-0.5 bg-slate-100 font-semibold text-[10.5px] text-slate-700">
                              {p.department}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-600 text-[11px]">
                            {p.invoiceNo || relatedClaim.invoiceNo}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-1.5 py-0.5 font-semibold text-[10.5px] ${
                                p.paymentMethod === "Cash"
                                  ? "bg-amber-100 text-amber-800"
                                  : p.paymentMethod === "UPI / Digital"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-purple-100 text-purple-800"
                              }`}
                            >
                              {p.paymentMethod}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-extrabold text-emerald-700 text-[13px]">
                            ₹{p.amount.toLocaleString("en-IN")}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-500 text-[11px]">
                            {p.transactionRef || "N/A"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setReceiptModalData({
                                  claim: relatedClaim,
                                  payment: p,
                                })
                              }}
                              className="px-2.5 py-1 border border-[#CBD5E1] hover:border-[#0F172A] text-[#334155] font-semibold text-[11px] cursor-pointer transition-colors mx-auto"
                            >
                              View receipt
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Standardized Reference Hospital Receipt Modal */}
      {receiptModalData && (
        <HospitalReceiptModal
          claim={receiptModalData.claim}
          payment={receiptModalData.payment}
          onClose={() => setReceiptModalData(null)}
        />
      )}
    </div>
  )
}
