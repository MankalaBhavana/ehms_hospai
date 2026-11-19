import React from "react"
import {
  FiChevronRight,
  FiHome,
  FiArrowLeft,
  FiUser,
  FiUserPlus,
  FiClipboard,
  FiCreditCard,
  FiActivity,
  FiFolder,
  FiPlusCircle,
  FiPackage,
  FiFileText,
} from "react-icons/fi"

export interface BreadcrumbItem {
  module: string
  subModule?: string
  label: string
  patientId?: string
  patientName?: string
  encounterId?: string
  timestamp?: number
}

interface BreadcrumbsBarProps {
  trail: BreadcrumbItem[]
  currentModule: string
  currentSubModule?: string
  currentPatientName?: string
  currentPatientId?: string
  onNavigateCrumb: (item: BreadcrumbItem, index: number) => void
  onGoBack: () => void
}

function getModuleIcon(mod: string): React.ComponentType<{ className?: string }> {
  if (mod === "dashboard") return FiHome
  if (mod === "register" || mod === "patients") return FiUserPlus
  if (mod === "chart" || mod === "patient_record") return FiUser
  if (
    mod === "outpatient" ||
    mod === "op_management" ||
    mod === "op_workflow" ||
    mod === "queue" ||
    mod === "op_nurse"
  )
    return FiClipboard
  if (mod.startsWith("billing") || mod === "payments") return FiCreditCard
  if (mod === "pharmacy" || mod.startsWith("pharmacy_")) return FiPackage
  if (
    mod === "icu" ||
    mod.startsWith("icu_") ||
    mod === "emergency" ||
    mod === "triage"
  )
    return FiActivity
  if (
    mod === "inpatient" ||
    mod === "beds" ||
    mod === "admissions" ||
    mod === "readmission"
  )
    return FiPlusCircle
  if (mod.startsWith("reports") || mod.startsWith("accounts")) return FiFileText
  return FiFolder
}

export function BreadcrumbsBar({
  trail,
  currentModule,
  currentSubModule,
  currentPatientName,
  currentPatientId,
  onNavigateCrumb,
  onGoBack,
}: BreadcrumbsBarProps) {
  if (trail.length === 0) return null

  const canGoBack = trail.length > 1
  const previousItem = canGoBack ? trail[trail.length - 2] : null

  return (
    <nav
      aria-label="Workflow Navigation"
      className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs flex-nowrap overflow-x-auto flex-shrink-0 z-30 shadow-2xs"
    >
      <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap min-w-0">
        {/* Quick Back Action Button */}
        {canGoBack && (
          <button
            type="button"
            onClick={onGoBack}
            title={`Go back to ${previousItem?.label || "previous step"}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 font-bold border border-slate-300 shadow-xs transition-all duration-150 active:scale-95 cursor-pointer shrink-0 mr-1.5"
          >
            <FiArrowLeft className="w-4 h-4 text-[#1B4FD8]" />
            <span className="hidden sm:inline">Back</span>
          </button>
        )}

        {/* Breadcrumb Buttons */}
        {trail.map((item, index) => {
          const isLast = index === trail.length - 1
          const IconComp = getModuleIcon(item.module)

          return (
            <React.Fragment key={`${item.module}-${item.subModule || ""}-${index}`}>
              {index > 0 && (
                <FiChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 select-none mx-0.5" />
              )}

              {isLast ? (
                /* Active Current Step Button */
                <button
                  type="button"
                  onClick={() => onNavigateCrumb(item, index)}
                  title={`Current view: ${item.label} (Click to refresh/focus)`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B4FD8] hover:bg-blue-700 active:bg-blue-800 text-white font-bold border border-blue-700 shadow-xs transition-all duration-150 active:scale-95 cursor-pointer shrink-0 ring-2 ring-blue-400/25 max-w-[280px]"
                >
                  <IconComp className="w-3.5 h-3.5 text-blue-200 shrink-0" />
                  {item.patientName && (
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-100 truncate max-w-[140px]">
                      <FiUser className="w-3 h-3 text-blue-200 shrink-0" />
                      <span className="truncate">{item.patientName}</span>
                      <span className="text-blue-300 mx-0.5">&middot;</span>
                    </span>
                  )}
                  <span className="truncate">{item.label}</span>
                  <span
                    className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"
                    title="Active Page"
                  />
                </button>
              ) : (
                /* Prior Step Button (Clickable Navigation Button) */
                <button
                  type="button"
                  onClick={() => onNavigateCrumb(item, index)}
                  title={`Click to navigate to ${item.label}`}
                  className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-blue-50/80 active:bg-blue-100 text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-400 shadow-2xs hover:shadow-xs transition-all duration-150 active:scale-95 cursor-pointer shrink-0 font-medium max-w-[240px]"
                >
                  <IconComp className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-600 shrink-0 transition-colors" />
                  {item.patientName && (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900 group-hover:text-blue-800 truncate max-w-[120px]">
                      <FiUser className="w-3 h-3 text-blue-600 shrink-0" />
                      <span className="truncate">{item.patientName}</span>
                      <span className="text-slate-400 mx-0.5 font-normal">&middot;</span>
                    </span>
                  )}
                  <span className="truncate">{item.label}</span>
                </button>
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Right context pill if patient is active */}
      {(currentPatientName || currentPatientId) && (
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs shrink-0">
          <span className="text-slate-400 font-semibold uppercase text-[10px]">
            Active Patient:
          </span>
          <span className="font-bold text-slate-900">
            {currentPatientName || "Patient"}
          </span>
          {currentPatientId && (
            <span className="font-mono text-[11px] bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded">
              {currentPatientId}
            </span>
          )}
        </div>
      )}
    </nav>
  )
}
