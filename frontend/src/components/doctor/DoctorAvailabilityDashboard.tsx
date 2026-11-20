import React, { useState, useEffect, useMemo, useCallback } from "react"
import {
  Stethoscope,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  UserX,
  UserCheck,
  Building2,
  CalendarDays,
  ShieldAlert,
  Send,
  Sliders,
  ChevronRight,
  Info,
  Flame,
  Moon,
  Sun,
  Activity,
  Layers,
  Sparkles,
} from "lucide-react"
import { apiFetch } from "../../lib/api"
import { toast } from "react-hot-toast"

export interface DoctorAvailabilityRecord {
  id: number
  user_id?: number
  doctor_name: string
  name?: string
  department: string
  specialty: string
  staff_id: string
  username: string
  room: string
  gender: string
  consultation_fee: number
  review_fee: number
  status: "available" | "busy" | "on_leave" | "off_duty" | "offline" | "unavailable"
  status_label: string
  is_eligible: boolean
  current_workload: number
  max_workload: number
  capacity_remaining: number
  eligibility_reasons: {
    account_active: boolean
    logged_in: boolean
    on_duty: boolean
    not_on_leave: boolean
    not_manually_unavailable: boolean
    within_capacity: boolean
  }
  session?: {
    created_at?: string
    last_seen?: string
    expires_at?: string
    ip_address?: string
    user_agent?: string
  } | null
  schedule?: {
    scheduled: boolean
    source?: string
    shift?: string
    start_time?: string
    end_time?: string
    is_overnight?: boolean
    reason?: string
  }
  leave?: {
    leave_type?: string
    start_date?: string
    end_date?: string
    half_day?: boolean
    half_day_period?: string
    reason?: string
  } | null
  evaluated_at?: string
}

export interface DepartmentSummary {
  department: string
  total_doctors: number
  available_doctors: number
  busy_doctors: number
  offline_doctors: number
  on_leave_doctors: number
  off_duty_doctors: number
  unavailable_doctors: number
  total_capacity: number
  active_patients: number
}

export interface QueuedPatient {
  id: number
  patient_id: string
  patient_name: string
  department: string
  token_no: number
  status: string
  op_status: string
  appointment_date: string
  created_at: string
  chief_complaint?: string
  symptoms?: string
}

export default function DoctorAvailabilityDashboard() {
  const [doctors, setDoctors] = useState<DoctorAvailabilityRecord[]>([])
  const [departmentsSummary, setDepartmentsSummary] = useState<DepartmentSummary[]>([])
  const [unassignedQueue, setUnassignedQueue] = useState<QueuedPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [search, setSearch] = useState("")
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Modals & Actions
  const [selectedDoc, setSelectedDoc] = useState<DoctorAvailabilityRecord | null>(null)
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showQueueModal, setShowQueueModal] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)

  // Schedule Edit State
  const [schedDutyStart, setSchedDutyStart] = useState("09:00")
  const [schedDutyEnd, setSchedDutyEnd] = useState("17:00")
  const [schedShiftName, setSchedShiftName] = useState("Morning")
  const [schedMaxWorkload, setSchedMaxWorkload] = useState(15)
  const [schedWorkingDays, setSchedWorkingDays] = useState<string[]>([
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
  ])
  const [schedWeeklyOffs, setSchedWeeklyOffs] = useState<string[]>(["Sunday"])

  const allWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

  const fetchAvailabilityData = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true)
    try {
      const [availRes, summaryRes, queueRes] = await Promise.all([
        apiFetch<any>("/api/doctor-availability"),
        apiFetch<any>("/api/doctor-availability/departments-summary"),
        apiFetch<any>("/api/doctor-availability/unassigned-queue"),
      ])

      if (availRes && Array.isArray(availRes.doctors)) {
        setDoctors(availRes.doctors)
      }
      if (summaryRes && Array.isArray(summaryRes.departments)) {
        setDepartmentsSummary(summaryRes.departments)
      }
      if (queueRes && Array.isArray(queueRes.queue)) {
        setUnassignedQueue(queueRes.queue)
      }
    } catch (err: any) {
      console.error("Failed to load doctor availability:", err)
      if (!isSilent) toast.error("Could not load real-time availability: " + (err.message || "Network error"))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchAvailabilityData()
    const timer = setInterval(() => {
      fetchAvailabilityData(true)
    }, 12000)
    return () => clearInterval(timer)
  }, [fetchAvailabilityData])

  // Calculated Stats
  const stats = useMemo(() => {
    return {
      total: doctors.length,
      available: doctors.filter((d) => d.status === "available").length,
      busy: doctors.filter((d) => d.status === "busy").length,
      offline: doctors.filter((d) => d.status === "offline").length,
      on_leave: doctors.filter((d) => d.status === "on_leave").length,
      off_duty: doctors.filter((d) => d.status === "off_duty").length,
      unavailable: doctors.filter((d) => d.status === "unavailable").length,
    }
  }, [doctors])

  // Departments with zero available doctors
  const departmentsWithShortage = useMemo(() => {
    return departmentsSummary.filter((d) => d.available_doctors === 0 && d.total_doctors > 0)
  }, [departmentsSummary])

  // Filtered Doctors
  const filteredDoctors = useMemo(() => {
    return doctors.filter((doc) => {
      // Department
      if (departmentFilter !== "all") {
        if (!doc.department.toLowerCase().includes(departmentFilter.toLowerCase())) {
          return false
        }
      }
      // Status
      if (statusFilter !== "all") {
        if (doc.status !== statusFilter) {
          return false
        }
      }
      // Search
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = doc.doctor_name.toLowerCase().includes(q)
        const matchDept = doc.department.toLowerCase().includes(q)
        const matchStaffId = (doc.staff_id || "").toLowerCase().includes(q)
        const matchRoom = (doc.room || "").toLowerCase().includes(q)
        if (!matchName && !matchDept && !matchStaffId && !matchRoom) {
          return false
        }
      }
      return true
    })
  }, [doctors, departmentFilter, statusFilter, search])

  // Available Departments for dropdown
  const departmentOptions = useMemo(() => {
    const set = new Set<string>()
    doctors.forEach((d) => {
      if (d.department) set.add(d.department)
    })
    return Array.from(set).sort()
  }, [doctors])

  // Toggle Manual Status
  const handleToggleManualStatus = async (doc: DoctorAvailabilityRecord) => {
    const newIsAvailable = doc.status === "unavailable"
    setSelectedDoc(doc)
    if (!newIsAvailable) {
      // Prompt for reason if marking unavailable
      setOverrideReason("")
      setShowOverrideModal(true)
    } else {
      // Mark available immediately
      try {
        await apiFetch(`/api/doctor-availability/${doc.id}/status`, {
          method: "POST",
          body: JSON.stringify({ is_available: true }),
        })
        toast.success(`Dr. ${doc.doctor_name} marked as Available`)
        fetchAvailabilityData(true)
      } catch (err: any) {
        toast.error("Failed to update status: " + err.message)
      }
    }
  }

  const confirmMarkUnavailable = async () => {
    if (!selectedDoc) return
    try {
      await apiFetch(`/api/doctor-availability/${selectedDoc.id}/status`, {
        method: "POST",
        body: JSON.stringify({ is_available: false, reason: overrideReason || "Administrative override" }),
      })
      toast.success(`Dr. ${selectedDoc.doctor_name} marked as Unavailable`)
      setShowOverrideModal(false)
      fetchAvailabilityData(true)
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message)
    }
  }

  // Open Schedule Modal
  const handleOpenScheduleModal = (doc: DoctorAvailabilityRecord) => {
    setSelectedDoc(doc)
    setSchedDutyStart(doc.schedule?.start_time || "09:00")
    setSchedDutyEnd(doc.schedule?.end_time || "17:00")
    setSchedShiftName(doc.schedule?.shift || "Morning")
    setSchedMaxWorkload(doc.max_workload || 15)
    setShowScheduleModal(true)
  }

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDoc) return
    try {
      await apiFetch(`/api/doctor-availability/${selectedDoc.id}/schedule`, {
        method: "PUT",
        body: JSON.stringify({
          duty_start_time: schedDutyStart,
          duty_end_time: schedDutyEnd,
          shift_name: schedShiftName,
          max_workload: Number(schedMaxWorkload),
          working_days: schedWorkingDays,
          weekly_off_days: schedWeeklyOffs,
          schedule_active: true,
        }),
      })
      toast.success(`Duty schedule updated for Dr. ${selectedDoc.doctor_name}`)
      setShowScheduleModal(false)
      fetchAvailabilityData(true)
    } catch (err: any) {
      toast.error("Failed to update schedule: " + err.message)
    }
  }

  // Auto-Assign Unassigned Queue
  const handleAutoAssignQueue = async () => {
    setAutoAssigning(true)
    try {
      const res = await apiFetch<any>("/api/doctor-availability/auto-assign-queue", {
        method: "POST",
      })
      if (res && res.status === "ok") {
        toast.success(`Queue processed: ${res.assigned} patients assigned to newly available doctors!`)
        fetchAvailabilityData(true)
      }
    } catch (err: any) {
      toast.error("Failed to auto-assign queue: " + err.message)
    } finally {
      setAutoAssigning(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "available":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Available
          </span>
        )
      case "busy":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <Flame size={12} className="text-amber-600" />
            Busy (At Capacity)
          </span>
        )
      case "on_leave":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-purple-50 text-purple-700 border border-purple-200">
            <Calendar size={12} className="text-purple-600" />
            On Leave
          </span>
        )
      case "off_duty":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            <Moon size={12} className="text-blue-600" />
            Off Duty
          </span>
        )
      case "offline":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Offline (Logged Out)
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle size={12} className="text-rose-600" />
            Unavailable
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Top Header & Actions ── */}
      <div className="bg-white border border-[#DDE2EC] rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-700 flex items-center justify-center font-bold">
                <Stethoscope size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-extrabold text-[#0F172A] tracking-tight">
                    Centralized Doctor Availability & Assignment Engine
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                    Active IST
                  </span>
                </div>
                <p className="text-[12px] text-[#64748B]">
                  Live eligibility verification across OP, Appointments, ER, and Inpatient queues. Enforces active logins, duty schedules, leave records, and workload capacity limits automatically.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {unassignedQueue.length > 0 && (
              <button
                type="button"
                onClick={() => setShowQueueModal(true)}
                className="px-3.5 py-2 text-[12px] font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <AlertCircle size={15} />
                <span>Unassigned Queue ({unassignedQueue.length})</span>
              </button>
            )}

            <button
              type="button"
              disabled={refreshing}
              onClick={() => fetchAvailabilityData()}
              className="px-3.5 py-2 text-[12px] font-bold rounded-lg border border-[#DDE2EC] bg-white hover:bg-[#F8FAFC] text-[#334155] flex items-center gap-2 shadow-2xs transition-all cursor-pointer"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin text-blue-600" : ""} />
              <span>{refreshing ? "Checking..." : "Refresh Live"}</span>
            </button>
          </div>
        </div>

        {/* ── Key Metrics Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mt-5 pt-4 border-t border-[#F1F5F9]">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "all"
                ? "border-blue-600 bg-blue-50/40 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-[11px] font-bold text-slate-500 uppercase">Total Doctors</div>
            <div className="text-[20px] font-black text-slate-900 mt-0.5">{stats.total}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("available")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "available"
                ? "border-emerald-600 bg-emerald-50/50 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-emerald-300"
            }`}
          >
            <div className="text-[11px] font-bold text-emerald-700 uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Available
            </div>
            <div className="text-[20px] font-black text-emerald-700 mt-0.5">{stats.available}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("busy")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "busy"
                ? "border-amber-600 bg-amber-50/50 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-amber-300"
            }`}
          >
            <div className="text-[11px] font-bold text-amber-700 uppercase flex items-center gap-1.5">
              <Flame size={12} />
              Busy (Full)
            </div>
            <div className="text-[20px] font-black text-amber-700 mt-0.5">{stats.busy}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("offline")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "offline"
                ? "border-slate-500 bg-slate-100 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-[11px] font-bold text-slate-600 uppercase flex items-center gap-1.5">
              <UserX size={12} />
              Offline
            </div>
            <div className="text-[20px] font-black text-slate-700 mt-0.5">{stats.offline}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("on_leave")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "on_leave"
                ? "border-purple-600 bg-purple-50/50 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-purple-300"
            }`}
          >
            <div className="text-[11px] font-bold text-purple-700 uppercase flex items-center gap-1.5">
              <Calendar size={12} />
              On Leave
            </div>
            <div className="text-[20px] font-black text-purple-700 mt-0.5">{stats.on_leave}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("off_duty")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "off_duty"
                ? "border-blue-600 bg-blue-50/50 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-blue-300"
            }`}
          >
            <div className="text-[11px] font-bold text-blue-700 uppercase flex items-center gap-1.5">
              <Moon size={12} />
              Off Duty
            </div>
            <div className="text-[20px] font-black text-blue-700 mt-0.5">{stats.off_duty}</div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("unavailable")}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              statusFilter === "unavailable"
                ? "border-rose-600 bg-rose-50/50 shadow-xs"
                : "border-[#E2E8F0] bg-white hover:border-rose-300"
            }`}
          >
            <div className="text-[11px] font-bold text-rose-700 uppercase flex items-center gap-1.5">
              <AlertCircle size={12} />
              Unavailable
            </div>
            <div className="text-[20px] font-black text-rose-700 mt-0.5">{stats.unavailable}</div>
          </button>
        </div>
      </div>

      {/* ── Shortage / Unassigned Warning Banner ── */}
      {departmentsWithShortage.length > 0 && (
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-xl p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div>
              <div className="text-[13px] font-extrabold text-amber-900">
                Department Coverage Alert: Zero Available Doctors
              </div>
              <div className="text-[12px] text-amber-800 mt-0.5">
                The following departments currently have NO eligible doctors on duty:{" "}
                <span className="font-bold">
                  {departmentsWithShortage.map((d) => d.department).join(", ")}
                </span>
                . New patient assignments for these departments are held in the unassigned queue.
              </div>
            </div>
          </div>
          {unassignedQueue.length > 0 && (
            <button
              type="button"
              disabled={autoAssigning}
              onClick={handleAutoAssignQueue}
              className="px-3.5 py-1.5 text-[12px] font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shrink-0 flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Sparkles size={14} />
              <span>{autoAssigning ? "Processing..." : "Auto-Assign Queue"}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Toolbar: Filters & Search ── */}
      <div className="bg-white border border-[#DDE2EC] rounded-xl p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search doctor, staff ID, department, room..."
              className="w-full pl-9 pr-3 py-1.5 text-[12.5px] border border-[#CBD5E1] rounded-lg focus:outline-none focus:border-blue-600 bg-white"
            />
          </div>

          {/* Department Dropdown */}
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-slate-500 shrink-0" />
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-3 py-1.5 text-[12.5px] font-semibold border border-[#CBD5E1] rounded-lg bg-white text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="all">All Departments ({departmentOptions.length})</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500 shrink-0">
          <span>Showing <strong className="text-slate-900">{filteredDoctors.length}</strong> of {doctors.length} doctors</span>
        </div>
      </div>

      {/* ── Doctor Availability Table ── */}
      <div className="bg-white border border-[#DDE2EC] rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-black text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Doctor & Identity</th>
                <th className="py-3 px-4">Department & Room</th>
                <th className="py-3 px-4">Login & Session</th>
                <th className="py-3 px-4">Duty Schedule (Shift)</th>
                <th className="py-3 px-4">Leave Status</th>
                <th className="py-3 px-4">Workload Capacity</th>
                <th className="py-3 px-4">Availability State</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[12.5px]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <RefreshCw className="animate-spin inline-block text-blue-600 mb-2" size={24} />
                    <p className="font-semibold">Evaluating doctor availability in real-time...</p>
                  </td>
                </tr>
              ) : filteredDoctors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <UserX className="inline-block text-slate-400 mb-2" size={32} />
                    <p className="font-bold text-slate-700">No doctors match the selected filters.</p>
                    <p className="text-[11.5px] text-slate-400 mt-1">Try resetting the department or status filter.</p>
                  </td>
                </tr>
              ) : (
                filteredDoctors.map((doc) => {
                  const pct = Math.min(100, Math.round((doc.current_workload / (doc.max_workload || 15)) * 100))
                  const isOnline = !!doc.session
                  return (
                    <tr key={doc.id} className="hover:bg-[#F8FAFC] transition-colors">
                      {/* Doctor & Identity */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-[13px] shrink-0 ${
                            doc.gender === "Female"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-blue-100 text-blue-700"
                          }`}>
                            {doc.doctor_name.replace(/dr\.?\s*/i, "").charAt(0) || "D"}
                          </div>
                          <div>
                            <div className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                              <span>Dr. {doc.doctor_name.replace(/dr\.?\s*/i, "")}</span>
                              {doc.is_eligible && (
                                <span title="Eligible for assignments">
                                  <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                              {doc.staff_id} • @{doc.username || "no-login"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Department & Room */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{doc.department}</div>
                        <div className="text-[11.5px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <span>Room:</span>
                          <span className="font-mono font-medium text-slate-700">{doc.room}</span>
                        </div>
                      </td>

                      {/* Login & Session */}
                      <td className="py-3.5 px-4">
                        {isOnline ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Online
                            </span>
                            <div className="text-[10.5px] text-slate-400 font-mono mt-1">
                              IP: {doc.session?.ip_address || "127.0.0.1"}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            Logged Out
                          </span>
                        )}
                      </td>

                      {/* Duty Schedule (Shift) */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800 flex items-center gap-1">
                          {doc.schedule?.is_overnight ? (
                            <Moon size={12} className="text-indigo-600" />
                          ) : (
                            <Sun size={12} className="text-amber-500" />
                          )}
                          <span>{doc.schedule?.shift || "General Shift"}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-500 font-mono mt-0.5">
                          {doc.schedule?.start_time || "09:00"} - {doc.schedule?.end_time || "17:00"}
                          {doc.schedule?.is_overnight && " (Overnight)"}
                        </div>
                        {!doc.schedule?.scheduled && doc.schedule?.reason && (
                          <div className="text-[10.5px] text-amber-700 font-medium mt-0.5">
                            {doc.schedule.reason}
                          </div>
                        )}
                      </td>

                      {/* Leave Status */}
                      <td className="py-3.5 px-4">
                        {doc.leave ? (
                          <div className="text-[11.5px]">
                            <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              {doc.leave.leave_type || "Leave"}
                            </span>
                            <div className="text-[10.5px] text-slate-500 mt-1">
                              {doc.leave.start_date} to {doc.leave.end_date}
                              {doc.leave.half_day && ` (${doc.leave.half_day_period})`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11.5px] text-slate-400 font-medium">None (Working)</span>
                        )}
                      </td>

                      {/* Workload Capacity */}
                      <td className="py-3.5 px-4">
                        <div className="w-32">
                          <div className="flex justify-between items-center text-[11px] font-semibold mb-1">
                            <span className="text-slate-700">{doc.current_workload} / {doc.max_workload} Patients</span>
                            <span className={`font-mono text-[10px] ${pct >= 100 ? "text-rose-600 font-bold" : "text-slate-400"}`}>
                              {pct}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {doc.capacity_remaining > 0 ? `${doc.capacity_remaining} slots open` : "At capacity"}
                          </div>
                        </div>
                      </td>

                      {/* Availability State */}
                      <td className="py-3.5 px-4">
                        {getStatusBadge(doc.status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Edit Doctor Shift Schedule"
                            onClick={() => handleOpenScheduleModal(doc)}
                            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                          >
                            <Sliders size={14} />
                          </button>

                          {doc.status === "unavailable" ? (
                            <button
                              type="button"
                              onClick={() => handleToggleManualStatus(doc)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                            >
                              Make Available
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleManualStatus(doc)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-700 transition-colors cursor-pointer"
                            >
                              Mark Unavailable
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL: Unassigned Queue Details ── */}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-[15px] text-slate-900">
                  Unassigned Patient Queue ({unassignedQueue.length})
                </h3>
                <p className="text-[11.5px] text-slate-500">
                  Patients waiting for an eligible doctor in their department.
                </p>
              </div>
              <button
                onClick={() => setShowQueueModal(false)}
                className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2.5 divide-y divide-slate-100">
              {unassignedQueue.length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  <CheckCircle2 size={32} className="text-emerald-500 inline-block mb-1.5" />
                  <p className="font-bold text-slate-800">All registered patients are assigned!</p>
                  <p className="text-[12px] text-slate-400">No patients are waiting in the unassigned queue.</p>
                </div>
              ) : (
                unassignedQueue.map((item) => (
                  <div key={item.id} className="pt-2.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900 text-[13px] flex items-center gap-2">
                        <span>{item.patient_name}</span>
                        <span className="text-[11px] px-1.5 py-0.2 bg-blue-50 text-blue-700 font-mono rounded">
                          Token #{item.token_no}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-slate-500 mt-0.5">
                        Department: <strong className="text-slate-800">{item.department}</strong> • UMR: {item.patient_id}
                      </div>
                      {item.chief_complaint && (
                        <div className="text-[11px] text-slate-400 italic mt-0.5">
                          "{item.chief_complaint}"
                        </div>
                      )}
                    </div>
                    <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                      Waiting for Doctor
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowQueueModal(false)}
                className="px-4 py-1.5 text-[12px] font-bold border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
              {unassignedQueue.length > 0 && (
                <button
                  type="button"
                  disabled={autoAssigning}
                  onClick={handleAutoAssignQueue}
                  className="px-4 py-1.5 text-[12px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Sparkles size={14} />
                  <span>{autoAssigning ? "Assigning..." : "Auto-Assign All Waiting"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Mark Doctor Unavailable Reason ── */}
      {showOverrideModal && selectedDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 p-5">
            <h3 className="font-extrabold text-[15px] text-slate-900">
              Mark Dr. {selectedDoc.doctor_name} Unavailable
            </h3>
            <p className="text-[12px] text-slate-500 mt-1">
              Marking this doctor unavailable will immediately stop all new patient assignments across OP, ER, and Appointments. Existing patient assignments remain intact.
            </p>

            <div className="mt-4">
              <label className="block text-[11.5px] font-bold text-slate-700 uppercase mb-1">
                Reason for unavailability
              </label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. In emergency procedure, administrative meeting, personal emergency..."
                rows={3}
                className="w-full p-2.5 text-[12.5px] border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                className="px-3.5 py-1.5 text-[12px] font-bold border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMarkUnavailable}
                className="px-4 py-1.5 text-[12px] font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer"
              >
                Confirm Unavailable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Edit Schedule & Capacity ── */}
      {showScheduleModal && selectedDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleSaveSchedule} className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-slate-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-extrabold text-[15px] text-slate-900">
                  Duty Schedule & Capacity: Dr. {selectedDoc.doctor_name}
                </h3>
                <p className="text-[11.5px] text-slate-500">
                  Configure working shifts, active working days, off-days and maximum daily patient capacity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 mt-4">
              {/* Shift Name & Max Workload */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Shift Name / Type
                  </label>
                  <select
                    value={schedShiftName}
                    onChange={(e) => setSchedShiftName(e.target.value)}
                    className="w-full p-2 text-[12.5px] border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Morning">Morning Shift (09:00 - 17:00)</option>
                    <option value="Evening">Evening Shift (14:00 - 21:00)</option>
                    <option value="Night">Night Shift (Overnight)</option>
                    <option value="Rotational">Rotational Shift</option>
                    <option value="On-Call">On-Call Coverage</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Max Patient Capacity
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={schedMaxWorkload}
                    onChange={(e) => setSchedMaxWorkload(Number(e.target.value))}
                    className="w-full p-2 text-[12.5px] border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Duty Start & Duty End */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Duty Start Time (HH:MM)
                  </label>
                  <input
                    type="time"
                    value={schedDutyStart}
                    onChange={(e) => setSchedDutyStart(e.target.value)}
                    className="w-full p-2 text-[12.5px] border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Duty End Time (HH:MM)
                  </label>
                  <input
                    type="time"
                    value={schedDutyEnd}
                    onChange={(e) => setSchedDutyEnd(e.target.value)}
                    className="w-full p-2 text-[12.5px] border border-slate-300 rounded-lg"
                  />
                  {schedDutyStart > schedDutyEnd && (
                    <span className="text-[10px] text-indigo-600 font-semibold block mt-0.5">
                      🌙 Overnight shift (crosses midnight)
                    </span>
                  )}
                </div>
              </div>

              {/* Working Days */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1.5">
                  Scheduled Working Days
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {allWeekdays.map((day) => {
                    const isWorking = schedWorkingDays.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          if (isWorking) {
                            setSchedWorkingDays(schedWorkingDays.filter((d) => d !== day))
                            if (!schedWeeklyOffs.includes(day)) {
                              setSchedWeeklyOffs([...schedWeeklyOffs, day])
                            }
                          } else {
                            setSchedWorkingDays([...schedWorkingDays, day])
                            setSchedWeeklyOffs(schedWeeklyOffs.filter((d) => d !== day))
                          }
                        }}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-md border transition-all cursor-pointer ${
                          isWorking
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-6 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="px-3.5 py-1.5 text-[12px] font-bold border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-[12px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer"
              >
                Save Duty Schedule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
