import "./shim"
import React from "react"
import { renderToString } from "react-dom/server"
import PatientExperience from "../src/components/PatientExperience"
import ClinicalRAG from "../src/components/ClinicalRAG"

let failed = 0
const results: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + detail))
}

const px = renderToString(<PatientExperience />)
check("Patient Experience draws real headings", /Average rating/.test(px) && /Responses received/.test(px))
check("Patient Experience shows no invented figures or sample reviews", !/450 surveys|Net Promoter|Dr\. Jenkins|G-9102|Lost Patient Belongings|Rude Staff/.test(px), "invented content is still on the screen")

const rag = renderToString(<ClinicalRAG />)
check("Clinical RAG asks for a patient first (no pre-selected stand-in patient)", /Choose a patient|Search a patient/.test(rag) && !/John Smith|948271/.test(rag), "a stand-in patient is shown")
check("Clinical RAG has no canned answer", !/138\/88|Cardiology Follow-up|Encounter #10482/.test(rag), "canned answer text is present")

console.log(results.join("\n"))
console.log(failed ? `${failed} FAILED` : "ALL AI SCREEN CHECKS PASSED")
process.exit(failed ? 1 : 0)
