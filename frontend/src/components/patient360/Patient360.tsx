import { useState } from "react"
import AnalyticsView from "./AnalyticsView"
import JourneysView from "./JourneysView"
import OverviewView from "./OverviewView"
import PatientWorkspace from "./PatientWorkspace"
import RegistryView from "./RegistryView"
import SegmentsView from "./SegmentsView"
import SurveysView from "./SurveysView"
import TasksView from "./TasksView"
import { Tabs } from "./ui"

type Tab = "overview" | "registry" | "tasks" | "journeys" | "surveys" | "segments" | "analytics"

/**
 * Patient 360°: a coordination layer over the existing HMS. It reads each source module live, links back to it, and
 * stores only coordination state (journeys, tasks, surveys, consent, segments). Sending messages and file-scoped
 * search stay in Patient Messages and PatientReach AI.
 */
export default function Patient360({ navigate }: { navigate: (module: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview")
  const [patientId, setPatientId] = useState<string | null>(null)

  const open = (id: string) => setPatientId(id)

  return (
    <div className="flex-1 overflow-y-auto bg-[#F0F2F5]">
      <div className="border-b border-[#DDE2EC] bg-white px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">Patient 360°</h1>
        <p className="text-[11.5px] text-[#64748B]">One patient identity, one connected timeline, one accountable follow-up workflow.</p>
      </div>
      <div className="space-y-4 p-6">
        {patientId ? (
          <PatientWorkspace patientId={patientId} onBack={() => setPatientId(null)} navigate={navigate} />
        ) : (
          <>
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "registry", label: "Patient registry" },
                { key: "tasks", label: "Tasks & escalations" },
                { key: "journeys", label: "Care journeys" },
                { key: "surveys", label: "Surveys" },
                { key: "segments", label: "Segments & AI query" },
                { key: "analytics", label: "Analytics" },
              ]}
            />
            {tab === "overview" && <OverviewView go={(t) => setTab(t as Tab)} onOpenPatient={open} />}
            {tab === "registry" && <RegistryView onOpenPatient={open} />}
            {tab === "tasks" && <TasksView onOpenPatient={open} />}
            {tab === "journeys" && <JourneysView onOpenPatient={open} />}
            {tab === "surveys" && <SurveysView onOpenPatient={open} />}
            {tab === "segments" && <SegmentsView onOpenPatient={open} navigate={navigate} />}
            {tab === "analytics" && <AnalyticsView />}
          </>
        )}
      </div>
    </div>
  )
}
