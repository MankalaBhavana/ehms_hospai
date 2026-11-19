import React, { useState, useEffect } from "react"
import { FiEdit2, FiCheck, FiRefreshCw, FiX, FiLayers } from "react-icons/fi"
import {
  WardCustomizationService,
  STANDARD_WARD_UNITS,
} from "../../services/wardCustomization"
import { Modal, Button, Input } from "../ui"

interface CustomizeWardsModalProps {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

export function CustomizeWardsModal({
  open,
  onClose,
  onSaved,
}: CustomizeWardsModalProps) {
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<"all" | "icu" | "ward">("all")

  useEffect(() => {
    if (open) {
      setCustomNames(WardCustomizationService.getCustomizations())
    }
  }, [open])

  const handleNameChange = (id: string, newName: string) => {
    setCustomNames((prev) => ({
      ...prev,
      [id]: newName,
    }))
  }

  const handleSave = () => {
    Object.entries(customNames).forEach(([id, name]) => {
      WardCustomizationService.setCustomName(id, name)
    })
    onSaved?.()
    onClose()
  }

  const handleReset = () => {
    if (window.confirm("Reset all Ward and ICU names back to system defaults?")) {
      WardCustomizationService.resetAll()
      setCustomNames({})
      onSaved?.()
      onClose()
    }
  }

  const filteredUnits = STANDARD_WARD_UNITS.filter((u) => {
    if (activeTab === "icu") return u.category === "Critical Care (ICU)"
    if (activeTab === "ward") return u.category !== "Critical Care (ICU)"
    return true
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize Ward & ICU Unit Names"
      description="Personalize clinical unit names for your hospital. Names update instantly in sidebar navigation, bed board dropdowns, and inpatient views."
    >
      <div className="space-y-4 pt-1">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 border-b border-[#E2E8F0] pb-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1 rounded font-bold cursor-pointer transition-colors ${
              activeTab === "all"
                ? "bg-[#1B4FD8] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            All Units ({STANDARD_WARD_UNITS.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("icu")}
            className={`px-3 py-1 rounded font-bold cursor-pointer transition-colors ${
              activeTab === "icu"
                ? "bg-[#7C3AED] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Critical Care / ICUs (
            {
              STANDARD_WARD_UNITS.filter(
                (u) => u.category === "Critical Care (ICU)",
              ).length
            }
            )
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ward")}
            className={`px-3 py-1 rounded font-bold cursor-pointer transition-colors ${
              activeTab === "ward"
                ? "bg-[#0284C7] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            General Wards (
            {
              STANDARD_WARD_UNITS.filter(
                (u) => u.category !== "Critical Care (ICU)",
              ).length
            }
            )
          </button>
        </div>

        {/* Units List */}
        <div className="max-h-[420px] overflow-y-auto space-y-2.5 pr-1 divide-y divide-[#F1F5F9]">
          {filteredUnits.map((unit) => {
            const currentVal = customNames[unit.id] ?? ""
            const isCustomized =
              Boolean(currentVal) && currentVal !== unit.defaultName

            return (
              <div
                key={unit.id}
                className="pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {unit.defaultName}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                        unit.category === "Critical Care (ICU)"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}
                    >
                      {unit.defaultBedType}
                    </span>
                    {isCustomized && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        Customized
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                    {unit.description}
                  </p>
                </div>

                <div className="w-full sm:w-60 flex items-center gap-1.5">
                  <Input
                    value={currentVal}
                    placeholder={unit.defaultName}
                    onChange={(e) => handleNameChange(unit.id, e.target.value)}
                    className="text-xs"
                  />
                  {currentVal && (
                    <button
                      type="button"
                      title="Reset to default"
                      onClick={() => handleNameChange(unit.id, "")}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                    >
                      <FiX className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-[#E2E8F0]">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-red-600 hover:text-red-800 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <FiRefreshCw className="w-3 h-3" /> Reset all to defaults
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex items-center gap-1.5">
              <FiCheck className="w-4 h-4" /> Save Custom Names
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
