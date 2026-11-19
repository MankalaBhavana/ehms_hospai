import { PriceMaster } from "./priceMaster"
/**
 * Hospital Ward and ICU Customization Service
 * 
 * Manages standard and custom names for Critical Care Units (MICU, SICU, CCU, NICU, PICU, ICU Ward)
 * and Inpatient General Wards. Allows administrators/clinicians to customize unit names,
 * persisting them and dynamically updating sidebar navigation and bed board dropdowns.
 */

export interface WardUnitDefinition {
  id: string
  defaultName: string
  category: "Critical Care (ICU)" | "General Ward" | "Specialty Ward"
  defaultBedType: "MICU" | "SICU" | "CCU" | "NICU" | "PICU" | "ICU" | "General" | "Semi-Private" | "Private" | "HDU"
  defaultDailyRate: number
  description: string
}

export const STANDARD_WARD_UNITS: WardUnitDefinition[] = [
  // Critical Care Units (Matching EHMS Critical Care module)
  {
    id: "icu_micu",
    defaultName: "Medical ICU (MICU)",
    category: "Critical Care (ICU)",
    defaultBedType: "MICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Medical Intensive Care Unit for acute non-surgical critical illnesses.",
  },
  {
    id: "icu_sicu",
    defaultName: "Surgical ICU (SICU)",
    category: "Critical Care (ICU)",
    defaultBedType: "SICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Surgical Intensive Care Unit for post-operative high-risk patients.",
  },
  {
    id: "icu_ccu",
    defaultName: "Cardiac ICU (CCU)",
    category: "Critical Care (ICU)",
    defaultBedType: "CCU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Coronary Care Unit for acute coronary syndromes and cardiac telemetry.",
  },
  {
    id: "icu_nicu",
    defaultName: "Neuro ICU (NICU)",
    category: "Critical Care (ICU)",
    defaultBedType: "NICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Neuro Intensive Care Unit for neurovascular, stroke, and post-neurosurgery care.",
  },
  {
    id: "icu_picu",
    defaultName: "Pediatric ICU (PICU)",
    category: "Critical Care (ICU)",
    defaultBedType: "PICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Pediatric Intensive Care Unit for infants, children, and adolescents.",
  },
  {
    id: "icu_ward",
    defaultName: "ICU Ward",
    category: "Critical Care (ICU)",
    defaultBedType: "ICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "High-dependency and step-down intensive care ward.",
  },
  {
    id: "icu_general",
    defaultName: "ICU",
    category: "Critical Care (ICU)",
    defaultBedType: "ICU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "General Intensive Care Unit.",
  },
  {
    id: "hdu",
    defaultName: "High Dependency Unit (HDU)",
    category: "Critical Care (ICU)",
    defaultBedType: "HDU",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Step-down care between ICU and general inpatient ward.",
  },

  // General & Inpatient Wards
  {
    id: "ward_general",
    defaultName: "General Ward",
    category: "General Ward",
    defaultBedType: "General",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Standard shared general inpatient medical/surgical ward.",
  },
  {
    id: "ward_emergency",
    defaultName: "Emergency Ward",
    category: "General Ward",
    defaultBedType: "General",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Short-stay emergency observation and stabilization ward.",
  },
  {
    id: "ward_male",
    defaultName: "Male Medical Ward",
    category: "General Ward",
    defaultBedType: "General",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Inpatient male medical ward.",
  },
  {
    id: "ward_female",
    defaultName: "Female Surgical Ward",
    category: "General Ward",
    defaultBedType: "General",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Inpatient female surgical ward.",
  },
  {
    id: "ward_semi_private",
    defaultName: "Semi-Private Ward",
    category: "Specialty Ward",
    defaultBedType: "Semi-Private",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Dual-occupancy twin sharing room ward.",
  },
  {
    id: "ward_private",
    defaultName: "Private Deluxe Ward",
    category: "Specialty Ward",
    defaultBedType: "Private",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Single-patient air-conditioned private deluxe room ward.",
  },
  {
    id: "ward_post_op",
    defaultName: "Post-Op Recovery Ward",
    category: "Specialty Ward",
    defaultBedType: "General",
    defaultDailyRate: 0, // the daily rate comes from Administration > Rates & Charges (by bed type)
    description: "Post-surgical recovery ward for step-down PACU patients.",
  },
]

const STORAGE_KEY = "hospai_ward_unit_customizations_v1"

export class WardCustomizationService {
  /**
   * Retrieves user customizations map (e.g. { "icu_micu": "Cardio MICU", "ward_general": "Floor 2 Medical" })
   */
  static getCustomizations(): Record<string, string> {
    if (typeof window === "undefined" || !window.localStorage) return {}
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }

  /**
   * Saves or updates a customization for a unit key or default name
   */
  static setCustomName(unitIdOrDefaultName: string, customName: string): void {
    if (typeof window === "undefined" || !window.localStorage) return
    try {
      const current = this.getCustomizations()
      const trimmed = customName.trim()
      if (!trimmed) {
        delete current[unitIdOrDefaultName]
      } else {
        current[unitIdOrDefaultName] = trimmed
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
      window.dispatchEvent(
        new CustomEvent("hospai_ward_customization_updated", {
          detail: current,
        }),
      )
    } catch (e) {
      console.error("Failed to save ward customization", e)
    }
  }

  /**
   * Gets the display name for a unit ID or default name (e.g. "icu_micu" -> "Cardio MICU" or "Medical ICU (MICU)")
   */
  static getDisplayName(unitIdOrDefaultName: string): string {
    const customizations = this.getCustomizations()
    if (customizations[unitIdOrDefaultName]) {
      return customizations[unitIdOrDefaultName]
    }
    // Check by unit ID
    const foundById = STANDARD_WARD_UNITS.find((u) => u.id === unitIdOrDefaultName)
    if (foundById && customizations[foundById.defaultName]) {
      return customizations[foundById.defaultName]
    }
    if (foundById) return foundById.defaultName

    // Check by default name
    const foundByName = STANDARD_WARD_UNITS.find(
      (u) => u.defaultName.toLowerCase() === unitIdOrDefaultName.toLowerCase(),
    )
    if (foundByName && customizations[foundByName.id]) {
      return customizations[foundByName.id]
    }
    if (foundByName) return foundByName.defaultName

    return unitIdOrDefaultName
  }

  /**
   * Returns all active wards and ICUs with custom names applied
   */
  static getAllWards(additionalFromBeds: string[] = []): {
    id: string
    name: string
    category: string
    bedType: string
    dailyRate: number
    isCustom: boolean
  }[] {
    const customizations = this.getCustomizations()
    const result: {
      id: string
      name: string
      category: string
      bedType: string
      dailyRate: number
      isCustom: boolean
    }[] = STANDARD_WARD_UNITS.map((u) => {
      const custom = customizations[u.id] || customizations[u.defaultName]
      return {
        id: u.id,
        name: custom || u.defaultName,
        category: u.category,
        bedType: u.defaultBedType,
        dailyRate: PriceMaster.bedRate(u.defaultBedType),
        isCustom: Boolean(custom),
      }
    })

    // Include existing unique wards in the database that are not covered by standard units
    const existingNamesLower = new Set(result.map((w) => w.name.toLowerCase()))
    for (const rawName of additionalFromBeds) {
      const trimmed = (rawName || "").trim()
      if (!trimmed || trimmed === "Unassigned Ward") continue
      if (!existingNamesLower.has(trimmed.toLowerCase())) {
        existingNamesLower.add(trimmed.toLowerCase())
        const isIcu = trimmed.toUpperCase().includes("ICU")
        result.push({
          id: `custom_ward_${trimmed.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          name: trimmed,
          category: isIcu ? "Critical Care (ICU)" : "General Ward",
          bedType: isIcu ? "ICU" : "General",
          dailyRate: isIcu ? 8000 : 1500,
          isCustom: true,
        })
      }
    }

    return result
  }

  /**
   * Resets all customizations back to factory defaults
   */
  static resetAll(): void {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(
      new CustomEvent("hospai_ward_customization_updated", { detail: {} }),
    )
  }
}
