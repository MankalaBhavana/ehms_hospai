import React, { useMemo, useState } from "react"
import { Icon } from "./icons"
import { db } from "../services/db"
import { apiFetch } from "../lib/api"
import DictationInput from "./voice/DictationInput"

/**
 * Clinical RAG (search): ask a question about one patient's stored clinical documents and notes.
 *
 * Real retrieval, nothing staged: the question is embedded and matched against the patient's documents on the
 * server (/api/ai/patient-history-search). When the language model is available it writes a short answer from the
 * matches and cites them; when it is not (or nothing matched) the matching passages are shown as they are, and the
 * screen says so.
 */
interface Source {
  source_table: string
  source_id: number | string
  similarity: number
  excerpt: string
}

const SUGGESTIONS = [
  "What was the patient's blood pressure during the previous visit?",
  "Does the patient have a history of diabetes?",
  "What medications were prescribed during the last admission?",
  "Summarize the most recent imaging findings.",
]

export default function ClinicalRAG() {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [patientId, setPatientId] = useState("")
  const [find, setFind] = useState("")
  const [result, setResult] = useState<{ answer: string | null; sources: Source[] } | null>(null)

  const patients = useMemo(() => {
    const t = find.trim().toLowerCase()
    const all = db.getPatients()
    return (t ? all.filter((p) => `${p.name} ${p.umr} ${p.phone}`.toLowerCase().includes(t)) : all).slice(0, 8)
  }, [find])
  const patient = db.getPatientByUmr(patientId)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || !patientId) return
    setLoading(true)
    setResult(null)
    setError("")
    try {
      const res = await apiFetch<{ answer: string | null; sources: Source[] }>("/api/ai/patient-history-search", {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), patient_id: patientId, k: 6 }),
      })
      setResult({ answer: res?.answer ?? null, sources: Array.isArray(res?.sources) ? res.sources : [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "The search could not be completed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F0F2F5]">
      <div className="bg-white border-b border-[#DDE2EC] px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Clinical RAG (Search)</h1>
          <p className="text-[12.5px] text-[#64748B]">Ask a question about one patient&apos;s stored documents and notes. Answers cite the passages they come from.</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="w-full space-y-5 max-w-4xl">
          {/* patient */}
          <div className="bg-white border border-[#DDE2EC] p-4 space-y-2">
            <div className="text-[12px] font-bold uppercase tracking-wide text-[#64748B]">Patient</div>
            {patient ? (
              <div className="flex items-center justify-between">
                <div className="text-[14px]">
                  <strong>{patient.name}</strong> <span className="font-mono text-[#1B4FD8]">{patient.umr}</span> · {patient.age} yrs · {patient.sex}
                </div>
                <button type="button" className="text-[12px] text-[#1B4FD8] hover:underline cursor-pointer" onClick={() => { setPatientId(""); setResult(null) }}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search a patient by name, UMR or phone" className="w-full h-9 px-3 border border-[#CBD5E1] text-[13px] rounded-none focus:outline-none focus:border-[#1B4FD8]" />
                <div className="border border-[#E2E8F0] max-h-52 overflow-y-auto">
                  {patients.length === 0 && <div className="p-3 text-[12.5px] text-[#64748B]">No patient matches.</div>}
                  {patients.map((p) => (
                    <button key={p.umr} type="button" onClick={() => setPatientId(p.umr)} className="w-full text-left px-3 py-2 border-b border-[#F1F5F9] hover:bg-[#EFF6FF] text-[13px] cursor-pointer">
                      <strong>{p.name}</strong> <span className="font-mono text-[#1B4FD8]">{p.umr}</span> <span className="text-[#64748B]">· {p.age} yrs · {p.sex}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <form onSubmit={handleSearch} className="relative shadow-sm">
            <DictationInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!patientId}
              placeholder={patient ? `Ask a question about ${patient.name}'s medical history…` : "Choose a patient first"}
              className="w-full h-14 bg-white border border-[#DDE2EC] rounded-xl pl-5 pr-36 text-[14px] text-gray-900 focus:outline-none focus:border-[#1B4FD8] disabled:bg-[#F8FAFC]"
            />
            <div className="absolute right-2 top-2">
              <button type="submit" disabled={!query.trim() || !patientId || loading} className="h-10 px-4 bg-[#1B4FD8] hover:bg-[#1740B4] text-white text-[13px] font-medium rounded-lg disabled:opacity-50 cursor-pointer">
                Search Records
              </button>
            </div>
          </form>

          {!loading && !result && !error && (
            <div className="grid grid-cols-2 gap-4">
              {SUGGESTIONS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => setQuery(prompt)} className="text-left bg-white border border-[#DDE2EC] p-4 rounded-xl hover:border-[#1B4FD8] text-[13px] text-gray-600 cursor-pointer">
                  <div className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                    <Icon.Cmd /> Query suggestion
                  </div>
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="bg-white border border-[#DDE2EC] rounded-xl p-8 text-center shadow-sm">
              <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#1B4FD8] rounded-full animate-spin mx-auto mb-4" />
              <div className="text-[14px] font-semibold text-gray-900">Searching this patient&apos;s records…</div>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-800 text-[13px] px-4 py-3">{error}</div>}

          {result && !loading && (
            <div className="bg-white border border-[#DDE2EC] rounded-xl overflow-hidden shadow-sm">
              <div className="bg-[#F8FAFC] border-b border-[#DDE2EC] p-5">
                {result.answer ? (
                  <>
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#1B4FD8] mb-3 uppercase tracking-wider">
                      <Icon.TrendUp /> AI-written answer from the passages below
                    </div>
                    <p className="text-[15px] leading-relaxed text-gray-900 font-medium whitespace-pre-wrap">{result.answer}</p>
                  </>
                ) : result.sources.length ? (
                  <p className="text-[13.5px] text-[#92400E]">
                    The language model is not available, so no written answer was produced. The passages that match your question are listed below exactly as stored.
                  </p>
                ) : (
                  <p className="text-[13.5px] text-gray-700">Nothing in this patient&apos;s stored documents or notes matches that question (or the document index has not been built yet).</p>
                )}
              </div>
              {result.sources.length > 0 && (
                <div className="p-5">
                  <div className="text-[13px] font-semibold text-gray-900 mb-3 border-b border-[#F1F5F9] pb-2">Sources &amp; citations</div>
                  <div className="space-y-3">
                    {result.sources.map((src, idx) => (
                      <div key={idx} className="flex gap-4 p-3 rounded-lg border border-[#E2E8F0]">
                        <div className="w-8 h-8 rounded bg-[#F1F5F9] flex items-center justify-center flex-shrink-0 text-[#64748B] text-[11px] font-bold">{idx + 1}</div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[12.5px] font-semibold text-[#1B4FD8]">
                              {src.source_table} #{src.source_id}
                            </span>
                            <span className="text-[11px] text-[#94A3B8] font-mono">match {Math.round(src.similarity * 100)}%</span>
                          </div>
                          <div className="text-[12.5px] text-gray-800 bg-[#F1F5F9] p-2 rounded italic whitespace-pre-wrap">&quot;{src.excerpt}&quot;</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-[#FFFBEB] border-t border-[#FEF08A] p-3 text-[11px] text-[#B45309] text-center">
                <strong>Disclaimer:</strong> an AI-written answer is based only on the retrieved sources. Always verify important facts against the source record.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
