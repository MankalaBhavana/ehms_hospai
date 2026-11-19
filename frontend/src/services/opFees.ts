import { PriceMaster } from "./priceMaster"
import { getDoctorConsultationFee } from "./doctorMaster"

/**
 * OP visit fees, always read from what Administration has set NOW (Rates & Charges for the registration fee,
 * Doctor Master for the consultation fee). A visit that has already been paid keeps the amount it was paid
 * at; every other visit (including patients already registered or in the queue) follows the current rates.
 */
interface EncounterLike {
  isNew?: boolean
  assignedDoctor?: string
  billing?: { registrationFee?: number; consultationFee?: number; status?: string } | null
}

const isPaid = (enc: EncounterLike) => enc.billing?.status === "Paid"

export function opRegistrationFee(enc: EncounterLike): number {
  if (isPaid(enc) && enc.billing?.registrationFee !== undefined) return Number(enc.billing.registrationFee) || 0
  return PriceMaster.registrationFee(enc.isNew !== false)
}

export function opConsultationFee(enc: EncounterLike): number {
  if (isPaid(enc) && enc.billing?.consultationFee !== undefined) return Number(enc.billing.consultationFee) || 0
  const live = enc.assignedDoctor ? getDoctorConsultationFee(enc.assignedDoctor) : 0
  return live > 0 ? live : Number(enc.billing?.consultationFee) || 0
}
