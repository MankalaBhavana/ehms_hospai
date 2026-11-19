import { useCallback, useEffect, useRef, useState } from "react"
import {
  DICTATION_LANGUAGES,
  browserRecognition,
  cleanDictation,
  engineStatus,
  saveDictationLanguage,
  savedDictationLanguage,
  transcribeBlob,
  type DictationLanguage,
} from "../../services/dictation"

/**
 * One microphone for every free-text box. Speech goes to the hospital server (Whisper, primed with the hospital's drug
 * and test names) when it is installed, otherwise to the browser's speech service. Either way the words are cleaned
 * into clinical shorthand (BP 120/80, 500 mg TDS ...) and handed to the box, which stays editable: the author reads
 * and corrects before saving.
 */
export function VoiceMic({
  onText,
  onInterim,
  onError,
  disabled,
  compact,
  className,
}: {
  /** A finished piece of dictated, cleaned text. */
  onText: (text: string) => void
  /** What is being heard right now (not final). */
  onInterim?: (text: string) => void
  /** When given, problems are reported here instead of being printed next to the button. */
  onError?: (message: string) => void
  disabled?: boolean
  compact?: boolean
  className?: string
}) {
  const [lang, setLang] = useState<DictationLanguage>(() => savedDictationLanguage())
  const [state, setState] = useState<"idle" | "starting" | "listening" | "transcribing">("idle")
  const [engine, setEngine] = useState<"server" | "browser" | null>(null)
  const [error, setErrorState] = useState("")
  const setError = (m: string) => {
    setErrorState(m)
    onErrorRef.current?.(m)
  }
  const activeRef = useRef(false)
  const recRef = useRef<any>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const onInterimRef = useRef(onInterim)
  onInterimRef.current = onInterim
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const finish = useCallback(() => {
    activeRef.current = false
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    try {
      recRef.current?.stop?.()
    } catch {
      /* already stopped */
    }
    try {
      if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop()
    } catch {
      /* already stopped */
    }
    onInterimRef.current?.("")
  }, [])

  useEffect(() => () => finish(), [finish])

  const startBrowser = () => {
    const Ctor = browserRecognition()
    if (!Ctor) {
      setError("Voice typing needs Chrome or Edge, or the hospital speech server. It is not available in this browser.")
      activeRef.current = false
      setState("idle")
      return
    }
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = lang.locale
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => {
      let interim = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const cleaned = cleanDictation(r[0].transcript)
          if (cleaned) onTextRef.current(cleaned)
        } else interim += r[0].transcript
      }
      onInterimRef.current?.(interim)
    }
    rec.onerror = (e: any) => {
      const code = String(e?.error || "")
      if (code === "no-speech" || code === "aborted") return // normal: keep listening
      activeRef.current = false
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "The microphone is blocked. Allow microphone access for this site and try again."
          : code === "network"
            ? "The browser speech service could not be reached (it needs internet). Type the note, or ask IT to enable the hospital speech server."
            : code === "audio-capture"
              ? "No microphone was found."
              : `Voice typing stopped (${code || "unknown error"}).`,
      )
    }
    rec.onend = () => {
      if (activeRef.current) {
        // the browser ends a session after a pause: carry on until the user presses Stop
        try {
          rec.start()
          return
        } catch {
          /* fall through to idle */
        }
      }
      onInterimRef.current?.("")
      setState("idle")
    }
    try {
      rec.start()
      setState("listening")
    } catch {
      activeRef.current = false
      setError("Could not start voice typing. Try again.")
      setState("idle")
    }
  }

  const startServer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const recorder = new MediaRecorder(stream)
      mediaRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size < 1500) {
          setState("idle")
          return
        }
        setState("transcribing")
        try {
          const text = cleanDictation(await transcribeBlob(blob, lang.whisper))
          if (text) onTextRef.current(text)
          else setError("Nothing could be understood in that recording.")
        } catch (e) {
          setError(e instanceof Error ? e.message : "The recording could not be transcribed.")
        }
        setState("idle")
      }
      recorder.start()
      setState("listening")
      // a dictation is a few sentences: stop by itself after five minutes
      timerRef.current = window.setTimeout(() => finish(), 5 * 60_000)
    } catch {
      activeRef.current = false
      setError("The microphone is blocked or missing. Allow microphone access for this site and try again.")
      setState("idle")
    }
  }

  const toggle = async () => {
    if (state === "listening" || state === "starting") {
      finish()
      return
    }
    if (state === "transcribing") return
    setError("")
    setState("starting")
    activeRef.current = true
    const [status] = await Promise.all([engineStatus(), import("../../services/dictationVocab").then((m) => m.loadHospitalVocabulary()).catch(() => undefined)])
    if (!activeRef.current) return
    if (status.server) {
      setEngine("server")
      await startServer()
    } else {
      setEngine("browser")
      startBrowser()
    }
  }

  const listening = state === "listening" || state === "starting"
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className || ""}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || state === "transcribing"}
        title={listening ? "Stop dictation" : "Dictate (speak the note; you can edit it before saving)"}
        aria-pressed={listening}
        className={`h-8 px-2.5 inline-flex items-center gap-1.5 text-[12px] font-bold border rounded-none cursor-pointer disabled:opacity-50 ${
          listening ? "bg-red-600 border-red-600 text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span aria-hidden className={listening ? "animate-pulse" : ""}>
          {listening ? "⏹" : "🎤"}
        </span>
        {state === "transcribing" ? "Transcribing…" : listening ? "Stop" : compact ? "" : "Dictate"}
      </button>
      {!compact && (
        <select
          value={lang.locale}
          onChange={(e) => {
            const l = DICTATION_LANGUAGES.find((x) => x.locale === e.target.value) || DICTATION_LANGUAGES[0]
            setLang(l)
            saveDictationLanguage(l.locale)
          }}
          disabled={listening || state === "transcribing"}
          className="h-8 px-1.5 text-[11.5px] border border-slate-300 bg-white rounded-none"
          title="Language you will speak"
        >
          {DICTATION_LANGUAGES.map((l) => (
            <option key={l.locale} value={l.locale}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {listening && engine && <span className="text-[11px] text-red-700 font-semibold">● Listening{engine === "browser" ? " (browser speech service)" : " (hospital server)"}</span>}
      {error && !onError && <span className="text-[11.5px] text-red-700">{error}</span>}
    </span>
  )
}

/** A text box with the microphone built in. What is dictated is appended; the box stays fully editable. */
export function VoiceTextarea({
  value,
  onChange,
  onVoiceUsed,
  rows = 4,
  placeholder,
  className,
  label,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  /** Called once the author has dictated into this box (so the saved note can carry a "dictated" mark). */
  onVoiceUsed?: () => void
  rows?: number
  placeholder?: string
  className?: string
  label?: string
  disabled?: boolean
}) {
  const [interim, setInterim] = useState("")
  const valueRef = useRef(value)
  valueRef.current = value
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        {label ? <span className="text-[11.5px] font-semibold text-slate-700">{label}</span> : <span />}
        <VoiceMic
          disabled={disabled}
          onInterim={setInterim}
          onText={(t) => {
            const cur = valueRef.current
            const next = !cur.trim() ? t : cur.endsWith("\n") ? cur + t : cur.replace(/\s+$/, "") + " " + t
            valueRef.current = next
            onChange(next)
            onVoiceUsed?.()
          }}
        />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-slate-300 px-2.5 py-2 text-[13px] rounded-none focus:outline-none focus:border-blue-700 bg-white"
      />
      {interim && <div className="text-[12px] text-slate-500 italic mt-0.5">Hearing: {interim}</div>}
    </div>
  )
}
