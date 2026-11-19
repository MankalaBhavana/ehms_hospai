import { useEffect, useState } from "react"
import { IpCare, type IpCase } from "../../services/ipCare"

/**
 * Live in-patient cases. Opening a screen that uses this also reconciles the cases with the bed board, so a bed
 * allocated a moment ago is picked up (and its concern doctor told) without waiting for anyone to press anything.
 */
export function useIpCare(pollMs = 12000): { rev: number; cases: IpCase[]; unassigned: IpCase[] } {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const bump = () => setRev((n) => n + 1)
    IpCare.reconcile()
    const off = IpCare.subscribe(bump)
    window.addEventListener("storage", bump)
    const t = window.setInterval(() => {
      IpCare.reconcile()
      bump()
    }, pollMs)
    return () => {
      off()
      window.removeEventListener("storage", bump)
      window.clearInterval(t)
    }
  }, [pollMs])
  return { rev, cases: IpCare.activeCases(), unassigned: IpCare.unassigned() }
}
