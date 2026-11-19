import React, { useState, useEffect, useMemo } from "react"
import {
  Users,
  Calendar,
  BedDouble,
  LogOut,
  Clock,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  ExternalLink,
  MoreVertical,
  FlaskConical,
  Pill,
  CreditCard,
  Heart,
  SlidersHorizontal,
  Building2,
  X,
  Stethoscope,
  Siren,
  Sparkles,
  Plus,
} from "lucide-react"
import { db } from "../services/db"
import { LabOrderDatabase } from "../services/labOrdersDb"
import { ErDatabase } from "../services/erDb"
import { BedDatabase, type BedRecord } from "../services/bedDb"
import { SurgeryDatabase } from "../services/surgeryDb"
import { computeKpis, dayKey, mergeStays, serverStayTime } from "../utils/dashboardKpis"
import { withAuthHeaders } from "../lib/api"
import type { DischargedPatientRecord } from "../services/bedDb"
import { encounterArrivalMs } from "../services/encounterTime"
import { getHospitalCode } from "../lib/api"
import { API_BASE } from "../lib/constants"
import {
  ALL_QUICK_ACTIONS,
  ICON_MAP,
  loadQuickActionIds,
  saveQuickActionIds,
  QUICK_ACTION_STORAGE_KEY,
} from "./dashboard/quickActionsConfig"
import QuickActionsCustomizeModal from "./dashboard/QuickActionsCustomizeModal"

/**
 * A card's graph. "7 days" draws one point per day; "Today by hour" draws the running total hour by hour, so the line climbs as
 * patients and data arrive. The dot is the latest point. A flat dotted line means nothing has happened in that period.
 */
function Spark({ data, stroke, dot, slots, caption, label }: { data: number[]; stroke: string; dot: string; slots: number; caption: [string, string]; label: string }) {
  const max = Math.max(...data, 1)
  const flat = data.every((n) => n === 0)
  const x = (i: number) => (slots <= 1 ? 0 : (i / (slots - 1)) * 100)
  const y = (v: number) => 21 - (v / max) * 18
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ")
  const last = data.length - 1
  return (
    <div className="mt-2 w-full" title={`${label}: ${data.join(", ")}`}>
      <div className="relative h-6 w-full">
        <svg viewBox="0 0 100 24" className="w-full h-full fill-none" preserveAspectRatio="none" role="img" aria-label={`${label}: ${data.join(", ")}`}>
          {flat ? (
            <path d="M 0 21 L 100 21" strokeWidth="1.5" strokeDasharray="3 3" className="stroke-slate-200" />
          ) : data.length === 1 ? (
            <path d={`M 0 ${y(data[0])} L ${x(0) + 0.01} ${y(data[0])}`} strokeWidth="2" className={stroke} vectorEffect="non-scaling-stroke" />
          ) : (
            <polyline points={pts} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={stroke} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {!flat && last >= 0 && <span className={`absolute w-2 h-2 rounded-full ring-2 ring-white ${dot}`} style={{ left: `${x(last)}%`, top: `${(y(data[last]) / 24) * 100}%`, transform: "translate(-50%, -50%)" }} />}
      </div>
      <div className="flex justify-between text-[9.5px] text-slate-400 leading-none mt-0.5">
        <span>{caption[0]}</span>
        <span>{caption[1]}</span>
      </div>
    </div>
  )
}

function KpiCard({
  label, icon, tint, stroke, dot, value, badge, sub, trend, weekTrend, slots, mode, caption, action, actionTone, onAction, title,
}: {
  label: string
  icon: React.ReactNode
  tint: string
  stroke: string
  dot: string
  value: number
  badge: { text: string; tone: string }
  sub: string
  trend?: number[]
  /** The seven daily values (oldest first): today and yesterday are compared. */
  weekTrend?: number[]
  slots: number
  mode: "week" | "day"
  caption: [string, string]
  action: string
  actionTone: string
  onAction: () => void
  title?: string
}) {
  const yday = weekTrend ? weekTrend[weekTrend.length - 2] : undefined
  const today = weekTrend ? weekTrend[weekTrend.length - 1] : undefined
  const diff = yday !== undefined && today !== undefined ? today - yday : 0
  return (
    <div title={title} className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-extrabold text-slate-900 leading-none tabular-nums">{value}</span>
          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${badge.tone}`}>{badge.text}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">{sub}</p>
        {trend && <Spark data={trend} stroke={stroke} dot={dot} slots={slots} caption={caption} label={mode === "day" ? "Today by hour (running total)" : "Last 7 days"} />}
        {weekTrend && (
          // Today is still going, so it is only compared with yesterday's full-day total once it has passed it.
          <div className={`text-[10.5px] mt-1 ${diff > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}`} title={`Yesterday (whole day) ${yday}; today so far ${today}`}>
            {diff > 0 ? `▲ already ${diff} above yesterday's ${yday}` : `Yesterday (whole day): ${yday} · today so far: ${today}`}
          </div>
        )}
      </div>
      <button type="button" onClick={onAction} className={`text-[11px] font-semibold flex items-center gap-1 mt-3 pt-2 border-t border-slate-100 cursor-pointer ${actionTone}`}>
        <span>{action}</span>
        <ArrowRight size={11} />
      </button>
    </div>
  )
}

export default function Dashboard({
  navigate,
  userRole = "ROLE_ADMIN",
  activeStaff,
}: {
  navigate: (m: string, s?: string) => void
  userRole?: string
  activeStaff?: { id: string; name: string; title: string; department: string }
  switchRole?: (
    targetRole: string,
    targetUsername: string,
    permissions: string[],
  ) => void
}) {
  const [tick, setTick] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // The graphs: the last 7 days, or today hour by hour (a running total that climbs as records come in). Remembered per browser.
  const [mode, setMode] = useState<"week" | "day">(() => {
    try {
      return localStorage.getItem("hospai_dashboard_trend_mode") === "week" ? "week" : "day"
    } catch {
      return "day"
    }
  })
  const chooseMode = (m: "week" | "day") => {
    setMode(m)
    try {
      localStorage.setItem("hospai_dashboard_trend_mode", m)
    } catch {
      /* not remembered */
    }
  }
  const [banner1Dismissed, setBanner1Dismissed] = useState(false)
  const [banner2Dismissed, setBanner2Dismissed] = useState(false)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [quickActionIds, setQuickActionIds] = useState<string[]>(() => loadQuickActionIds())

  // Dynamic quick actions derived from configured IDs
  const activeQuickActions = useMemo(() => {
    return quickActionIds
      .map((id) => ALL_QUICK_ACTIONS.find((a) => a.id === id))
      .filter((a): a is typeof ALL_QUICK_ACTIONS[0] => Boolean(a))
  }, [quickActionIds])

  const handleSaveQuickActions = (newIds: string[]) => {
    setQuickActionIds(newIds)
    saveQuickActionIds(newIds)
  }

  // Multi-tab sync for customized dashboard quick actions
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === QUICK_ACTION_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setQuickActionIds(parsed)
          }
        } catch {}
      }
    }
    window.addEventListener("storage", handleStorage)

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel("hospai_dashboard_channel")
      bc.onmessage = (ev) => {
        if (ev.data?.type === "quick_actions_updated" && Array.isArray(ev.data.ids)) {
          setQuickActionIds(ev.data.ids)
        }
      }
    } catch {}

    return () => {
      window.removeEventListener("storage", handleStorage)
      if (bc) bc.close()
    }
  }, [])

  // Dynamic top-to-bottom recent appointments and diagnostic orders
  const recentAppointments = useMemo(() => {
    const today = dayKey(Date.now())
    return db
      .getEncounters()
      .filter((e) => {
        const t = encounterArrivalMs(e)
        return t != null && dayKey(t) === today
      })
      .sort((a, b) => (encounterArrivalMs(b) ?? 0) - (encounterArrivalMs(a) ?? 0))
      .slice(0, 5)
  }, [tick])

  // Pending diagnostic orders, newest first
  const recentLabs = useMemo(() => {
    return LabOrderDatabase.getOrders()
      .filter((o) => o.status !== "Completed" && o.status !== "Cancelled")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 4)
  }, [tick])

  // Real-time synchronization across microservice stores
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    const unsubLab = LabOrderDatabase.subscribe(bump)
    window.addEventListener("storage", bump)
    window.addEventListener("hospai_beds_updated", bump)
    window.addEventListener("hospai_encounter_created", bump)
    window.addEventListener("hospai_encounter_updated", bump)
    window.addEventListener("hospai_surgery_updates", bump)
    window.addEventListener("icu:patient_discharged_to_reception", bump)
    void BedDatabase.syncWithBackend().then(() => bump())
    return () => {
      unsubLab()
      window.removeEventListener("storage", bump)
      window.removeEventListener("hospai_beds_updated", bump)
      window.removeEventListener("hospai_encounter_created", bump)
      window.removeEventListener("hospai_encounter_updated", bump)
      window.removeEventListener("hospai_surgery_updates", bump)
      window.removeEventListener("icu:patient_discharged_to_reception", bump)
    }
  }, [])

  // The ER, lab and bed stores raise no event for every change another desk makes, so the numbers are also re-read every 15 s
  // (while the tab is showing) and as soon as the tab is shown again.
  const [updatedAt, setUpdatedAt] = useState(() => Date.now())
  useEffect(() => {
    setUpdatedAt(Date.now())
  }, [tick])
  useEffect(() => {
    const bump = () => document.visibilityState === "visible" && setTick((t) => t + 1)
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void BedDatabase.syncWithBackend().finally(() => setTick((n) => n + 1))
    }, 15_000)
    document.addEventListener("visibilitychange", bump)
    window.addEventListener("focus", bump)
    return () => {
      window.clearInterval(t)
      document.removeEventListener("visibilitychange", bump)
      window.removeEventListener("focus", bump)
    }
  }, [])

  const handleRefresh = () => {
    setIsRefreshing(true)
    void BedDatabase.syncWithBackend().finally(() => setTick((t) => t + 1))
    setTick((t) => t + 1)
    setTimeout(() => {
      setIsRefreshing(false)
    }, 600)
  }

  const hospitalCode = useMemo(() => getHospitalCode() || "hospo-default", [])

  // Is the hospital server answering right now? (a real check every 15 s, not a fixed label)
  const [server, setServer] = useState<"checking" | "up" | "down">("checking")
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/session`, { credentials: "include", cache: "no-store" })
        if (alive) setServer(res.status < 500 ? "up" : "down")
      } catch {
        if (alive) setServer("down")
      }
    }
    void check()
    const t = window.setInterval(check, 15_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])
  // The server's own list of completed stays (the Discharged Directory). A discharge made at another desk, or from the bed
  // board without a record in this browser, exists only there, so the admitted / discharged numbers read it too.
  const [serverStays, setServerStays] = useState<DischargedPatientRecord[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/beds/discharged`, { credentials: "include", headers: withAuthHeaders({}, "GET"), cache: "no-store" })
        if (!res.ok) return
        const body = (await res.json()) as { discharged_patients?: DischargedPatientRecord[] }
        if (alive && Array.isArray(body.discharged_patients))
          setServerStays(body.discharged_patients.map((d) => ({ ...d, admissionDate: serverStayTime(d.admissionDate), dischargeDate: serverStayTime(d.dischargeDate) })))
      } catch {
        /* the server is unreachable: the browser's own records are used */
      }
    }
    void load()
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 15_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])
  const roleLabel = useMemo(() => userRole.replace(/^ROLE_/, "").replace(/_/g, " "), [userRole])

  // Live ER visits count
  const activeErVisits = useMemo(() => {
    try {
      const v = ErDatabase.getVisits("active")
      return v.length > 0 ? v : []
    } catch {
      return []
    }
  }, [tick])

  // Every KPI card is computed in one place from the hospital's own records (see utils/dashboardKpis.ts).
  const kpis = useMemo(() => {
    let cases: ReturnType<typeof SurgeryDatabase.getCases> = []
    try {
      cases = SurgeryDatabase.getCases()
    } catch {
      /* no surgery data yet */
    }
    const safe = <T,>(fn: () => T, empty: T): T => {
      try {
        return fn()
      } catch {
        return empty
      }
    }
    return computeKpis({
      now: Date.now(),
      encounters: safe(() => db.getEncounters(), []),
      erVisits: safe(() => ErDatabase.getVisits("all"), []),
      beds: safe(() => BedDatabase.getBeds(), []),
      discharged: mergeStays(serverStays ?? [], safe(() => BedDatabase.getDischargedPatients(), [])),
      labOrders: safe(() => LabOrderDatabase.getOrders(), []),
      surgeries: cases,
      registeredAt: safe(() => db.getPatients().map((p) => p.createdAt), []),
    })
  }, [tick, serverStays])

  const slots = mode === "day" ? 24 : 7
  const nowHour = kpis.hourly.hour
  const hhmm = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`
  const dayLabel = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  /** The props every card needs for its graph, for the chosen view. */
  const graph = (week: number[], day: number[], dot: string) => ({
    trend: mode === "day" ? day : week,
    weekTrend: week,
    slots,
    mode,
    dot,
    caption: (mode === "day" ? ["12 am", `now ${hhmm(nowHour)}`] : [dayLabel(kpis.days[0]), "today"]) as [string, string],
  })

  const edActiveCount = kpis.ed.active

  // The newest critical result (flagged Critical by the laboratory) from the last 24 hours
  const criticalLab = useMemo(() => {
    try {
      const since = Date.now() - 86_400_000
      const flagged = (o: ReturnType<typeof LabOrderDatabase.getOrders>[number]) =>
        o.status !== "Cancelled" &&
        (o.tests || []).some(
          (t) =>
            (t.flag === "Critical" || Object.values(t.results || {}).some((r) => r?.flag === "Critical")) &&
            new Date(t.resultedAt || o.updatedAt || 0).getTime() >= since,
        )
      return (
        LabOrderDatabase.getOrders()
          .filter(flagged)
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null
      )
    } catch {
      return null
    }
  }, [tick])

  const departmentCensus = useMemo(() => {
    try {
      const beds = BedDatabase.getBeds()
      const erVisits = ErDatabase.getVisits("active")
      const erCritical = erVisits.filter(
        (v) => v.triage_category === "ESI-1" || v.triage_category === "ESI-2"
      )
      const surgeryCases = SurgeryDatabase.getCases()
      const surgeryInCare = surgeryCases.filter((c) => c.status === "In Surgery" || c.status === "PACU Recovery")
      const surgeryWaiting = surgeryCases.filter((c) => c.status === "PAC Pending" || c.status === "PAC Cleared" || c.status === "Pre-Op Holding")

      const edCapacity = beds.filter(
        (b) =>
          (b.bed_type as any) === "Emergency" ||
          b.ward.toLowerCase().includes("emergency")
      ).length
      const edInCare = erVisits.length
      const edAvailable = Math.max(0, edCapacity - edInCare)
      const edOccupancyPct =
        edCapacity > 0 ? Math.min(100, Math.round((edInCare / edCapacity) * 100)) : 0

      const rows: Array<{
        id: string
        name: string
        sub: string
        inCare: number
        waiting: string | number
        critical: string
        available: number
        capacityStr: string
        occupancyPct: number | null
        barColor: string
        actionNav: string
        actionLabel: string
        icon: "siren" | "bed" | "stethoscope" | "heart"
      }> = []

      if (edCapacity > 0 || erVisits.length > 0) {
        rows.push({
          id: "ed",
          name: "Emergency Department",
          sub: `ED | ${edCapacity} beds`,
          inCare: edInCare,
          waiting: erVisits.filter((v) => v.status === "pending" || v.status === "doctor_assigned" || !v.status).length || "—",
          critical: erCritical.length > 0 ? `${erCritical.length} ESI-1/2` : "—",
          available: edAvailable,
          capacityStr: `${edInCare}/${edCapacity}`,
          occupancyPct: edOccupancyPct,
          barColor: "bg-teal-500",
          actionNav: "emergency",
          actionLabel: "View ER →",
          icon: "siren",
        })
      }

      const wardMap = new Map<string, BedRecord[]>()
      beds.forEach((b) => {
        if (
          (b.bed_type as any) === "Emergency" ||
          b.ward.toLowerCase().includes("emergency")
        )
          return
        const list = wardMap.get(b.ward) || []
        list.push(b)
        wardMap.set(b.ward, list)
      })

      wardMap.forEach((wardBeds, wardName) => {
        const occupied = wardBeds.filter((b) => b.status === "Occupied").length
        const total = wardBeds.length
        const available = wardBeds.filter((b) => b.status === "Available").length
        const pct = total > 0 ? Math.min(100, Math.round((occupied / total) * 100)) : 0
        const isIcu = wardName.toLowerCase().includes("icu")

        rows.push({
          id: wardName,
          name: wardName,
          sub: `${wardName} | ${total} beds`,
          inCare: occupied,
          waiting: "—",
          critical: isIcu && occupied > 0 ? `${occupied} in ICU` : "—",
          available,
          capacityStr: `${occupied}/${total}`,
          occupancyPct: pct,
          barColor: isIcu ? "bg-orange-500" : "bg-blue-600",
          actionNav: isIcu ? "icu" : "inpatient",
          actionLabel: isIcu ? "View ICU →" : "View Ward →",
          icon: isIcu ? "stethoscope" : "bed",
        })
      })

      // The operating-room list is not configured anywhere, so no bay count or occupancy is invented: the row shows
      // who is in theatre / recovery and who is waiting.
      if (surgeryCases.length > 0) {
        rows.push({
          id: "surgery",
          name: "Surgery (operating rooms)",
          sub: `${surgeryInCare.length} in theatre / recovery`,
          inCare: surgeryInCare.length,
          waiting: surgeryWaiting.length > 0 ? `${surgeryWaiting.length} waiting` : "—",
          critical: "—",
          available: 0,
          capacityStr: "—",
          occupancyPct: null,
          barColor: "bg-emerald-500",
          actionNav: "surgery",
          actionLabel: "View Surgery →",
          icon: "heart",
        })
      }

      return rows
    } catch {
      return []
    }
  }, [tick])

  const liveWardOccupancy = useMemo(() => {
    try {
      const beds = BedDatabase.getBeds()
      if (beds.length === 0) return []
      const wardMap = new Map<string, BedRecord[]>()
      beds.forEach((b) => {
        if (!b.ward) return
        const list = wardMap.get(b.ward) || []
        list.push(b)
        wardMap.set(b.ward, list)
      })
      const colorPalettes = [
        { text: "text-teal-700", icon: "text-teal-600", bar: "bg-teal-500" },
        { text: "text-blue-700", icon: "text-blue-600", bar: "bg-blue-600" },
        { text: "text-purple-700", icon: "text-purple-600", bar: "bg-purple-500" },
        { text: "text-rose-700", icon: "text-rose-600", bar: "bg-rose-500" },
        { text: "text-amber-700", icon: "text-amber-600", bar: "bg-amber-500" },
        { text: "text-emerald-700", icon: "text-emerald-600", bar: "bg-emerald-500" },
      ]
      return Array.from(wardMap.entries()).map(([ward, wardBeds], idx) => {
        const occupied = wardBeds.filter((b) => b.status === "Occupied").length
        const total = wardBeds.length
        const pct = total > 0 ? Math.min(100, Math.round((occupied / total) * 100)) : 0
        const palette = colorPalettes[idx % colorPalettes.length]
        return {
          ward,
          occupied,
          total,
          pct,
          palette,
        }
      })
    } catch {
      return []
    }
  }, [tick])

  const currentDateStr = useMemo(() => {
    return (
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " • " +
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    )
  }, [tick])

  return (
    <div className="flex-1 bg-[#F4F6FA] text-slate-800 p-4 md:p-6 overflow-y-auto space-y-4">
      {/* ── 1. DASHBOARD HEADER & COMMAND BAR ───────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 shadow-2xs">
            <Building2 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-bold text-slate-900 leading-tight">
                Hospital Operations &amp; Census Command
              </h1>
              <span className="bg-[#10B981] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                {roleLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Welcome back, {activeStaff?.name || "System Administrator"} (
              {activeStaff?.title || "Hospital Administrator"}) • Hospital Operations • {currentDateStr} • {hospitalCode}
            </p>
          </div>
        </div>

        {/* Right Badges & Refresh */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div
            className={`flex items-center gap-1.5 px-3 py-1 border rounded-full text-xs font-semibold ${
              server === "up" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : server === "down" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-slate-100 text-slate-600 border-slate-200"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${server === "up" ? "bg-emerald-500 animate-pulse" : server === "down" ? "bg-rose-500" : "bg-slate-400"}`} />
            <span>{server === "up" ? "Server connected" : server === "down" ? "Server unreachable: showing last saved data" : "Checking server…"}</span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-3 py-1 ${
              edActiveCount > 0
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
            } border rounded-full text-xs font-semibold`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                edActiveCount > 0 ? "bg-rose-500 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span>ED Active: {edActiveCount}</span>
          </div>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw
              size={13}
              className={`text-slate-500 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── 2. DYNAMIC ALERT BANNERS ────────────────────────────────────── */}
      <div className="space-y-2.5">
        {/* Banner 1: Critical Lab Alert (Only shown if a real critical lab exists) */}
        {criticalLab && !banner1Dismissed && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3 flex items-center justify-between shadow-2xs gap-3 animate-in fade-in">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={15} />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-rose-950 truncate">
                  Critical Lab Result - {criticalLab.patientName} {criticalLab.umr ? `(UMR ${criticalLab.umr})` : ""}
                </h4>
                <p className="text-[11px] text-rose-700 truncate">
                  A result was flagged Critical by the laboratory. Requires immediate physician review.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => navigate("laboratory")}
                className="px-3 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                Review Now
              </button>
              <button
                onClick={() => setBanner1Dismissed(true)}
                className="text-rose-400 hover:text-rose-700 p-1 rounded-md transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Banner 2: Emergency Bed Alert (Only shown if actual critical cases exist) */}
        {kpis.alerts.er > 0 && !banner2Dismissed && (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 flex items-center justify-between shadow-2xs gap-3 animate-in fade-in">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle size={15} />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-amber-950 truncate">
                  Emergency Bed Alert
                </h4>
                <p className="text-[11px] text-amber-800 truncate">
                  ED census at {kpis.ed.active} active patients ({kpis.ed.waiting} waiting). {kpis.alerts.er} high-priority ESI-1/2 case{kpis.alerts.er === 1 ? "" : "s"} in care.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => navigate("emergency")}
                className="px-3 py-1 bg-white hover:bg-amber-50 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                View ED Board
              </button>
              <button
                onClick={() => setBanner2Dismissed(true)}
                className="text-amber-400 hover:text-amber-700 p-1 rounded-md transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 3. KEY METRICS KPI CARDS ROW (6 CARDS) ──────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Key metrics</span>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden bg-white" role="group" aria-label="Graph period">
            {([["day", "Today by hour"], ["week", "Last 7 days"]] as const).map(([m, l]) => (
              <button key={m} type="button" onClick={() => chooseMode(m)} className={`px-3 h-7 text-[11px] font-semibold cursor-pointer ${mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Patients Today"
            icon={<Users size={14} />}
            tint="bg-blue-50 text-blue-600"
            stroke="stroke-blue-500"
            value={kpis.patients.total}
            badge={kpis.patients.newRegistrations > 0 ? { text: `${kpis.patients.newRegistrations} newly registered`, tone: "bg-blue-50 text-blue-700" } : { text: "each patient once", tone: "bg-slate-50 text-slate-400" }}
            sub={`OP ${kpis.patients.op} · ER ${kpis.patients.er} · In beds ${kpis.patients.ip}`}
            {...graph(kpis.patients.trend, kpis.hourly.patients, "bg-blue-500")}
            action="View All"
            actionTone="text-blue-600 hover:text-blue-700"
            onAction={() => navigate("patients")}
            title="Distinct patients seen or in the hospital today: OP visits today, ER patients (arrived today or still in ER), patients in beds, admitted or discharged today. Each person is counted once."
          />
          <KpiCard
            label="Appointments"
            icon={<Calendar size={14} />}
            tint="bg-purple-50 text-purple-600"
            stroke="stroke-purple-500"
            value={kpis.appointments.total}
            badge={kpis.appointments.total > 0 ? { text: `${kpis.appointments.completed} completed`, tone: "bg-purple-50 text-purple-700" } : { text: "none today", tone: "bg-slate-50 text-slate-400" }}
            sub={`${kpis.appointments.waiting} waiting · ${kpis.appointments.inConsultation} in consultation`}
            {...graph(kpis.appointments.trend, kpis.hourly.appointments, "bg-purple-500")}
            action="Schedule"
            actionTone="text-purple-600 hover:text-purple-700"
            onAction={() => navigate("appointments")}
            title="OP visits registered today."
          />
          <KpiCard
            label="Admitted Today"
            icon={<BedDouble size={14} />}
            tint="bg-rose-50 text-rose-600"
            stroke="stroke-rose-400"
            value={kpis.admissions.today}
            badge={kpis.admissions.totalBeds > 0 ? { text: `${kpis.admissions.occupancyPct}% occupied`, tone: kpis.admissions.occupancyPct > 75 ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700" } : { text: "0 beds configured", tone: "bg-slate-50 text-slate-400" }}
            sub={`In beds now ${kpis.admissions.inBeds} · Free ${kpis.admissions.free}`}
            {...graph(kpis.admissions.trend, kpis.hourly.admissions, "bg-rose-500")}
            action="Bed Board"
            actionTone="text-rose-600 hover:text-rose-700"
            onAction={() => navigate("inpatient")}
            title="Patients admitted to a bed today (including any already discharged). Beds now = occupied beds on the bed board."
          />
          <KpiCard
            label="Discharged Today"
            icon={<LogOut size={14} />}
            tint="bg-emerald-50 text-emerald-600"
            stroke="stroke-emerald-500"
            value={kpis.discharges.today}
            badge={kpis.discharges.planned > 0 ? { text: `${kpis.discharges.planned} due today`, tone: "bg-amber-50 text-amber-700" } : { text: "none pending", tone: "bg-emerald-50 text-emerald-600" }}
            sub={kpis.discharges.planned > 0 ? "Beds whose expected discharge is today or earlier" : "No expected discharge is overdue"}
            {...graph(kpis.discharges.trend, kpis.hourly.discharges, "bg-emerald-500")}
            action="View Queue"
            actionTone="text-emerald-600 hover:text-emerald-700"
            onAction={() => navigate("inpatient")}
            title="Patients discharged today. 'Due today' = occupied beds whose expected discharge date is today or earlier."
          />
          <KpiCard
            label="ED Now"
            icon={<Clock size={14} />}
            tint="bg-amber-50 text-amber-600"
            stroke="stroke-amber-500"
            value={kpis.ed.active}
            badge={kpis.ed.waiting > 0 ? { text: `${kpis.ed.waiting} waiting`, tone: "bg-amber-100 text-amber-800" } : kpis.ed.active > 0 ? { text: "none waiting", tone: "bg-emerald-50 text-emerald-600" } : { text: "ED clear", tone: "bg-emerald-50 text-emerald-600" }}
            sub={`${kpis.ed.underTreatment} in treatment · ${kpis.ed.bedRequested} awaiting bed · ${kpis.ed.critical} ESI-1/2`}
            {...graph(kpis.ed.trend, kpis.hourly.ed, "bg-amber-500")}
            action="View ED"
            actionTone="text-amber-600 hover:text-amber-700"
            onAction={() => navigate("emergency")}
            title="Open ER visits now. Waiting = not yet seen (pending or doctor assigned). The trend is ER arrivals per day."
          />
          <KpiCard
            label="Critical Alerts"
            icon={<AlertTriangle size={14} />}
            tint="bg-rose-50 text-rose-600"
            stroke="stroke-rose-500"
            value={kpis.alerts.total}
            badge={kpis.alerts.total > 0 ? { text: "Action required", tone: "bg-rose-50 text-rose-700 animate-pulse" } : { text: "All normal", tone: "bg-emerald-50 text-emerald-600" }}
            sub={`ER ESI-1/2 ${kpis.alerts.er} · Critical labs ${kpis.alerts.criticalLabs} · STAT open ${kpis.alerts.statPending}`}
            {...graph(kpis.alerts.trend, kpis.hourly.alerts, "bg-rose-600")}
            action="Review"
            actionTone="text-rose-600 hover:text-rose-700"
            onAction={() => navigate(kpis.alerts.er > 0 && kpis.alerts.criticalLabs === 0 ? "emergency" : "laboratory")}
            title="Open ER patients triaged ESI-1 or ESI-2, plus lab results flagged Critical in the last 24 hours. STAT orders still open are shown separately; they are urgent but not critical results."
          />
        </div>
        <div className="mt-1.5 text-[10.5px] text-slate-400 text-right">
          Live from the hospital records · updated {new Date(updatedAt).toLocaleTimeString("en-IN")} · re-checked every 15 s · {mode === "day" ? "lines are running totals for today, rising as patients and data arrive" : "lines show the last 7 days"}
        </div>
      </div>

      {/* ── 4. MIDDLE SECTION: CENSUS & CAPACITY + APPOINTMENTS ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left (2 Cols): Department Census & Capacity */}
        <div className="xl:col-span-2 bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <BedDouble size={16} />
                </div>
                <div>
                  <h3 className="text-xs md:text-sm font-bold text-slate-900">
                    Department Census &amp; Capacity
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Real-time patient distribution across care units
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate("inpatient")}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <span>Full Bed Board</span>
                <ArrowRight size={12} />
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="pb-2.5">Department</th>
                    <th className="pb-2.5 text-center">In Care</th>
                    <th className="pb-2.5 text-center">Waiting</th>
                    <th className="pb-2.5 text-center">Critical</th>
                    <th className="pb-2.5 text-center">Available</th>
                    <th className="pb-2.5 text-center">Capacity</th>
                    <th className="pb-2.5">Occupancy</th>
                    <th className="pb-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {departmentCensus.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-xs text-slate-400">
                        No active clinical care departments or units configured.
                      </td>
                    </tr>
                  ) : (
                    departmentCensus.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-6 h-6 rounded-md flex items-center justify-center ${
                                row.icon === "siren"
                                  ? "bg-rose-50 text-rose-600"
                                  : row.icon === "stethoscope"
                                  ? "bg-purple-50 text-purple-600"
                                  : row.icon === "heart"
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-blue-50 text-blue-600"
                              }`}
                            >
                              {row.icon === "siren" ? (
                                <Siren size={12} />
                              ) : row.icon === "stethoscope" ? (
                                <Stethoscope size={12} />
                              ) : row.icon === "heart" ? (
                                <Heart size={12} />
                              ) : (
                                <BedDouble size={12} />
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 text-xs">{row.name}</div>
                              <div className="text-[10px] text-slate-400 font-normal">{row.sub}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-center font-bold text-slate-800">{row.inCare}</td>
                        <td className="py-3 text-center text-slate-400">{row.waiting}</td>
                        <td className="py-3 text-center">
                          {row.critical !== "—" ? (
                            <span className="bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full text-[10px]">
                              {row.critical}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 text-center">
                          {row.capacityStr === "—" ? (
                            "—"
                          ) : (
                            <span
                              className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${
                                row.available > 0
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {row.available} beds
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-center text-slate-500 font-mono text-[11px]">
                          {row.capacityStr}
                        </td>
                        <td className="py-3 w-28">
                          <div className="flex items-center gap-2">
                            {row.occupancyPct === null ? (
                              <span className="text-[11px] text-slate-400">—</span>
                            ) : (
                              <>
                                <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <div className={`h-full ${row.barColor} rounded-full transition-all`} style={{ width: `${row.occupancyPct}%` }} />
                                </div>
                                <span className="text-[11px] font-semibold text-slate-600">{row.occupancyPct}%</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => navigate(row.actionNav)}
                            className="text-blue-600 hover:text-blue-700 font-semibold text-xs cursor-pointer"
                          >
                            {row.actionLabel}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right (1 Col): Today's Appointments */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Calendar size={15} />
                </div>
                <h3 className="text-xs md:text-sm font-bold text-slate-900">
                  Today's Appointments
                </h3>
              </div>
              <button
                onClick={() => navigate("appointments")}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <span>View All</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {/* Appointment List Items */}
            <div className="space-y-3">
              {recentAppointments.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No appointments registered today.
                </div>
              ) : (
                recentAppointments.map((enc, idx) => {
                  const initials = (enc.patientName || "PT")
                    .split(" ")
                    .map((w) => w[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase() || "PT"
                  const timeStr =
                    enc.registrationTime ||
                    enc.timestamps?.arrival ||
                    (enc.createdAt
                      ? new Date(enc.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Today")
                  const docStr = enc.assignedDoctor
                    ? `Dr. ${enc.assignedDoctor.replace(/^Dr\.\s*/i, "")}`
                    : "Attending Physician"
                  const deptStr = enc.dept || "General OPD"
                  const status = enc.status || "Registered"
                  const isConsulted =
                    status === "Consultation Completed" || status === "OP Completed"
                  const isCalling =
                    status === "Under Consultation" || status === "Doctor Assigned"

                  const avatarColors = [
                    "bg-blue-100 text-blue-700",
                    "bg-purple-100 text-purple-700",
                    "bg-cyan-100 text-cyan-700",
                    "bg-indigo-100 text-indigo-700",
                    "bg-emerald-100 text-emerald-700",
                  ]

                  return (
                    <div
                      key={enc.id}
                      onClick={() => navigate("appointments")}
                      className="flex items-center justify-between gap-2 p-1.5 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-full ${avatarColors[idx % avatarColors.length]} font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs`}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-400">{timeStr}</span>
                            <span className="text-xs font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                              {enc.patientName}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-500 truncate">
                            {docStr} • {deptStr}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isConsulted
                              ? "bg-slate-100 text-slate-600"
                              : isCalling
                              ? "bg-emerald-50 text-emerald-700 font-bold"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. LOWER SECTION: PENDING LABS + QUICK ACTIONS ──────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left (2 Cols): Pending Diagnostic Labs */}
        <div className="xl:col-span-2 bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <FlaskConical size={16} />
                </div>
                <div>
                  <h3 className="text-xs md:text-sm font-bold text-slate-900">
                    Pending Diagnostic Labs
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Active orders in processing or critical review
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate("laboratory")}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <span>Laboratory Hub</span>
                <ArrowRight size={12} />
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="pb-2.5">Patient</th>
                    <th className="pb-2.5">MRN</th>
                    <th className="pb-2.5">Test Name</th>
                    <th className="pb-2.5">Lab Dept</th>
                    <th className="pb-2.5">Ordered Time</th>
                    <th className="pb-2.5">Status</th>
                    <th className="pb-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {recentLabs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-xs text-slate-400">
                        No pending diagnostic lab orders.
                      </td>
                    </tr>
                  ) : (
                    recentLabs.map((lab) => {
                      const testSummary =
                        lab.tests?.map((t) => t.name).join(", ") ||
                        "Diagnostic Test Panel"
                      // A clock time alone reads as "today": an older order also shows its date.
                      const orderedTime = lab.createdAt
                        ? (dayKey(new Date(lab.createdAt).getTime()) === dayKey(Date.now()) ? "" : new Date(lab.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", ") +
                          new Date(lab.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"
                      const isCritical = (lab.status as string) === "Critical"
                      const isPendingBilling = lab.billing?.status === "Pending"

                      return (
                        <tr
                          key={lab.id}
                          className="hover:bg-slate-50/70 transition-colors"
                        >
                          <td className="py-3 font-bold text-slate-900">
                            {lab.patientName}
                          </td>
                          <td className="py-3">
                            <span className="font-mono text-[10.5px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              #{lab.umr || lab.opNumber || "PAT-001"}
                            </span>
                          </td>
                          <td
                            className="py-3 text-slate-700 truncate max-w-[160px]"
                            title={testSummary}
                          >
                            {testSummary}
                          </td>
                          <td className="py-3 text-slate-600">
                            {lab.tests?.[0]?.category || "Pathology"}
                          </td>
                          <td className="py-3 text-slate-500 font-mono text-[11px]">
                            {orderedTime}
                          </td>
                          <td className="py-3">
                            {isCritical ? (
                              <span className="bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full text-[10.5px] flex items-center gap-1 w-fit">
                                <span>⚠ Critical</span>
                              </span>
                            ) : isPendingBilling ? (
                              <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full text-[10.5px] flex items-center gap-1 w-fit">
                                <span>⚠ Awaiting Billing</span>
                              </span>
                            ) : (
                              <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full text-[10.5px] flex items-center gap-1 w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                                <span>{lab.status || "In Progress"}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() =>
                                navigate(isPendingBilling ? "billing" : "laboratory")
                              }
                              className="text-blue-600 hover:text-blue-700 font-semibold text-xs flex items-center gap-0.5 ml-auto cursor-pointer"
                            >
                              <span>View</span>
                              <ExternalLink size={10} />
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
        </div>

        {/* Right (1 Col): Hospital Quick Actions (Dynamic Grid) */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <SlidersHorizontal size={14} />
                </div>
                <h3 className="text-xs md:text-sm font-bold text-slate-900">
                  Hospital Quick Actions
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(true)}
                className="text-xs font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-1 cursor-pointer transition-colors"
                title="Customize quick action shortcuts"
              >
                <SlidersHorizontal size={11} />
                <span>Customize</span>
              </button>
            </div>

            {/* Dynamic Quick Actions Grid (4 x 2) */}
            <div className="grid grid-cols-4 gap-2.5">
              {activeQuickActions.map((action) => {
                const IconComponent = ICON_MAP[action.iconName] || SlidersHorizontal
                return (
                  <button
                    key={action.id}
                    onClick={() => navigate(action.module, action.subModule)}
                    className={`flex flex-col items-center justify-center p-2.5 ${action.hoverBg} rounded-xl transition-all group cursor-pointer text-center relative`}
                    style={{ backgroundColor: action.bg }}
                    title={action.desc}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg ${action.iconBg} text-white flex items-center justify-center mb-1.5 shadow-2xs group-hover:scale-105 transition-transform`}
                    >
                      <IconComponent size={16} />
                    </div>
                    <span
                      className={`text-[10px] font-bold ${action.textColor} leading-tight line-clamp-2`}
                    >
                      {action.label}
                    </span>
                  </button>
                )
              })}

              {activeQuickActions.length < 8 && (
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen(true)}
                  className="flex flex-col items-center justify-center p-2.5 bg-slate-50 hover:bg-blue-50/50 border border-dashed border-slate-300 hover:border-blue-400 rounded-xl transition-all group cursor-pointer text-center"
                  title="Add more quick actions"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-200/80 group-hover:bg-blue-500 text-slate-500 group-hover:text-white flex items-center justify-center mb-1.5 transition-colors shadow-2xs">
                    <Plus size={16} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-600 group-hover:text-blue-700 leading-tight">
                    Add Action
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 6. BOTTOM ROW: HOSPITAL UNIT OCCUPANCY & CAPACITY OVERVIEW ──── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Building2 size={16} />
            </div>
            <div>
              <h3 className="text-xs md:text-sm font-bold text-slate-900">
                Hospital Unit Occupancy &amp; Capacity Overview
              </h3>
              <p className="text-[11px] text-slate-400">
                Live bed utilization metrics across inpatient wards
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("inpatient")}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
          >
            <span>View All Wards</span>
            <ArrowRight size={12} />
          </button>
        </div>

        {/* Dynamic Ward Cards */}
        {liveWardOccupancy.length === 0 ? (
          <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <BedDouble className="mx-auto text-slate-300 mb-2" size={28} />
            <p className="text-xs font-semibold text-slate-700">No Inpatient Wards Configured</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Live ward utilization and bed occupancy will automatically appear here once inpatient wards and beds are configured.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {liveWardOccupancy.map((w) => (
              <div
                key={w.ward}
                className="bg-slate-50 border border-slate-200/70 rounded-xl p-3 flex flex-col justify-between"
              >
                <div>
                  <h4 className="text-xs font-bold text-slate-900 truncate" title={w.ward}>
                    {w.ward}
                  </h4>
                  <div className="flex items-center justify-between mt-2 text-[11px]">
                    <span className="flex items-center gap-1 text-slate-600 font-medium">
                      <BedDouble size={13} className={w.palette.icon} />
                      <span>
                        {w.occupied} / {w.total} beds
                      </span>
                    </span>
                    <span className={`font-bold ${w.palette.text}`}>{w.pct}% Occupied</span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden mt-2.5">
                  <div
                    className={`h-full ${w.palette.bar} rounded-full`}
                    style={{ width: `${w.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions Customization Modal */}
      <QuickActionsCustomizeModal
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        currentActionIds={quickActionIds}
        onSave={handleSaveQuickActions}
      />
    </div>
  )
}
