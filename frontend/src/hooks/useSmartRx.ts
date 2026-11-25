import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  evaluatePrescription,
  medicationItems,
  requestSignature,
  type MedicationLine,
  type SmartRxOutcome,
  type SmartRxPatient,
} from "../services/smartrx"

export interface SmartRxState {
  status: "idle" | "loading" | "ready"
  outcome?: SmartRxOutcome
  /** The exact question the outcome answers. An outcome is only trusted for a prescription with the same signature. */
  signature?: string
}

/**
 * Runs the safety check as the prescription changes: debounced, one request in flight, and an answer for an older
 * prescription is never shown against a newer one.
 */
export function useSmartRx(patient: SmartRxPatient | null, medications: MedicationLine[], options: { enabled?: boolean; debounceMs?: number } = {}) {
  const { enabled = true, debounceMs = 800 } = options
  const [state, setState] = useState<SmartRxState>({ status: "idle" })
  const sequence = useRef(0)
  const signature = useMemo(() => (patient ? requestSignature(patient, medications) : ""), [patient, medications])
  const hasItems = !!patient && medicationItems(medications).length > 0

  const run = useCallback(
    async (target: SmartRxPatient, meds: MedicationLine[], sig: string): Promise<SmartRxOutcome> => {
      const mine = ++sequence.current
      setState((prev) => ({ ...prev, status: "loading" }))
      const outcome = await evaluatePrescription(target, meds)
      if (mine === sequence.current) setState({ status: "ready", outcome, signature: sig })
      return outcome
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !patient || !hasItems) {
      sequence.current++
      setState({ status: "idle" })
      return
    }
    setState((prev) => (prev.signature === signature && prev.status === "ready" ? prev : { ...prev, status: "loading" }))
    const timer = setTimeout(() => void run(patient, medications, signature), debounceMs)
    return () => clearTimeout(timer)
    // `signature` captures every input that matters; `patient`/`medications` are read from the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, hasItems, debounceMs])

  /** Check an exact prescription right now (used just before sending). Reuses a current answer instead of asking twice. */
  const evaluateNow = useCallback(
    async (target: SmartRxPatient, meds: MedicationLine[]): Promise<SmartRxOutcome | null> => {
      if (!medicationItems(meds).length) return null
      const sig = requestSignature(target, meds)
      if (state.status === "ready" && state.signature === sig && state.outcome) return state.outcome
      return run(target, meds, sig)
    },
    [run, state],
  )

  const isCurrent = state.status === "ready" && state.signature === signature
  return { state, isCurrent, evaluateNow, hasItems }
}
