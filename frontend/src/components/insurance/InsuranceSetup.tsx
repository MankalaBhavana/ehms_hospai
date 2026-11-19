import { useEffect, useState } from "react"
import { Settings2, Mail, ListChecks, BookOpen } from "lucide-react"
import InsuranceMastersPage from "./MastersPage"
import InsuranceMailSetup from "./InsuranceMailSetup"
import InsurancePlan from "./InsurancePlan"
import InsuranceGuide from "./InsuranceGuide"

export type SetupTab = "main" | "mail" | "plan" | "guide"
type MasterSection = "insurers" | "tpas" | "packages" | "pricing" | "docrules"

const TABS: { id: SetupTab; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "main", label: "Main setup", hint: "Insurers, TPAs, packages, pricing and document rules", icon: <Settings2 size={14} /> },
  { id: "mail", label: "Mail setup", hint: "Link the desk's email to send to insurers and receive replies", icon: <Mail size={14} /> },
  { id: "plan", label: "Step-by-step plan", hint: "The procedure, ticked from each patient's real records", icon: <ListChecks size={14} /> },
  { id: "guide", label: "How to use Insurance", hint: "A short guide to the module, in the order a claim moves", icon: <BookOpen size={14} /> },
]

/**
 * Insurance → Setup: everything an administrator or the desk lead configures or follows,
 * in one place: the masters, the mailbox, and the step-by-step plan.
 */
export default function InsuranceSetup({
  initialTab = "main",
  mastersSection = "insurers",
  initialCaseId,
  onNavigate,
}: {
  initialTab?: SetupTab
  mastersSection?: MasterSection
  initialCaseId?: string
  onNavigate?: (module: string, caseId?: string) => void
}) {
  const [tab, setTab] = useState<SetupTab>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])

  // Links that point at another tab of this page switch the tab; everything else leaves the page.
  const nav = (module: string, caseId?: string) => {
    if (module === "insurance_plan") return setTab("plan")
    if (module === "insurance_guide") return setTab("guide")
    if (module === "insurance_mail_setup") return setTab("mail")
    if (module === "insurance_masters" || module === "insurance_tpas" || module === "insurance_setup") return setTab("main")
    onNavigate?.(module, caseId)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-[#F8FAFC]">
      <div className="bg-white border-b border-slate-200/80 px-5 pt-3 flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Setup</h1>
          <span className="text-xs text-slate-500">Configure insurance once; follow the plan and the guide every day.</span>
        </div>
        <div role="tablist" className="flex gap-1 mt-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.hint}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "main" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <InsuranceMastersPage section={mastersSection} />
          </div>
        )}
        {tab === "mail" && <InsuranceMailSetup onNavigate={nav} />}
        {tab === "plan" && <InsurancePlan onNavigate={nav} initialCaseId={initialCaseId} />}
        {tab === "guide" && <InsuranceGuide onNavigate={nav} />}
      </div>
    </div>
  )
}
