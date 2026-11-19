/**
 * Aadhaar number helpers for the registration desk. The number is validated here (12 digits, first digit 2-9, Verhoeff check
 * digit) so a mistyped digit is caught before anything is sent; it is never written to browser storage.
 */

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

function verhoeffOk(digits: string): boolean {
  let c = 0
  const rev = digits.split("").reverse()
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][Number(rev[i])]]
  return c === 0
}

/** Digits only, at most 12. */
export function aadhaarDigits(value: string): string {
  return (value || "").replace(/\D/g, "").slice(0, 12)
}

/** "123456789012" -> "1234 5678 9012" */
export function formatAadhaar(digits: string): string {
  return aadhaarDigits(digits).replace(/(\d{4})(?=\d)/g, "$1 ").trim()
}

export type AadhaarState = "empty" | "partial" | "invalid" | "valid"

export function aadhaarState(value: string): AadhaarState {
  const d = aadhaarDigits(value)
  if (!d) return "empty"
  if (d.length < 12) return "partial"
  return d[0] !== "0" && d[0] !== "1" && verhoeffOk(d) ? "valid" : "invalid"
}

export interface AadhaarMatch {
  patient_id: string
  name?: string
  middle_name?: string
  last_name?: string
  full_name: string
  age?: number | string | null
  gender?: string | null
  phone?: string | null
  dob?: string | null
  aadhar_masked?: string | null
  last_visit?: string | null
}
