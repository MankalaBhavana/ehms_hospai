/**
 * Hospital rate master: every amount the hospital charges that is not a doctor's own consultation fee
 * (Doctor Master), a medicine's MRP (Pharmacy medicine master) or a lab / radiology price (Diagnostic
 * Tariff, which the Administration > Rates & Charges page edits too).
 *
 * Nothing is built in: until the Administration department enters an amount it is 0 / "not set", and
 * screens show that instead of inventing a price. Stored under `hospai_price_master_v1`, which the
 * shared-data sync mirrors to every user.
 */

const KEY = "hospai_price_master_v1"

export interface CustomCharge {
  id: string
  name: string
  category: string
  price: number
}

interface PriceState {
  fee: Record<string, number>
  bed: Record<string, number>
  service: Record<string, number>
  custom: CustomCharge[]
  /** Bed types Administration added beyond the built-in list. */
  bedTypes: string[]
  /** Built-in items Administration deleted ("lab:CBC", "rad:RAD-XR-001", "svc:<name>", "bed:<type>"). */
  hidden: string[]
}

/** The fixed fees the desks need. Labels are shown on the Rates page. */
export const FIXED_FEES: { key: string; label: string; help: string }[] = [
  { key: "registration_new", label: "New patient registration fee", help: "Charged once when a patient is first registered (OP desk)." },
  { key: "registration_revisit", label: "Revisit / existing patient fee", help: "Charged when a registered patient comes back. Leave empty for no fee." },
  { key: "emergency_registration", label: "Emergency registration fee", help: "Charged when an ER visit is opened. Leave empty for no fee." },
]

/** Bed types the hospital can charge a daily rate for. */
export const BED_TYPES = ["General", "Semi-Private", "Private", "ICU", "MICU", "SICU", "CCU", "NICU", "PICU", "Neuro ICU", "HDU", "Emergency"]

/** Charges the surgery module bills; Administration prices them under "Procedures & services". */
export const SURGERY_CHARGES = ["Operating theatre charge", "Surgeon fee", "Anaesthesia fee", "PACU recovery charge", "General surgical consumables"]

export const CHARGE_CATEGORIES = [
  "Consultation",
  "Procedure / Surgery",
  "Laboratory",
  "Radiology / Imaging",
  "Pharmacy",
  "Consumables",
  "Nursing",
  "Room / Bed",
  "Ambulance / Transport",
  "Administrative",
  "Other",
]

const listeners = new Set<() => void>()
let version = 0

function empty(): PriceState {
  return { fee: {}, bed: {}, service: {}, custom: [], bedTypes: [], hidden: [] }
}

function load(): PriceState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null
    if (raw) {
      const p = JSON.parse(raw)
      return { ...empty(), ...p, fee: p.fee || {}, bed: p.bed || {}, service: p.service || {}, custom: Array.isArray(p.custom) ? p.custom : [], bedTypes: Array.isArray(p.bedTypes) ? p.bedTypes : [], hidden: Array.isArray(p.hidden) ? p.hidden : [] }
    }
  } catch {
    /* fall through */
  }
  return empty()
}

function save(s: PriceState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* quota / private mode */
  }
  notify()
}

function notify() {
  version++
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

const norm = (v: string) => (v || "").toLowerCase().replace(/\s+/g, " ").trim()
const positive = (n: unknown) => (Number(n) > 0 ? Number(n) : 0)

if (typeof window !== "undefined") {
  // another tab / another user's change arrives through the sync layer as a storage event
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === KEY) notify()
  })
}

export const PriceMaster = {
  /** Changes whenever any rate changes (here or on another device): caches that depend on rates compare it. */
  version(): number {
    return version
  },
  onUpdate(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  // ── fixed fees ────────────────────────────────────────────────────────────
  fee(key: string): number {
    return positive(load().fee[key])
  },
  setFee(key: string, amount: number | null) {
    const s = load()
    if (amount === null || !(Number(amount) > 0)) delete s.fee[key]
    else s.fee[key] = Number(amount)
    save(s)
  },
  /** Registration fee for a visit: new patient vs. existing patient. 0 when the hospital has not set one. */
  registrationFee(isNewPatient: boolean): number {
    return isNewPatient ? this.fee("registration_new") : this.fee("registration_revisit")
  },

  // ── beds ──────────────────────────────────────────────────────────────────
  bedRate(bedType: string): number {
    const s = load().bed
    const t = norm(bedType)
    const hit = Object.keys(s).find((k) => norm(k) === t)
    return hit ? positive(s[hit]) : 0
  },
  setBedRate(bedType: string, amount: number | null) {
    const s = load()
    if (amount === null || !(Number(amount) > 0)) delete s.bed[bedType]
    else s.bed[bedType] = Number(amount)
    save(s)
  },

  /** Bed types Administration added (beyond the standard list). */
  customBedTypes(): string[] {
    return [...load().bedTypes]
  },
  /** Standard bed types plus the ones Administration added. */
  allBedTypes(): string[] {
    const st = load()
    const extra = st.bedTypes.filter((t) => !BED_TYPES.some((b) => norm(b) === norm(t)))
    return [...BED_TYPES, ...extra].filter((t) => !st.hidden.includes(`bed:${t}`))
  },
  // ── deleting built-in items (they leave the hospital's lists; can be restored) ──
  isHidden(key: string): boolean {
    return load().hidden.includes(key)
  },
  setHidden(key: string, hidden: boolean) {
    const s = load()
    s.hidden = s.hidden.filter((k) => k !== key)
    if (hidden) s.hidden.push(key)
    save(s)
  },
  addBedType(name: string, rate: number) {
    const n = (name || "").trim()
    if (!n) throw new Error("Enter the bed type name.")
    if (!(Number(rate) > 0)) throw new Error("Enter the daily rate (above 0).")
    const s = load()
    if ([...BED_TYPES, ...s.bedTypes].some((b) => norm(b) === norm(n))) throw new Error("This bed type already exists.")
    s.bedTypes.push(n)
    s.bed[n] = Number(rate)
    save(s)
  },
  removeBedType(name: string) {
    const s = load()
    s.bedTypes = s.bedTypes.filter((b) => norm(b) !== norm(name))
    delete s.bed[name]
    save(s)
  },

  // ── procedures / services (keyed by service name) ─────────────────────────
  service(name: string): number {
    const s = load().service
    const n = norm(name)
    const hit = Object.keys(s).find((k) => norm(k) === n)
    return hit ? positive(s[hit]) : 0
  },
  setService(name: string, amount: number | null) {
    const s = load()
    const existing = Object.keys(s.service).find((k) => norm(k) === norm(name))
    if (existing) delete s.service[existing]
    if (amount !== null && Number(amount) > 0) s.service[name] = Number(amount)
    save(s)
  },
  allServices(): Record<string, number> {
    return { ...load().service }
  },

  // ── other charges the administration adds ─────────────────────────────────
  custom(): CustomCharge[] {
    return [...load().custom]
  },
  addCustom(c: { name: string; category: string; price: number }): CustomCharge {
    const name = (c.name || "").trim()
    if (!name) throw new Error("Enter a name for the charge.")
    if (!(Number(c.price) > 0)) throw new Error("Enter the amount (above 0).")
    const s = load()
    if (s.custom.some((x) => norm(x.name) === norm(name))) throw new Error("A charge with this name already exists.")
    const item: CustomCharge = { id: `CHG-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`, name, category: c.category || "Other", price: Number(c.price) }
    s.custom.push(item)
    save(s)
    return item
  },
  updateCustom(id: string, patch: Partial<Pick<CustomCharge, "name" | "category" | "price">>) {
    const s = load()
    const i = s.custom.findIndex((x) => x.id === id)
    if (i < 0) return
    if (patch.price !== undefined && !(Number(patch.price) > 0)) throw new Error("Enter the amount (above 0).")
    s.custom[i] = { ...s.custom[i], ...patch, price: patch.price !== undefined ? Number(patch.price) : s.custom[i].price }
    save(s)
  },
  removeCustom(id: string) {
    const s = load()
    s.custom = s.custom.filter((x) => x.id !== id)
    save(s)
  },
  /** Price of an admin-added charge by name (0 when unknown). */
  customPrice(name: string): number {
    const hit = load().custom.find((x) => norm(x.name) === norm(name))
    return hit ? positive(hit.price) : 0
  },
}

/**
 * Make `price` on catalogue objects read from the rate master instead of a number written in the code.
 * Every screen that reads `item.price` keeps working and always sees the amount Administration entered.
 */
export function bindServicePrices<T extends { price?: number }>(items: T[], nameOf: (item: T) => string): T[] {
  for (const item of items) {
    try {
      Object.defineProperty(item, "price", {
        enumerable: true,
        configurable: true,
        get: () => PriceMaster.service(nameOf(item)),
        set: () => {
          /* amounts are set on Administration > Rates & Charges only */
        },
      })
    } catch {
      /* frozen object: leave as is */
    }
  }
  return items
}

if (typeof window !== "undefined") (window as any).PriceMaster = PriceMaster
