/**
 * Dictation engines (the hospital server's Whisper, the browser's speech service) and the status of each. The text
 * clean-up itself lives in utils/dictationText.ts.
 */
import { apiFetch } from "../lib/api"
import { vocabulary } from "../utils/dictationText"

export { cleanDictation, appendDictation, correctTerms, registerVocabulary, vocabulary, jaroWinkler } from "../utils/dictationText"

// ── engines ──────────────────────────────────────────────────────────────────

export interface DictationLanguage {
  /** Browser speech service locale. */
  locale: string
  /** Whisper language code. */
  whisper: string
  label: string
}

export const DICTATION_LANGUAGES: DictationLanguage[] = [
  { locale: "en-IN", whisper: "en", label: "English (India)" },
  { locale: "hi-IN", whisper: "hi", label: "Hindi" },
  { locale: "te-IN", whisper: "te", label: "Telugu" },
  { locale: "ta-IN", whisper: "ta", label: "Tamil" },
  { locale: "kn-IN", whisper: "kn", label: "Kannada" },
  { locale: "ml-IN", whisper: "ml", label: "Malayalam" },
  { locale: "mr-IN", whisper: "mr", label: "Marathi" },
  { locale: "bn-IN", whisper: "bn", label: "Bengali" },
  { locale: "gu-IN", whisper: "gu", label: "Gujarati" },
  { locale: "en-US", whisper: "en", label: "English (US)" },
]

export interface EngineStatus {
  /** The hospital server can transcribe (Whisper installed and loadable). */
  server: boolean
  model?: string
  /** The browser has a speech recognition service. */
  browser: boolean
}

let statusCache: { at: number; value: EngineStatus } | null = null

export function browserRecognition(): (new () => any) | null {
  if (typeof window === "undefined") return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export async function engineStatus(force = false): Promise<EngineStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value
  let server = false
  let model: string | undefined
  try {
    const r = await apiFetch<{ available?: boolean; model?: string }>("/api/ai/transcribe/status")
    server = Boolean(r?.available)
    model = r?.model
  } catch {
    server = false
  }
  const value = { server, model, browser: Boolean(browserRecognition()) }
  statusCache = { at: Date.now(), value }
  return value
}

/** Terms handed to Whisper as a prompt so it spells the hospital's drug and test names right. */
export function serverPrompt(max = 480): string {
  const terms = [...vocabulary().values()]
  const head = "Clinical note. BP, SpO2, pulse, temperature, ECG, CBC, IV, TDS, BD, OD, SOS."
  let out = head
  for (const t of terms) {
    if ((out + ", " + t).length > max) break
    out += ", " + t
  }
  return out
}

/** Sends a recording to the hospital server for transcription (Whisper), with the hospital term list as a prompt. */
export async function transcribeBlob(blob: Blob, whisperLanguage: string): Promise<string> {
  const { API_BASE } = await import("../lib/constants")
  const { getCsrfToken, getHospitalCode } = await import("../lib/api")
  const formData = new FormData()
  formData.append("file", blob, "recording.webm")
  formData.append("language", whisperLanguage)
  formData.append("prompt", serverPrompt())
  const csrfToken = getCsrfToken()
  const response = await fetch(`${API_BASE}/api/ai/transcribe`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Hospital-Code": getHospitalCode(), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
    body: formData,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || "The recording could not be transcribed.")
  return String(payload.text || "")
}

const LANG_KEY = "hospai_dictation_lang"
export function savedDictationLanguage(): DictationLanguage {
  try {
    const code = localStorage.getItem(LANG_KEY)
    return DICTATION_LANGUAGES.find((l) => l.locale === code) || DICTATION_LANGUAGES[0]
  } catch {
    return DICTATION_LANGUAGES[0]
  }
}
export function saveDictationLanguage(locale: string) {
  try {
    localStorage.setItem(LANG_KEY, locale)
  } catch {
    /* a per-device convenience only */
  }
}
