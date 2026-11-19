import React, { useCallback, useEffect, useState } from "react"
import { Icon } from "./icons"
import { MessageCircle, X, Search } from "lucide-react"
import SendToPatientDialog from "./messaging/SendToPatientDialog"
import PhoneInput from "./ui/PhoneInput"
import { db } from "../services/db"
import { apiFetch } from "../lib/api"

interface FeedbackRow {
  id: number
  patient_name?: string | null
  rating: number | null
  comment: string | null
  status: string | null
  received_at: string | null
  phone_number?: string | null
}

const when = (iso?: string | null) => {
  if (!iso) return ""
  const d = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z")
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}
const initials = (n?: string | null) => (n || "Patient").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase() + ".").join("")

export default function PatientExperience() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<{ name: string; phone: string; id?: string }>({
    name: "",
    phone: "",
    id: "",
  })
  const [search, setSearch] = useState("")
  // What patients actually answered on WhatsApp (the server's feedback table): nothing here is made up.
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [summary, setSummary] = useState<{ total_responses: number; average_rating: number; unresolved_low_rated: number } | null>(null)
  const [loadError, setLoadError] = useState("")
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    try {
      const [f, sm] = await Promise.all([
        apiFetch<{ feedback: FeedbackRow[] }>("/api/whatsapp/feedback"),
        apiFetch<{ total_responses: number; average_rating: number; unresolved_low_rated: number }>("/api/whatsapp/feedback/summary"),
      ])
      setRows(Array.isArray(f?.feedback) ? f.feedback : [])
      setSummary(sm)
      setLoadError("")
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Feedback could not be loaded.")
    } finally {
      setLoaded(true)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = window.setInterval(load, 60000)
    return () => window.clearInterval(t)
  }, [load])
  const setStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/whatsapp/feedback/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) })
      await load()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The status could not be changed.")
    }
  }
  const low = rows.filter((r) => (r.rating ?? 5) <= 2 && (r.status || "New") !== "Resolved")
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const csv = [["Received", "Patient", "Rating", "Comment", "Status"].map(esc).join(","), ...rows.map((r) => [r.received_at, r.patient_name, r.rating, r.comment, r.status].map(esc).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
    a.download = "patient-feedback.csv"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const encounters = db.getEncounters().slice(0, 10)
  const filtered = encounters.filter(
    (e) =>
      !search ||
      e.patientName.toLowerCase().includes(search.toLowerCase()) ||
      (e.phone && e.phone.includes(search)) ||
      (e.umr && e.umr.toLowerCase().includes(search.toLowerCase())),
  )

  const handleStartFeedback = (p: { name: string; phone: string; id?: string }) => {
    setSelectedPatient(p)
    setPickerOpen(false)
    setDialogOpen(true)
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F0F2F5]">
      <div className="bg-white border-b border-[#DDE2EC] px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            Patient Experience
          </h1>
          <p className="text-[12.5px] text-[#64748B]">
            Monitor feedback, satisfaction scores, and patient relations.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-medium rounded transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <MessageCircle size={14} /> Request Feedback (WhatsApp)
          </button>
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="h-8 px-3 bg-white border border-[#DDE2EC] text-[#1B4FD8] disabled:opacity-40 text-[12px] font-medium rounded hover:bg-[#F8FAFC] transition-colors flex items-center gap-2">
            <Icon.Download /> Export Data
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 w-full">
        {loadError && <div className="bg-red-50 border border-red-200 text-red-800 text-[12.5px] px-3 py-2">{loadError}</div>}
        {/* Top Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Average rating (out of 5)", val: summary && summary.total_responses ? summary.average_rating.toFixed(1) : "—", desc: summary ? `Based on ${summary.total_responses} response${summary.total_responses === 1 ? "" : "s"}` : "Loading…", color: "text-[#1B4FD8]" },
            { label: "Responses received", val: summary ? String(summary.total_responses) : "—", desc: "Ratings and comments from WhatsApp", color: "text-gray-900" },
            { label: "Low ratings (1-2) open", val: String(low.length), desc: low.length ? "Need a follow-up" : "Nothing waiting", color: low.length ? "text-red-600" : "text-gray-900" },
            { label: "Escalated", val: summary ? String(summary.unresolved_low_rated) : "—", desc: "Low ratings marked Escalated", color: "text-amber-600" },
          ].map((stat, i) => (
            <div key={i} className="bg-white border border-[#DDE2EC] rounded-xl p-4 shadow-sm">
              <div className="text-[11.5px] font-semibold text-[#64748B] mb-2">{stat.label}</div>
              <div className={`text-3xl font-bold ${stat.color} mb-1`}>{stat.val}</div>
              <div className="text-[11px] text-gray-500">{stat.desc}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-6">
          {/* Recent Feedback Feed */}
          <div className="flex-1 bg-white border border-[#DDE2EC] rounded-xl shadow-sm flex flex-col min-h-[400px]">
            <div className="px-5 py-3 border-b border-[#DDE2EC] bg-[#F8FAFC] flex justify-between items-center">
              <h2 className="text-[14px] font-semibold text-gray-900">
                Recent Survey Responses
              </h2>
              <div className="flex gap-2 text-[12px]">
                <select className="border border-[#DDE2EC] rounded bg-white text-[11px] px-2 py-1 focus:outline-none">
                  <option>All Departments</option>
                  <option>Emergency</option>
                  <option>Outpatient</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {loaded && rows.length === 0 && (
                <div className="border border-dashed border-[#CBD5E1] p-8 text-center text-[13px] text-[#64748B]">
                  No feedback has been received yet. Use <strong>Request Feedback (WhatsApp)</strong>; the patient&apos;s rating and comment appear here when they reply.
                </div>
              )}
              {rows.map((fb) => (
                <div key={fb.id} className="border border-[#DDE2EC] rounded-none p-4 hover:bg-[#F8FAFC] transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex text-yellow-400 text-[14px]">
                        {[...Array(5)].map((_, j) => (
                          <span key={j}>{j < (fb.rating ?? 0) ? "★" : "☆"}</span>
                        ))}
                      </div>
                      <span className="text-[12px] font-semibold text-gray-900">{fb.rating != null ? `${fb.rating}/5` : "Comment only"}</span>
                    </div>
                    <span className="text-[11px] text-[#64748B]">{when(fb.received_at)}</span>
                  </div>
                  {fb.comment && <p className="text-[13px] text-gray-700 italic mb-3">&quot;{fb.comment}&quot;</p>}
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-[#64748B]">
                      Patient: {initials(fb.patient_name)} · Status: <strong>{fb.status || "New"}</strong>
                    </span>
                    <span className="flex gap-3">
                      {(fb.rating ?? 5) <= 3 && (fb.status || "New") === "New" && (
                        <button type="button" onClick={() => setStatus(fb.id, "Escalated")} className="text-[#1B4FD8] font-medium hover:underline cursor-pointer">
                          Follow Up / Escalate
                        </button>
                      )}
                      {(fb.status || "New") !== "Resolved" && (
                        <button type="button" onClick={() => setStatus(fb.id, "Resolved")} className="text-emerald-700 font-medium hover:underline cursor-pointer">
                          Mark resolved
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Low ratings that still need a follow-up */}
          <div className="w-80 bg-white border border-[#DDE2EC] rounded-xl shadow-sm flex flex-col">
            <div className="px-5 py-3 border-b border-[#DDE2EC] bg-[#F8FAFC]">
              <h2 className="text-[13px] font-semibold text-gray-900 flex items-center gap-2">
                <Icon.Alert /> Needs follow-up ({low.length})
              </h2>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[480px]">
              {low.length === 0 && <div className="text-[12.5px] text-[#64748B]">No low ratings are waiting for a follow-up.</div>}
              {low.map((r) => (
                <div key={r.id} className="border-l-4 border-red-500 bg-[#FAFBFF] border-t border-r border-b border-[#DDE2EC] p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[11px] font-mono text-[#64748B]">{when(r.received_at)}</span>
                    <span className="text-[10px] font-bold text-red-600 uppercase">{r.rating}/5</span>
                  </div>
                  <div className="text-[12.5px] text-gray-900 mb-1">{r.comment || "No comment left"}</div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[11.5px] text-[#1B4FD8]">{r.status || "New"}</span>
                    <button type="button" onClick={() => setStatus(r.id, "Resolved")} className="text-[11px] font-medium text-gray-600 hover:text-gray-900 cursor-pointer">
                      Mark resolved
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Pick patient to request feedback */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-[#DDE2EC] w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 border-b border-[#DDE2EC] bg-[#F8FAFC] flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Request Feedback via WhatsApp
                </h3>
                <p className="text-[11.5px] text-[#64748B]">
                  Select a patient or enter details to request rating & review
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search recent patients by name, UMR, or phone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-[12.5px] border border-[#DDE2EC] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {filtered.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      handleStartFeedback({
                        name: e.patientName,
                        phone: e.phone,
                        id: e.umr,
                      })
                    }
                    className="w-full text-left p-2.5 hover:bg-blue-50/50 transition-colors flex justify-between items-center group cursor-pointer"
                  >
                    <div>
                      <div className="text-[12.5px] font-semibold text-gray-800 group-hover:text-blue-600">
                        {e.patientName}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        {e.umr || e.opNumber} · {e.phone || "No phone"}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                      Select
                    </span>
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-gray-100">
                <div className="text-[11.5px] font-medium text-gray-700 mb-1.5">
                  Or enter mobile manually:
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Patient Name"
                    value={selectedPatient.name}
                    onChange={(e) =>
                      setSelectedPatient((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="px-2.5 py-1.5 text-[12px] border border-[#DDE2EC] rounded-md focus:outline-none"
                  />
                  <PhoneInput
                    size="sm"
                    placeholder="98765 43210"
                    value={selectedPatient.phone}
                    onChange={(val) =>
                      setSelectedPatient((prev) => ({ ...prev, phone: val }))
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedPatient.name || selectedPatient.phone) {
                      setPickerOpen(false)
                      setDialogOpen(true)
                    }
                  }}
                  disabled={!selectedPatient.phone}
                  className="mt-2 w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[12px] font-medium rounded-md transition-colors cursor-pointer"
                >
                  Continue to WhatsApp Message
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actual Send to Patient Dialog */}
      <SendToPatientDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        patient={selectedPatient}
        kind="feedback_request"
        documentLabel="Feedback / Review Request"
      />
    </div>
  )
}
