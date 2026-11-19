import { useEffect, useMemo, useState } from "react"
import { listDoctors } from "../../services/ipCare"
import type { DoctorAccount } from "../../services/doctorPortalDb"

/**
 * Pick the concern (attending) doctor from the doctor master -- never a typed name -- with the doctors of the
 * wanted specialty first. Used where the admitting doctor decides (ER), where a bed is allocated and where a
 * patient is handed over to another doctor.
 */
export default function ConcernDoctorPicker({
  value,
  onChange,
  specialtyHint,
  label = "Concern doctor (admitting consultant)",
  required = false,
  exceptId,
  className,
}: {
  value: string
  onChange: (doctor: DoctorAccount | null) => void
  specialtyHint?: string | null
  label?: string
  required?: boolean
  /** Leave this doctor out (the current attending, when handing over). */
  exceptId?: string | null
  className?: string
}) {
  const [doctors, setDoctors] = useState<DoctorAccount[]>(() => listDoctors())
  useEffect(() => {
    const refresh = () => setDoctors(listDoctors())
    window.addEventListener("doctor_master_updated", refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener("doctor_master_updated", refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  const { matching, others } = useMemo(() => {
    const hint = (specialtyHint || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/ward|unit|department|icu|intensive care/g, "").trim()
    const list = doctors.filter((d) => !exceptId || (d.id !== exceptId && d.staffId !== exceptId))
    const m = hint.length >= 3 ? list.filter((d) => (d.specialty || "").toLowerCase().includes(hint) || hint.includes((d.specialty || "").toLowerCase())) : []
    return { matching: m, others: list.filter((d) => !m.includes(d)) }
  }, [doctors, specialtyHint, exceptId])

  const opt = (d: DoctorAccount) => (
    <option key={d.id} value={d.id}>
      {d.name}
      {d.specialty ? ` — ${d.specialty}` : ""}
    </option>
  )

  return (
    <label className={`block ${className || ""}`}>
      <span className="text-[11.5px] font-semibold text-slate-700">
        {label} {required && <span className="text-red-600">*</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(doctors.find((d) => d.id === e.target.value) || null)}
        className="mt-1 w-full h-9 px-2 border border-slate-300 bg-white text-[13px] rounded-none focus:outline-none focus:border-blue-700"
      >
        <option value="">{doctors.length ? "Select the concern doctor…" : "No doctors in the doctor master"}</option>
        {matching.length > 0 && <optgroup label={`${specialtyHint} doctors`}>{matching.map(opt)}</optgroup>}
        {others.length > 0 && <optgroup label={matching.length ? "Other doctors" : "Doctors"}>{others.map(opt)}</optgroup>}
      </select>
    </label>
  )
}
