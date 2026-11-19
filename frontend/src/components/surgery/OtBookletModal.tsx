import React, { useState } from "react";
import DictationInput from "../voice/DictationInput"
import DictationTextarea from "../voice/DictationTextarea"
import { toast } from "react-hot-toast";
import { Btn } from "../shared";
import { SurgeryDatabase, SurgicalCase } from "../../services/surgeryDb";

interface OtBookletModalProps {
  activeCase: SurgicalCase;
  initialPage?: number;
  onClose: () => void;
  onOpenPatientRecord?: (patientId: string) => void;
  onStatusUpdate?: (caseId: string, newStatus: SurgicalCase["status"]) => void;
  onTransferToWard?: (c: SurgicalCase) => void;
  onTransferToIcu?: (c: SurgicalCase) => void;
}

export const OtBookletModal: React.FC<OtBookletModalProps> = ({
  activeCase,
  initialPage = 1,
  onClose,
  onOpenPatientRecord,
  onStatusUpdate,
  onTransferToWard,
  onTransferToIcu,
}) => {
  const [bookletActivePage, setBookletActivePage] = useState<number>(initialPage);
  const [bookletRoleFilter, setBookletRoleFilter] = useState<"all" | "ward" | "ot_nurse" | "pacu">("all");
  const [saveStatusMsg, setSaveStatusMsg] = useState<string | null>(null);

  // Complete, fully editable manual data model for all 14 pages of the OT Booklet
  const [bookletData, setBookletData] = useState({
    // Page 1: Demographics & Assignment
    patientName: activeCase.patientName || "",
    mrn: activeCase.mrn || "",
    ipNo: activeCase.ipNo || "IP-884920",
    age: activeCase.age || 40,
    gender: (activeCase.gender as any) || "Male",
    procedureName: activeCase.procedureName || "",
    specialty: activeCase.specialty || "General Surgery",
    orRoom: activeCase.orRoom || "OR Suite 1",
    surgeon: activeCase.surgeon || "",
    anesthesiologist: activeCase.anesthesiologist || "",
    urgency: (activeCase.urgency as any) || "Elective",

    // Page 2: PAC Assessment
    pacDiabetes: activeCase.pac?.history?.diabetes ?? false,
    pacHypertension: activeCase.pac?.history?.hypertension ?? true,
    pacIhd: activeCase.pac?.history?.ihd ?? false,
    pacAllergies: "None",
    pacHabits: "Nil",
    pacLastMeal: activeCase.pac?.history?.timeOfLastMeal || "10:00 PM (8h NPO)",
    mallampati: "Class I",
    asaGrade: "ASA II",
    thyromentalDistance: "> 6.5 cm",
    dentures: "None / Normal",
    anaesthesiaPlanned: "General Anaesthesia (GA)",
    labHb: "13.2 g/dL",
    labBloodGroup: "O Positive",
    labBloodSugar: "104 mg/dL",
    labCreatinine: "0.9 mg/dL",
    labEcg: "Normal Sinus",
    labCxr: "Clear Fields",
    labPtInr: "12.1s / 1.05",
    labEcho: "EF 62% Normal",

    // Page 3: Anaesthesia Plan
    planTechnique: activeCase.anaesthesiaPlan?.techniquePlanned || "General Anaesthesia with ETT",
    npoOrders: activeCase.anaesthesiaPlan?.npoInstructions || "Solids 8h, Clear Liquids 2h",
    premedication: activeCase.anaesthesiaPlan?.premedicationOrders || "Inj. Glycopyrrolate 0.2mg IV, Inj. Ondansetron 4mg IV",
    bloodProducts: activeCase.anaesthesiaPlan?.bloodProductsArranged || "2 Units PRBC Crossmatched in Blood Bank",
    specialMonitoring: activeCase.anaesthesiaPlan?.specialMonitoring || "ECG, SpO2, EtCO2, Invasive Arterial BP",
    siteMarked: activeCase.anaesthesiaPlan?.surgicalSiteMarked ?? true,
    npoVerifiedText: "10 Hours NPO - Verified",
    preOpVitals: "BP 124/82 · HR 74 bpm",
    planChange: "None",

    // Page 4 & 5: Surgery Consents
    surgeryConsentSigned: true,
    surgeryConsentWitness: true,
    surgeryConsentRisks: "Bleeding, infection, anesthesia complications, conversion to open procedure.",
    surgeryConsentTeluguNotes: "ఈ చికిత్స వల్ల కలుగు ప్రమాదములు మరియు ఫలితముల గూర్చి రోగికి మరియు బంధువులకు సమగ్రముగా వివరించబడినది.",

    // Page 6 & 7: Anaesthesia Consents
    anaesConsentSigned: true,
    anaesConsentVerified: true,
    anaesConsentRisks: "Sore throat, nausea, dental injury, allergic reactions, hemodynamic fluctuation.",
    anaesConsentTeluguNotes: "అనస్థీషియా మరియు నొప్పి నివారణ చికిత్సల గూర్చి పూర్తి వివరములు తెలియజేయబడినవి.",

    // Page 8: 21-Item Checklist
    chkBloodProducts: true,
    chkFinancialApproval: true,
    chkPacCompleted: true,
    chkPatientPrep: true,
    chkAnaesConsent: true,
    chkSurgeryConsent: true,
    chkHighRiskConsent: true,
    chkTransfusionConsent: true,
    chkAntibioticGiven: true,
    chkPrePrepForm: true,
    chkAnaesNotes: true,
    chkWhoSafetyList: true,
    chkOperationNotes: true,
    chkSurgeonNotes: true,
    chkMedicationChart: true,
    chkRecoveryEval: true,
    chkAnaesRecord: true,
    chkNurseHandover: true,
    chkQualityIndicators: true,
    chkPhotosVideos: true,
    chkRadiologyHandover: true,

    // Page 9: Pre-Preparation Form (17 Items)
    prepConsent: "Taken",
    prepGc: "Fair",
    prepBp: "124/80 mmHg",
    prepPulse: "76 bpm",
    prepTemp: "98.4 °F",
    prepIdTag: "Verified",
    prepWeight: "68 Kg",
    prepPremed: "Given",
    prepRylesTube: "N/A",
    prepEnema: "Given",
    prepLastMicturition: "06:30 AM",
    prepLastFeed: "10:00 PM",
    prepNailPolish: "Removed",
    prepDentures: "Removed",
    prepSitePrep: "Done",
    prepXrayReports: "Enclosed",
    prepLabReports: "Enclosed",
    prepHandoffBy: "RN Pham (Ward)",
    prepTakenOverBy: "RN Murphy (OT Nurse)",

    // Page 10: WHO 3-Phase
    whoSignIn: true,
    whoTimeOut: true,
    whoSignOut: true,
    whoSignInNotes: "Patient identity, site, procedure & consent confirmed. Machine & pulse oximeter checked.",
    whoTimeOutNotes: "All team members introduced. Confirm patient name, procedure & incision site. Antibiotic prophylaxis given within last 60 minutes.",
    whoSignOutNotes: "Nurse verbally confirms: Name of procedure recorded, instrument/sponge/needle counts correct, specimen labelled aloud.",

    // Page 11: Intra-op Record
    bp: "120/80",
    hr: 72,
    spo2: 99,
    etco2: 35,
    inductionDrugs: "Propofol 140mg IV + Fentanyl 100mcg IV + Atracurium 35mg IV",
    maintenanceDrugs: "Sevoflurane 2.0% in O2/Air",
    reversalDrugs: "Neostigmine 2.5mg + Glycopyrrolate 0.5mg IV · Smooth Extubation",

    // Page 12: Operation Record
    swabCount: true,
    needleCount: true,
    instrumentCount: true,
    bloodLossMl: 75,
    drainsCount: 1,
    suturesUsed: "Ethicon Vicryl 2-0, Monocryl 3-0",
    operativeFindings: "Procedure proceeded routinely. Gallbladder inflamed with multiple calculi. No bile duct injury.",
    preOpDiagnosis: "Symptomatic Cholelithiasis",
    postOpDiagnosis: "Chronic Calculous Cholecystitis",
    asstSurgeons: "Dr. Patel",
    skinPrep: "Betadine & Chlorhexidine",

    // Page 13: Operation Notes
    surgeonNotes: "Gallbladder dissected cleanly from hepatic bed. Cystic duct and artery double ligated with clips. Hemostasis achieved. Specimen retrieved in endo-bag and sent for histopathology.",
    postOpInstructions: "1. NPO for 4 hours. 2. Monitor vitals q15m x 1h then q30m x 2h. 3. Inj. Paracetamol 1g IV TDS for pain relief. 4. Inspect abdominal dressing for soakage.",
    surgeonSignature: activeCase.surgeon || "Attending Surgeon",

    // Page 14: Aldrete & Recovery
    aldreteActivity: 2,
    aldreteRespiration: 2,
    aldreteCirculation: 2,
    aldreteConsciousness: 2,
    aldreteO2Sat: 2,
    recoveryBp: "122/78",
    recoveryHr: 74,
    recoverySpo2: 99,
    pacuNotes: "Patient extubated, alert, following commands. Pain score VAS 2/10. Hemodynamically stable.",
    pacuNurse: "RN Miller",
  });

  const updateField = (field: string, value: any) => {
    setBookletData((prev: any) => ({ ...prev, [field]: value }));
  };

  const calculateTotalAldrete = () => {
    return (
      bookletData.aldreteActivity +
      bookletData.aldreteRespiration +
      bookletData.aldreteCirculation +
      bookletData.aldreteConsciousness +
      bookletData.aldreteO2Sat
    );
  };

  const handleUpdateStatus = async (caseId: string, newStatus: SurgicalCase["status"]) => {
    try {
      await SurgeryDatabase.updateCaseStatus(caseId, newStatus);
      if (onStatusUpdate) onStatusUpdate(caseId, newStatus);
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const saveBookletProgress = async () => {
    try {
      await SurgeryDatabase.saveFullBooklet(activeCase.id, {
        procedureName: bookletData.procedureName,
        surgeon: bookletData.surgeon,
        anesthesiologist: bookletData.anesthesiologist,
        orRoom: bookletData.orRoom,
        specialty: bookletData.specialty,
        urgency: bookletData.urgency,
        operationRecord: {
          surgeonPreparedInOr: bookletData.surgeon,
          preOpDiagnosis: bookletData.preOpDiagnosis,
          postOpDiagnosis: bookletData.postOpDiagnosis,
          procedureProposed: bookletData.procedureName,
          procedureExecuted: bookletData.procedureName,
          asstSurgeons: [bookletData.asstSurgeons],
          skinPreparation: bookletData.skinPrep,
          histopathologySent: true,
          photosVideosRecorded: true,
          swabCountCorrect: bookletData.swabCount,
          instrumentCountCorrect: bookletData.instrumentCount,
          suturesUsed: bookletData.suturesUsed,
          drainageCount: bookletData.drainsCount,
          bloodLossMl: bookletData.bloodLossMl,
          surgeryStartTime: "08:30 AM",
          surgeryEndTime: "10:15 AM",
          operatingTimeMins: 105,
          complications: "None",
          surgeonProcedureNotes: bookletData.surgeonNotes,
          postOpInstructions: bookletData.postOpInstructions,
          surgeonSignature: bookletData.surgeonSignature,
        },
      });
      setSaveStatusMsg("Booklet data manually updated & saved to clinical record!");
      toast.success("OT Booklet progress successfully saved!");
      setTimeout(() => setSaveStatusMsg(null), 3000);
    } catch (err) {
      console.error("Failed to save booklet progress:", err);
      toast.error("Failed to save booklet progress.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 md:p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col border border-[#DDE2EC] overflow-hidden">
        {/* Modal Header */}
        <div className="bg-[#1E3A6E] text-white px-5 py-3 flex items-center justify-between border-b border-slate-700 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold text-xs tracking-wider shadow-2xs border border-white/20 font-mono">
              OT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white tracking-wide">
                  Imperial Hospitals · Digital OT Booklet
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                  Fully Editable Manual Mode
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-mono">
                Patient: <strong className="text-white">{bookletData.patientName}</strong> ({bookletData.age}y/{bookletData.gender}) · UMR: <strong className="text-white">{bookletData.mrn}</strong> · IP: <strong className="text-white">{bookletData.ipNo}</strong> · {bookletData.orRoom}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1 text-xs text-slate-200 bg-white/10 px-2.5 py-1 rounded-lg border border-white/15">
              <span className="text-slate-300 text-[10.5px] mr-1">Role Filter:</span>
              <button
                type="button"
                onClick={() => setBookletRoleFilter("all")}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${bookletRoleFilter === "all" ? "bg-white text-[#1E3A6E]" : "hover:bg-white/10 text-slate-200"}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => { setBookletRoleFilter("ward"); setBookletActivePage(1); }}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${bookletRoleFilter === "ward" ? "bg-white text-[#1E3A6E]" : "hover:bg-white/10 text-slate-200"}`}
              >
                Ward
              </button>
              <button
                type="button"
                onClick={() => { setBookletRoleFilter("ot_nurse"); setBookletActivePage(8); }}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${bookletRoleFilter === "ot_nurse" ? "bg-white text-[#1E3A6E]" : "hover:bg-white/10 text-slate-200"}`}
              >
                OT Nurse
              </button>
              <button
                type="button"
                onClick={() => { setBookletRoleFilter("pacu"); setBookletActivePage(14); }}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${bookletRoleFilter === "pacu" ? "bg-white text-[#1E3A6E]" : "hover:bg-white/10 text-slate-200"}`}
              >
                PACU
              </button>
            </div>
            {onOpenPatientRecord && (
              <button
                type="button"
                onClick={() => onOpenPatientRecord(activeCase.patientId)}
                className="hidden md:flex items-center gap-1 text-[11px] bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded border border-white/20 cursor-pointer font-medium"
              >
                Clinical Chart ➔
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white text-lg font-bold w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body: Left Page Navigator + Right Document Canvas */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Index Nav */}
          <div className="w-64 bg-[#F8FAFC] border-r border-[#DDE2EC] flex flex-col justify-between shrink-0 overflow-y-auto">
            <div className="p-3 space-y-3">
              {/* Category 1: Ward & PAC */}
              <div>
                <div className="px-2.5 py-1 bg-slate-200/70 text-slate-700 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between rounded-md">
                  <span>I. Ward &amp; PAC Intake</span>
                  <span className="text-[9px] bg-slate-300/80 px-1.5 py-0.2 rounded font-semibold">8 Pages</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {[
                    { num: 1, title: "Cover & Demographics", tag: "Ward", icon: "✓" },
                    { num: 2, title: "PAC Assessment", tag: "PAC", icon: "✓" },
                    { num: 3, title: "Anaesthesia Plan", tag: "PAC", icon: "✓" },
                    { num: 4, title: "Surgery Consent (En)", tag: "Ward", icon: "✓" },
                    { num: 5, title: "Surgery Consent (Te)", tag: "Ward", icon: "✓" },
                    { num: 6, title: "Anaes Consent (En)", tag: "Ward", icon: "✓" },
                    { num: 7, title: "Anaes Consent (Te)", tag: "Ward", icon: "✓" },
                    { num: 9, title: "Pre-Prep 17-Item Form", tag: "Ward", icon: "✓" },
                  ].map((p) => (
                    <button
                      key={p.num}
                      type="button"
                      onClick={() => setBookletActivePage(p.num)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11.5px] transition-all cursor-pointer ${
                        bookletActivePage === p.num
                          ? "bg-[#1B4FD8] text-white font-semibold shadow-xs"
                          : "hover:bg-slate-200/70 text-slate-700 font-medium"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`text-[10px] font-mono px-1 rounded ${bookletActivePage === p.num ? "bg-white/20 text-white font-bold" : "bg-slate-200 text-slate-600"}`}>
                          P{p.num < 10 ? `0${p.num}` : p.num}
                        </span>
                        <span className="truncate">{p.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold ml-1 ${bookletActivePage === p.num ? "text-white" : "text-emerald-600"}`}>{p.icon}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category 2: OT Intra-Op Suite */}
              <div>
                <div className="px-2.5 py-1 bg-amber-50 text-amber-900 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between border-y border-amber-100 rounded-md">
                  <span>II. OT Intra-Op Suite</span>
                  <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold border border-amber-200">5 Pages</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {[
                    { num: 8, title: "Master 21-Checklist", tag: "OT Nurse", icon: "⚡" },
                    { num: 10, title: "WHO 3-Phase Safety", tag: "OT Nurse", icon: "⚡" },
                    { num: 11, title: "Anaesthesia Intra-Op", tag: "Anaesthetist", icon: "⚡" },
                    { num: 12, title: "Operation Record", tag: "Surgeon", icon: "⚡" },
                    { num: 13, title: "Operation Notes", tag: "Surgeon", icon: "⚡" },
                  ].map((p) => (
                    <button
                      key={p.num}
                      type="button"
                      onClick={() => setBookletActivePage(p.num)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11.5px] transition-all cursor-pointer ${
                        bookletActivePage === p.num
                          ? "bg-[#1B4FD8] text-white font-semibold shadow-xs"
                          : "hover:bg-slate-200/70 text-slate-700 font-medium"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`text-[10px] font-mono px-1 rounded ${bookletActivePage === p.num ? "bg-white/20 text-white font-bold" : "bg-slate-200 text-slate-600"}`}>
                          P{p.num < 10 ? `0${p.num}` : p.num}
                        </span>
                        <span className="truncate">{p.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold ml-1 ${bookletActivePage === p.num ? "text-white" : "text-amber-600"}`}>{p.icon}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category 3: PACU Recovery */}
              <div>
                <div className="px-2.5 py-1 bg-emerald-50 text-emerald-900 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between border-y border-emerald-100 rounded-md">
                  <span>III. PACU Recovery</span>
                  <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-semibold border border-emerald-200">1 Page</span>
                </div>
                <div className="mt-1">
                  {[
                    { num: 14, title: "Aldrete & Ward Transfer", tag: "PACU", icon: "🏥" },
                  ].map((p) => (
                    <button
                      key={p.num}
                      type="button"
                      onClick={() => setBookletActivePage(p.num)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11.5px] transition-all cursor-pointer ${
                        bookletActivePage === p.num
                          ? "bg-[#1B4FD8] text-white font-semibold shadow-xs"
                          : "hover:bg-slate-200/70 text-slate-700 font-medium"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`text-[10px] font-mono px-1 rounded ${bookletActivePage === p.num ? "bg-white/20 text-white font-bold" : "bg-[#F8FAFC] text-slate-600"}`}>
                          P{p.num}
                        </span>
                        <span className="truncate">{p.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold ml-1 ${bookletActivePage === p.num ? "text-white" : "text-blue-600"}`}>{p.icon}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3 border-t border-[#DDE2EC] text-[10.5px] text-slate-600 bg-[#E2E8F0]/40 space-y-1">
              <div className="flex justify-between">
                <span>Mode:</span>
                <span className="text-emerald-700 font-bold">✎ Manual Edit Active</span>
              </div>
              <div className="flex justify-between">
                <span>Audit Trail:</span>
                <span className="font-mono text-slate-800 font-semibold">#OT-2026-LIVE</span>
              </div>
            </div>
          </div>

          {/* Right Document Canvas */}
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-5 md:p-6 bg-[#F8FAFC]">
            <div className="bg-white rounded-lg border border-[#DDE2EC] shadow-xs p-6 space-y-5 max-w-3xl mx-auto min-h-[500px]">
              
              {/* Page Header Letterhead */}
              <div className="border-b border-[#DDE2EC] pb-4 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>IMPERIAL HOSPITALS</span>
                    <span className="text-[10px] font-normal text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      Bhimavaram · Andhra Pradesh
                    </span>
                  </h2>
                  <p className="text-[11px] text-[#64748B]">
                    Department of Surgical Services &amp; Anesthesiology
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-slate-800 font-mono">
                    OT BOOKLET PAGE {bookletActivePage} OF 14
                  </div>
                  <div className="text-[10px] text-[#64748B] font-mono">
                    FORM ID: IH-OT-2026-P{bookletActivePage < 10 ? `0${bookletActivePage}` : bookletActivePage}
                  </div>
                </div>
              </div>

              {/* Departmental Data Source Banner */}
              <div className="bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg px-3.5 py-2 flex items-center justify-between text-xs mb-3 shadow-2xs">
                <div className="flex items-center gap-2 truncate">
                  <span className="px-2.5 py-0.5 rounded-md font-semibold text-[10px] uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200">
                    Live Editable Form: Page {bookletActivePage}
                  </span>
                  <span className="text-slate-500 text-[11px]">Click any field to edit manually</span>
                </div>
                <button
                  type="button"
                  onClick={saveBookletProgress}
                  className="text-[11px] font-semibold text-[#1E3A6E] hover:bg-[#F1F5F9] bg-white px-2.5 py-1 rounded-md border border-[#DDE2EC] cursor-pointer flex items-center gap-1 shadow-2xs transition-colors"
                >
                  💾 Save Page Data
                </button>
              </div>

              {/* PAGE 1: COVER & DEMOGRAPHICS */}
              {bookletActivePage === 1 && (
                <div className="space-y-4">
                  <div className="bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg p-4 text-center space-y-1">
                    <div className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                      Official Medical Record
                    </div>
                    <h3 className="text-base font-bold text-slate-900">
                      OPERATION THEATRE CLINICAL BOOKLET
                    </h3>
                    <p className="text-[11px] text-slate-600">
                      Comprehensive Pre-Operative, Intra-Operative &amp; Recovery Documentation (Manual Edit Enabled)
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="bg-[#F8FAFC] p-2.5 rounded border border-[#DDE2EC]">
                      <label className="text-[#64748B] text-[11px] block font-semibold mb-1">Patient Name</label>
                      <input
                        type="text"
                        value={bookletData.patientName}
                        onChange={(e) => updateField("patientName", e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 bg-white text-slate-900 font-semibold"
                      />
                    </div>
                    <div className="bg-[#F8FAFC] p-2.5 rounded border border-[#DDE2EC]">
                      <label className="text-[#64748B] text-[11px] block font-semibold mb-1">UMR / MRN</label>
                      <input
                        type="text"
                        value={bookletData.mrn}
                        onChange={(e) => updateField("mrn", e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 bg-white font-mono text-slate-900"
                      />
                    </div>
                    <div className="bg-[#F8FAFC] p-2.5 rounded border border-[#DDE2EC]">
                      <label className="text-[#64748B] text-[11px] block font-semibold mb-1">IP Number</label>
                      <input
                        type="text"
                        value={bookletData.ipNo}
                        onChange={(e) => updateField("ipNo", e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 bg-white font-mono text-slate-900"
                      />
                    </div>
                    <div className="bg-[#F8FAFC] p-2.5 rounded border border-[#DDE2EC]">
                      <label className="text-[#64748B] text-[11px] block font-semibold mb-1">Age &amp; Gender</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          value={bookletData.age}
                          onChange={(e) => updateField("age", parseInt(e.target.value) || 0)}
                          className="w-16 border border-slate-300 rounded px-1.5 py-1 bg-white text-slate-900"
                        />
                        <select
                          value={bookletData.gender}
                          onChange={(e) => updateField("gender", e.target.value)}
                          className="flex-1 border border-slate-300 rounded px-1 py-1 bg-white text-slate-900 text-xs"
                        >
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
                    <h4 className="font-semibold text-slate-800 text-xs border-b border-slate-200 pb-1">Surgical Assignment Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-800">
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Proposed Surgery:</label>
                        <input
                          type="text"
                          value={bookletData.procedureName}
                          onChange={(e) => updateField("procedureName", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white font-medium text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Specialty:</label>
                        <input
                          type="text"
                          value={bookletData.specialty}
                          onChange={(e) => updateField("specialty", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Assigned Suite:</label>
                        <input
                          type="text"
                          value={bookletData.orRoom}
                          onChange={(e) => updateField("orRoom", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Case Urgency:</label>
                        <select
                          value={bookletData.urgency}
                          onChange={(e) => updateField("urgency", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white font-bold text-xs"
                        >
                          <option value="Elective">Elective</option>
                          <option value="Urgent">Urgent</option>
                          <option value="Emergency STAT">Emergency STAT</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Primary Surgeon:</label>
                        <input
                          type="text"
                          value={bookletData.surgeon}
                          onChange={(e) => updateField("surgeon", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-900 font-semibold text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block text-[11px] font-semibold mb-0.5">Anesthesiologist:</label>
                        <input
                          type="text"
                          value={bookletData.anesthesiologist}
                          onChange={(e) => updateField("anesthesiologist", e.target.value)}
                          className="w-full border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-900 font-semibold text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 2: PAC ASSESSMENT */}
              {bookletActivePage === 2 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 2: Pre-Anaesthetic Assessment (PAC)
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      ✓ Cleared by PAC Consultant
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-2">
                      <h4 className="font-semibold text-slate-900 border-b border-[#DDE2EC] pb-1">A. Medical History &amp; Habits</h4>
                      <div className="space-y-2 text-slate-700">
                        <div className="flex justify-between items-center">
                          <span>Diabetes Mellitus:</span>
                          <select
                            value={bookletData.pacDiabetes ? "Yes" : "No"}
                            onChange={(e) => updateField("pacDiabetes", e.target.value === "Yes")}
                            className="border border-slate-300 rounded px-2 py-0.5 bg-white font-medium"
                          >
                            <option value="No">No</option>
                            <option value="Yes">Yes</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Hypertension:</span>
                          <select
                            value={bookletData.pacHypertension ? "Yes" : "No"}
                            onChange={(e) => updateField("pacHypertension", e.target.value === "Yes")}
                            className="border border-slate-300 rounded px-2 py-0.5 bg-white font-medium"
                          >
                            <option value="Yes">Yes (Controlled)</option>
                            <option value="No">No</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Ischaemic Heart Disease:</span>
                          <select
                            value={bookletData.pacIhd ? "Yes" : "No"}
                            onChange={(e) => updateField("pacIhd", e.target.value === "Yes")}
                            className="border border-slate-300 rounded px-2 py-0.5 bg-white font-medium"
                          >
                            <option value="No">No</option>
                            <option value="Yes">Yes</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Known Drug Allergies:</span>
                          <DictationInput
                            type="text"
                            value={bookletData.pacAllergies}
                            onChange={(e) => updateField("pacAllergies", e.target.value)}
                            className="w-32 border border-slate-300 rounded px-2 py-0.5 bg-white"
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Habits (Smoking / Alcohol):</span>
                          <input
                            type="text"
                            value={bookletData.pacHabits}
                            onChange={(e) => updateField("pacHabits", e.target.value)}
                            className="w-32 border border-slate-300 rounded px-2 py-0.5 bg-white"
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Time of Last Meal:</span>
                          <input
                            type="text"
                            value={bookletData.pacLastMeal}
                            onChange={(e) => updateField("pacLastMeal", e.target.value)}
                            className="w-36 border border-slate-300 rounded px-2 py-0.5 bg-white font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-2">
                      <h4 className="font-semibold text-slate-900 border-b border-[#DDE2EC] pb-1">B. Airway &amp; ASA Grade</h4>
                      <div className="space-y-2 text-slate-700">
                        <div className="flex justify-between items-center">
                          <span>Mallampati Score:</span>
                          <select
                            value={bookletData.mallampati}
                            onChange={(e) => updateField("mallampati", e.target.value)}
                            className="border border-slate-300 rounded px-2 py-0.5 bg-white font-medium"
                          >
                            <option value="Class I">Class I</option>
                            <option value="Class II">Class II</option>
                            <option value="Class III">Class III</option>
                            <option value="Class IV">Class IV</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>ASA Physical Status:</span>
                          <select
                            value={bookletData.asaGrade}
                            onChange={(e) => updateField("asaGrade", e.target.value)}
                            className="border border-slate-300 rounded px-2 py-0.5 bg-white font-medium"
                          >
                            <option value="ASA I">ASA I</option>
                            <option value="ASA II">ASA II</option>
                            <option value="ASA III">ASA III</option>
                            <option value="ASA IV">ASA IV</option>
                            <option value="ASA E">ASA E</option>
                          </select>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Thyromental Distance:</span>
                          <input
                            type="text"
                            value={bookletData.thyromentalDistance}
                            onChange={(e) => updateField("thyromentalDistance", e.target.value)}
                            className="w-28 border border-slate-300 rounded px-2 py-0.5 bg-white"
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Dentures / Loose Teeth:</span>
                          <input
                            type="text"
                            value={bookletData.dentures}
                            onChange={(e) => updateField("dentures", e.target.value)}
                            className="w-32 border border-slate-300 rounded px-2 py-0.5 bg-white"
                          />
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Anaesthesia Planned:</span>
                          <input
                            type="text"
                            value={bookletData.anaesthesiaPlanned}
                            onChange={(e) => updateField("anaesthesiaPlanned", e.target.value)}
                            className="w-44 border border-slate-300 rounded px-2 py-0.5 bg-white font-medium text-slate-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-2 text-xs">
                    <h4 className="font-semibold text-slate-900 border-b border-[#DDE2EC] pb-1">C. Laboratory &amp; Diagnostic Investigations</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[#64748B] text-[11px] block">Hb%</label>
                        <input type="text" value={bookletData.labHb} onChange={(e) => updateField("labHb", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">Blood Group</label>
                        <input type="text" value={bookletData.labBloodGroup} onChange={(e) => updateField("labBloodGroup", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">Bl. Sugar</label>
                        <input type="text" value={bookletData.labBloodSugar} onChange={(e) => updateField("labBloodSugar", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">S. Creatinine</label>
                        <input type="text" value={bookletData.labCreatinine} onChange={(e) => updateField("labCreatinine", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">ECG</label>
                        <input type="text" value={bookletData.labEcg} onChange={(e) => updateField("labEcg", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">Chest X-Ray</label>
                        <input type="text" value={bookletData.labCxr} onChange={(e) => updateField("labCxr", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">PT / INR</label>
                        <input type="text" value={bookletData.labPtInr} onChange={(e) => updateField("labPtInr", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="text-[#64748B] text-[11px] block">2D Echo</label>
                        <input type="text" value={bookletData.labEcho} onChange={(e) => updateField("labEcho", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 3: ANAESTHESIA PLAN */}
              {bookletActivePage === 3 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 3: Anaesthesia Plan &amp; Immediate Pre-Op Re-Evaluation
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      Verified by Anaesthesiologist
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-3 text-xs">
                    <h4 className="font-semibold text-slate-900 border-b border-[#DDE2EC] pb-1">Preoperative Instructions &amp; Orders</h4>
                    <div className="space-y-2.5 text-slate-800">
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Planned Technique:</label>
                        <input type="text" value={bookletData.planTechnique} onChange={(e) => updateField("planTechnique", e.target.value)} className="w-full border rounded px-2.5 py-1 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">NPO Orders:</label>
                        <input type="text" value={bookletData.npoOrders} onChange={(e) => updateField("npoOrders", e.target.value)} className="w-full border rounded px-2.5 py-1 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Premedication:</label>
                        <input type="text" value={bookletData.premedication} onChange={(e) => updateField("premedication", e.target.value)} className="w-full border rounded px-2.5 py-1 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Blood Products:</label>
                        <input type="text" value={bookletData.bloodProducts} onChange={(e) => updateField("bloodProducts", e.target.value)} className="w-full border rounded px-2.5 py-1 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Special Monitoring:</label>
                        <input type="text" value={bookletData.specialMonitoring} onChange={(e) => updateField("specialMonitoring", e.target.value)} className="w-full border rounded px-2.5 py-1 bg-white" />
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
                    <h4 className="font-semibold text-slate-800 border-b border-slate-200 pb-1">Immediate Preoperative Re-Evaluation (Ward to OT Handoff)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-800">
                      <label className="flex items-center gap-2 p-2 bg-white rounded border border-slate-200 cursor-pointer font-semibold">
                        <input type="checkbox" checked={bookletData.siteMarked} onChange={(e) => updateField("siteMarked", e.target.checked)} className="rounded text-blue-600" />
                        <span>Surgical Site Marked &amp; Identified</span>
                      </label>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">NPO Status Re-Verified:</label>
                        <input type="text" value={bookletData.npoVerifiedText} onChange={(e) => updateField("npoVerifiedText", e.target.value)} className="w-full border rounded px-2 py-1 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Pre-Op Re-Eval Vitals:</label>
                        <input type="text" value={bookletData.preOpVitals} onChange={(e) => updateField("preOpVitals", e.target.value)} className="w-full border rounded px-2 py-1 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-semibold mb-0.5">Change of Plan Required:</label>
                        <input type="text" value={bookletData.planChange} onChange={(e) => updateField("planChange", e.target.value)} className="w-full border rounded px-2 py-1 bg-white" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 4 & 5: SURGERY CONSENTS */}
              {(bookletActivePage === 4 || bookletActivePage === 5) && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page {bookletActivePage}: Informed Consent for Surgery {bookletActivePage === 5 ? "(శస్త్ర చికిత్స అంగీకార పత్రము - Telugu)" : "(English)"}
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      ✓ Legally Signed &amp; Sealed
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-3 text-xs text-slate-800">
                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">
                        {bookletActivePage === 4 ? "Authorisation of Patient / Representative Statement:" : "రోగి / ప్రతినిధి అంగీకార వాక్యము:"}
                      </label>
                      <DictationTextarea
                        rows={3}
                        value={bookletActivePage === 4
                          ? `I hereby authorize the performance of the surgery / procedure "${bookletData.procedureName}" under Dr. ${bookletData.surgeon}. I have been made aware of the potential risks and willfully grant consent.`
                          : bookletData.surgeryConsentTeluguNotes}
                        onChange={(e) => {
                          if (bookletActivePage === 5) updateField("surgeryConsentTeluguNotes", e.target.value);
                        }}
                        className="w-full border border-slate-300 rounded p-2.5 bg-white text-xs leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">Documented Risks &amp; Complications Explained:</label>
                      <input
                        type="text"
                        value={bookletData.surgeryConsentRisks}
                        onChange={(e) => updateField("surgeryConsentRisks", e.target.value)}
                        className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs"
                      />
                    </div>

                    <div className="pt-3 border-t border-[#DDE2EC] grid grid-cols-3 gap-3 text-center">
                      <label className="p-2 bg-white rounded border border-[#DDE2EC] cursor-pointer block">
                        <div className="text-[10px] text-slate-500">Patient / Relative</div>
                        <div className="flex items-center justify-center gap-1.5 mt-1 font-bold text-xs text-emerald-700">
                          <input type="checkbox" checked={bookletData.surgeryConsentSigned} onChange={(e) => updateField("surgeryConsentSigned", e.target.checked)} />
                          <span>✓ Signed</span>
                        </div>
                      </label>
                      <label className="p-2 bg-white rounded border border-[#DDE2EC] cursor-pointer block">
                        <div className="text-[10px] text-slate-500">Witness</div>
                        <div className="flex items-center justify-center gap-1.5 mt-1 font-bold text-xs text-emerald-700">
                          <input type="checkbox" checked={bookletData.surgeryConsentWitness} onChange={(e) => updateField("surgeryConsentWitness", e.target.checked)} />
                          <span>✓ Verified</span>
                        </div>
                      </label>
                      <div className="p-2 bg-white rounded border border-[#DDE2EC]">
                        <div className="text-[10px] text-slate-500">Lead Surgeon</div>
                        <input
                          type="text"
                          value={bookletData.surgeon}
                          onChange={(e) => updateField("surgeon", e.target.value)}
                          className="w-full text-center border-0 border-b border-slate-300 text-xs font-bold mt-0.5 bg-transparent"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 6 & 7: ANAESTHESIA CONSENTS */}
              {(bookletActivePage === 6 || bookletActivePage === 7) && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page {bookletActivePage}: Consent for Anaesthesia &amp; Analgesia {bookletActivePage === 7 ? "(అనస్థీషియా అంగీకార పత్రము - Telugu)" : "(English)"}
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      ✓ Signed &amp; Verified
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-3 text-xs text-slate-800">
                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">
                        {bookletActivePage === 6 ? "Anaesthesia & Analgesia Administration Consent Statement:" : "అనస్థీషియా చికిత్స అంగీకార వాక్యము:"}
                      </label>
                      <DictationTextarea
                        rows={3}
                        value={bookletActivePage === 6
                          ? `I give consent for General / Regional Anaesthesia and Post-Operative Analgesia to be administered by Dr. ${bookletData.anesthesiologist}. Potential risks including sore throat, nausea, and intravascular monitoring lines have been discussed.`
                          : bookletData.anaesConsentTeluguNotes}
                        onChange={(e) => {
                          if (bookletActivePage === 7) updateField("anaesConsentTeluguNotes", e.target.value);
                        }}
                        className="w-full border border-slate-300 rounded p-2.5 bg-white text-xs leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">Potential Risks Discussed:</label>
                      <input
                        type="text"
                        value={bookletData.anaesConsentRisks}
                        onChange={(e) => updateField("anaesConsentRisks", e.target.value)}
                        className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs"
                      />
                    </div>

                    <div className="pt-3 border-t border-[#DDE2EC] flex justify-between items-center text-xs font-semibold text-slate-700">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={bookletData.anaesConsentSigned} onChange={(e) => updateField("anaesConsentSigned", e.target.checked)} />
                        <span>✓ Patient Consent Confirmed</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={bookletData.anaesConsentVerified} onChange={(e) => updateField("anaesConsentVerified", e.target.checked)} />
                        <span>✓ Dr. {bookletData.anesthesiologist} Signature Verified</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 8: MASTER 21-ITEM CHECKLIST */}
              {bookletActivePage === 8 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 8: Check List for Surgery Patients (Master 21-Item Checklist)
                    </h3>
                    <span className="text-[10.5px] font-semibold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                      Live OT Nurse Verification
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-1.5">
                      <h4 className="font-bold text-slate-900 text-[11px] border-b border-[#DDE2EC] pb-1">Pre-Operative (1-10)</h4>
                      <div className="space-y-1 text-slate-700 text-[11px]">
                        {[
                          { key: "chkBloodProducts", label: "1. Blood Products" },
                          { key: "chkFinancialApproval", label: "2. Financial Approval" },
                          { key: "chkPacCompleted", label: "3. PAC Completed" },
                          { key: "chkPatientPrep", label: "4. Patient Prep" },
                          { key: "chkAnaesConsent", label: "5. Anaesthesia Consent" },
                          { key: "chkSurgeryConsent", label: "6. Surgery Consent" },
                          { key: "chkHighRiskConsent", label: "7. High Risk Consent" },
                          { key: "chkTransfusionConsent", label: "8. Transfusion Consent" },
                          { key: "chkAntibioticGiven", label: "9. Antibiotic Given" },
                          { key: "chkPrePrepForm", label: "10. Pre-Prep Form" },
                        ].map((it) => (
                          <label key={it.key} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(bookletData as any)[it.key]}
                              onChange={(e) => updateField(it.key, e.target.checked)}
                              className="rounded text-blue-600"
                            />
                            <span>{it.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-1.5">
                      <h4 className="font-bold text-slate-900 text-[11px] border-b border-[#DDE2EC] pb-1">Intra-Operative (11-15)</h4>
                      <div className="space-y-1 text-slate-700 text-[11px]">
                        {[
                          { key: "chkAnaesNotes", label: "11. Anaesthesia Notes" },
                          { key: "chkWhoSafetyList", label: "12. WHO Safety List" },
                          { key: "chkOperationNotes", label: "13. Operation Notes" },
                          { key: "chkSurgeonNotes", label: "14. Surgeon Notes" },
                          { key: "chkMedicationChart", label: "15. Medication Chart" },
                        ].map((it) => (
                          <label key={it.key} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(bookletData as any)[it.key]}
                              onChange={(e) => updateField(it.key, e.target.checked)}
                              className="rounded text-blue-600"
                            />
                            <span>{it.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#DDE2EC] space-y-1.5">
                      <h4 className="font-bold text-slate-900 text-[11px] border-b border-[#DDE2EC] pb-1">Post-Operative (16-21)</h4>
                      <div className="space-y-1 text-slate-700 text-[11px]">
                        {[
                          { key: "chkRecoveryEval", label: "16. Recovery Eval" },
                          { key: "chkAnaesRecord", label: "17. Anaes Record" },
                          { key: "chkNurseHandover", label: "18. Nurse Handover" },
                          { key: "chkQualityIndicators", label: "19. Quality Indicators" },
                          { key: "chkPhotosVideos", label: "20. Photos/Videos" },
                          { key: "chkRadiologyHandover", label: "21. Radiology Handover" },
                        ].map((it) => (
                          <label key={it.key} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(bookletData as any)[it.key]}
                              onChange={(e) => updateField(it.key, e.target.checked)}
                              className="rounded text-blue-600"
                            />
                            <span>{it.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 9: PRE-PREPARATION FORM */}
              {bookletActivePage === 9 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 9: Pre-Preparation Form for Operation (17 Ward Items)
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      Ward Handover Completed
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 bg-[#F8FAFC] p-4 rounded-lg border border-[#DDE2EC] text-xs">
                    <div>
                      <label className="text-[#64748B] text-[11px] block">1. Consent</label>
                      <input type="text" value={bookletData.prepConsent} onChange={(e) => updateField("prepConsent", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-semibold" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">2. G.C.</label>
                      <input type="text" value={bookletData.prepGc} onChange={(e) => updateField("prepGc", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">3. B.P.</label>
                      <input type="text" value={bookletData.prepBp} onChange={(e) => updateField("prepBp", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-mono" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">4. Pulse</label>
                      <input type="text" value={bookletData.prepPulse} onChange={(e) => updateField("prepPulse", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-mono" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">5. Temp</label>
                      <input type="text" value={bookletData.prepTemp} onChange={(e) => updateField("prepTemp", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-mono" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">6. ID Tag</label>
                      <input type="text" value={bookletData.prepIdTag} onChange={(e) => updateField("prepIdTag", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-semibold" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">7. Weight</label>
                      <input type="text" value={bookletData.prepWeight} onChange={(e) => updateField("prepWeight", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">8. Premedication</label>
                      <input type="text" value={bookletData.prepPremed} onChange={(e) => updateField("prepPremed", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">9. Ryles Tube</label>
                      <input type="text" value={bookletData.prepRylesTube} onChange={(e) => updateField("prepRylesTube", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">10. Enema</label>
                      <input type="text" value={bookletData.prepEnema} onChange={(e) => updateField("prepEnema", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">11. Last Micturition</label>
                      <input type="text" value={bookletData.prepLastMicturition} onChange={(e) => updateField("prepLastMicturition", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">12. Last Feed</label>
                      <input type="text" value={bookletData.prepLastFeed} onChange={(e) => updateField("prepLastFeed", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">13. Nail Polish/Lipstick</label>
                      <input type="text" value={bookletData.prepNailPolish} onChange={(e) => updateField("prepNailPolish", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">14. Dentures/Jewels</label>
                      <input type="text" value={bookletData.prepDentures} onChange={(e) => updateField("prepDentures", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">15. Site Prep/Shave</label>
                      <input type="text" value={bookletData.prepSitePrep} onChange={(e) => updateField("prepSitePrep", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white font-semibold" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">16. X-Ray Reports</label>
                      <input type="text" value={bookletData.prepXrayReports} onChange={(e) => updateField("prepXrayReports", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[#64748B] text-[11px] block">17. Lab Reports</label>
                      <input type="text" value={bookletData.prepLabReports} onChange={(e) => updateField("prepLabReports", e.target.value)} className="w-full border rounded px-2 py-0.5 bg-white" />
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs font-semibold p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
                    <div className="flex items-center gap-2">
                      <span>Handed Over By:</span>
                      <input type="text" value={bookletData.prepHandoffBy} onChange={(e) => updateField("prepHandoffBy", e.target.value)} className="border rounded px-2 py-0.5 bg-white font-semibold text-slate-900" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Taken Over By:</span>
                      <input type="text" value={bookletData.prepTakenOverBy} onChange={(e) => updateField("prepTakenOverBy", e.target.value)} className="border rounded px-2 py-0.5 bg-white font-semibold text-slate-900" />
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 10: WHO SURGICAL SAFETY CHECKLIST */}
              {bookletActivePage === 10 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 10: Surgical Safety Check List (WHO 3-Phase Checklist)
                    </h3>
                    <span className="text-[10.5px] font-semibold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                      Live OT Safety Check
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                      <label className="flex items-center gap-2.5 cursor-pointer font-bold text-slate-900">
                        <input
                          type="checkbox"
                          checked={bookletData.whoSignIn}
                          onChange={(e) => updateField("whoSignIn", e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span>Phase 1: Sign-In (Before Induction of Anaesthesia)</span>
                      </label>
                      <DictationTextarea
                        rows={2}
                        value={bookletData.whoSignInNotes}
                        onChange={(e) => updateField("whoSignInNotes", e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 bg-white text-xs"
                      />
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                      <label className="flex items-center gap-2.5 cursor-pointer font-bold text-slate-900">
                        <input
                          type="checkbox"
                          checked={bookletData.whoTimeOut}
                          onChange={(e) => updateField("whoTimeOut", e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span>Phase 2: Time-Out (Before Skin Incision)</span>
                      </label>
                      <DictationTextarea
                        rows={2}
                        value={bookletData.whoTimeOutNotes}
                        onChange={(e) => updateField("whoTimeOutNotes", e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 bg-white text-xs"
                      />
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                      <label className="flex items-center gap-2.5 cursor-pointer font-bold text-slate-900">
                        <input
                          type="checkbox"
                          checked={bookletData.whoSignOut}
                          onChange={(e) => updateField("whoSignOut", e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span>Phase 3: Sign-Out (Before Patient Leaves Operating Room)</span>
                      </label>
                      <DictationTextarea
                        rows={2}
                        value={bookletData.whoSignOutNotes}
                        onChange={(e) => updateField("whoSignOutNotes", e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 bg-white text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 11: ANAESTHESIA INTRA-OP RECORD */}
              {bookletActivePage === 11 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 11: Anaesthesia Intra-Op Record &amp; Vitals Grid
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      Live Intra-Op Vitals
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-3 text-xs">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[#64748B] text-[11px] mb-1 font-semibold">BP (mmHg)</label>
                        <input type="text" value={bookletData.bp} onChange={(e) => updateField("bp", e.target.value)} className="w-full border border-[#DDE2EC] rounded px-2.5 py-1.5 bg-white font-mono font-bold" />
                      </div>
                      <div>
                        <label className="block text-[#64748B] text-[11px] mb-1 font-semibold">Heart Rate (bpm)</label>
                        <input type="number" value={bookletData.hr} onChange={(e) => updateField("hr", parseInt(e.target.value) || 0)} className="w-full border border-[#DDE2EC] rounded px-2.5 py-1.5 bg-white font-mono font-bold" />
                      </div>
                      <div>
                        <label className="block text-[#64748B] text-[11px] mb-1 font-semibold">SpO2 (%)</label>
                        <input type="number" value={bookletData.spo2} onChange={(e) => updateField("spo2", parseInt(e.target.value) || 0)} className="w-full border border-[#DDE2EC] rounded px-2.5 py-1.5 bg-white font-mono font-bold" />
                      </div>
                      <div>
                        <label className="block text-[#64748B] text-[11px] mb-1 font-semibold">EtCO2 (mmHg)</label>
                        <input type="number" value={bookletData.etco2} onChange={(e) => updateField("etco2", parseInt(e.target.value) || 0)} className="w-full border border-[#DDE2EC] rounded px-2.5 py-1.5 bg-white font-mono font-bold" />
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-lg border border-[#DDE2EC] space-y-2 text-xs">
                      <div className="text-slate-700 text-[11px] font-bold uppercase tracking-wider">INTRA-OPERATIVE DRUG LOG (MANUALLY EDITABLE)</div>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-0.5">Induction Drugs:</label>
                        <input type="text" value={bookletData.inductionDrugs} onChange={(e) => updateField("inductionDrugs", e.target.value)} className="w-full border rounded px-2.5 py-1 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-0.5">Maintenance Protocol:</label>
                        <input type="text" value={bookletData.maintenanceDrugs} onChange={(e) => updateField("maintenanceDrugs", e.target.value)} className="w-full border rounded px-2.5 py-1 font-mono text-xs" />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-0.5">Reversal &amp; Extubation:</label>
                        <input type="text" value={bookletData.reversalDrugs} onChange={(e) => updateField("reversalDrugs", e.target.value)} className="w-full border rounded px-2.5 py-1 font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 12: OPERATION RECORD */}
              {bookletActivePage === 12 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 12: Operation Record (Surgeon &amp; Surgical Nurse Form)
                    </h3>
                    <span className="text-[10.5px] font-semibold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                      Surgical Verification
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-3 text-xs">
                    <div className="grid grid-cols-3 gap-3">
                      <label className="flex items-center gap-2 p-2.5 bg-white border border-[#DDE2EC] rounded-lg font-bold text-xs cursor-pointer">
                        <input type="checkbox" checked={bookletData.swabCount} onChange={(e) => updateField("swabCount", e.target.checked)} className="rounded text-blue-600" />
                        <span>✓ Swab Count Correct</span>
                      </label>
                      <label className="flex items-center gap-2 p-2.5 bg-white border border-[#DDE2EC] rounded-lg font-bold text-xs cursor-pointer">
                        <input type="checkbox" checked={bookletData.needleCount} onChange={(e) => updateField("needleCount", e.target.checked)} className="rounded text-blue-600" />
                        <span>✓ Needle Count Correct</span>
                      </label>
                      <label className="flex items-center gap-2 p-2.5 bg-white border border-[#DDE2EC] rounded-lg font-bold text-xs cursor-pointer">
                        <input type="checkbox" checked={bookletData.instrumentCount} onChange={(e) => updateField("instrumentCount", e.target.checked)} className="rounded text-blue-600" />
                        <span>✓ Instrument Count Correct</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Pre-Op Diagnosis</label>
                        <DictationInput type="text" value={bookletData.preOpDiagnosis} onChange={(e) => updateField("preOpDiagnosis", e.target.value)} className="w-full border rounded p-2 bg-white" />
                      </div>
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Post-Op Diagnosis</label>
                        <DictationInput type="text" value={bookletData.postOpDiagnosis} onChange={(e) => updateField("postOpDiagnosis", e.target.value)} className="w-full border rounded p-2 bg-white font-semibold" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Estimated Blood Loss (ml)</label>
                        <input type="number" value={bookletData.bloodLossMl} onChange={(e) => updateField("bloodLossMl", parseInt(e.target.value) || 0)} className="w-full border rounded p-2 bg-white font-mono font-bold" />
                      </div>
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Drains Count</label>
                        <input type="number" value={bookletData.drainsCount} onChange={(e) => updateField("drainsCount", parseInt(e.target.value) || 0)} className="w-full border rounded p-2 bg-white font-mono" />
                      </div>
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Sutures &amp; Staples</label>
                        <input type="text" value={bookletData.suturesUsed} onChange={(e) => updateField("suturesUsed", e.target.value)} className="w-full border rounded p-2 bg-white" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Operative Findings &amp; Procedure Details</label>
                      <DictationTextarea
                        rows={3}
                        value={bookletData.operativeFindings}
                        onChange={(e) => updateField("operativeFindings", e.target.value)}
                        className="w-full border border-[#DDE2EC] rounded p-2.5 bg-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 13: OPERATION NOTES */}
              {bookletActivePage === 13 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 13: Operation Notes &amp; Post-Op Instructions
                    </h3>
                    <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                      Surgeon Clinical Entry
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">Surgeon Detailed Operative Summary (Fully Editable)</label>
                      <DictationTextarea
                        rows={3.5}
                        value={bookletData.surgeonNotes}
                        onChange={(e) => updateField("surgeonNotes", e.target.value)}
                        className="w-full border border-[#DDE2EC] rounded p-2.5 bg-white text-xs leading-relaxed"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-900 mb-1">Post-Operative Nursing Instructions (Fully Editable)</label>
                      <DictationTextarea
                        rows={3}
                        value={bookletData.postOpInstructions}
                        onChange={(e) => updateField("postOpInstructions", e.target.value)}
                        className="w-full border border-[#DDE2EC] rounded p-2.5 bg-white text-xs leading-relaxed"
                      />
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-[#DDE2EC]">
                      <span className="text-slate-500 font-medium">Verified Operating Surgeon:</span>
                      <input
                        type="text"
                        value={bookletData.surgeonSignature}
                        onChange={(e) => updateField("surgeonSignature", e.target.value)}
                        className="border rounded px-3 py-1 font-bold text-slate-900 text-xs bg-white text-right"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* PAGE 14: ALDRETE & PACU RECOVERY */}
              {bookletActivePage === 14 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[#DDE2EC] pb-2">
                    <h3 className="font-bold text-sm text-slate-900">
                      Page 14: Recovery Evaluation &amp; Modified Aldrete Score
                    </h3>
                    <span className="text-[10.5px] font-semibold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                      PACU Discharge Clearance
                    </span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#DDE2EC] rounded-lg space-y-4 text-xs">
                    <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-[#DDE2EC]">
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Modified Aldrete Recovery Score</span>
                        <span className="text-[11px] text-slate-500">Threshold for Ward Transfer: &ge; 9 / 10</span>
                      </div>
                      <span className={`px-3 py-1 text-white font-mono font-bold text-sm rounded-lg shadow-xs ${calculateTotalAldrete() >= 9 ? "bg-emerald-600" : "bg-amber-600"}`}>
                        {calculateTotalAldrete()} / 10
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded-lg border border-[#DDE2EC]">
                        <label className="block text-slate-800 font-semibold mb-1">1. Activity (0-2)</label>
                        <select value={bookletData.aldreteActivity} onChange={(e) => updateField("aldreteActivity", parseInt(e.target.value))} className="w-full border border-[#DDE2EC] rounded p-1.5 bg-white">
                          <option value={2}>2 - Moves 4 extremities voluntarily</option>
                          <option value={1}>1 - Moves 2 extremities voluntarily</option>
                          <option value={0}>0 - Moves 0 extremities</option>
                        </select>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-[#DDE2EC]">
                        <label className="block text-slate-800 font-semibold mb-1">2. Respiration (0-2)</label>
                        <select value={bookletData.aldreteRespiration} onChange={(e) => updateField("aldreteRespiration", parseInt(e.target.value))} className="w-full border border-[#DDE2EC] rounded p-1.5 bg-white">
                          <option value={2}>2 - Deep breath &amp; cough freely</option>
                          <option value={1}>1 - Dyspneic or limited breathing</option>
                          <option value={0}>0 - Apneic</option>
                        </select>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-[#DDE2EC]">
                        <label className="block text-slate-800 font-semibold mb-1">3. Circulation / BP (0-2)</label>
                        <select value={bookletData.aldreteCirculation} onChange={(e) => updateField("aldreteCirculation", parseInt(e.target.value))} className="w-full border border-[#DDE2EC] rounded p-1.5 bg-white">
                          <option value={2}>2 - BP ± 20 mm Hg of preanesthetic level</option>
                          <option value={1}>1 - BP ± 20-50 mm Hg of preanesthetic level</option>
                          <option value={0}>0 - BP ± 50 mm Hg of preanesthetic level</option>
                        </select>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-[#DDE2EC]">
                        <label className="block text-slate-800 font-semibold mb-1">4. Consciousness (0-2)</label>
                        <select value={bookletData.aldreteConsciousness} onChange={(e) => updateField("aldreteConsciousness", parseInt(e.target.value))} className="w-full border border-[#DDE2EC] rounded p-1.5 bg-white">
                          <option value={2}>2 - Fully awake &amp; oriented</option>
                          <option value={1}>1 - Arousable on calling</option>
                          <option value={0}>0 - Unresponsive</option>
                        </select>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-[#DDE2EC] md:col-span-2">
                        <label className="block text-slate-800 font-semibold mb-1">5. O2 Saturation (0-2)</label>
                        <select value={bookletData.aldreteO2Sat} onChange={(e) => updateField("aldreteO2Sat", parseInt(e.target.value))} className="w-full border border-[#DDE2EC] rounded p-1.5 bg-white">
                          <option value={2}>2 - Maintains SpO2 &gt; 92% on room air</option>
                          <option value={1}>1 - Needs O2 inhalation to maintain SpO2 &gt; 90%</option>
                          <option value={0}>0 - SpO2 &lt; 90% even with oxygen</option>
                        </select>
                      </div>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-[#DDE2EC]">
                      <label className="block text-slate-800 font-semibold mb-1">PACU Nursing Recovery Notes</label>
                      <DictationTextarea
                        rows={2}
                        value={bookletData.pacuNotes}
                        onChange={(e) => updateField("pacuNotes", e.target.value)}
                        className="w-full border border-[#DDE2EC] rounded p-2 bg-white text-xs"
                      />
                    </div>

                    <div className="p-3.5 bg-white rounded-xl border border-[#DDE2EC] flex flex-col sm:flex-row justify-between items-center gap-3">
                      <div>
                        <span className={`font-bold block text-xs ${calculateTotalAldrete() >= 9 ? "text-emerald-800" : "text-amber-800"}`}>
                          {calculateTotalAldrete() >= 9
                            ? "✓ Aldrete Target Met (≥9/10). Patient hemodynamically stable & cleared for Inpatient Ward transfer."
                            : "⚠️ Aldrete Score < 9/10. Patient requires continued PACU monitoring OR Transfer to Critical Care (SICU)."}
                        </span>
                        <span className="text-[10.5px] text-slate-500">
                          Choose destination based on post-operative recovery status.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {calculateTotalAldrete() >= 9 && (
                          <Btn
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              if (onTransferToWard) {
                                onTransferToWard(activeCase);
                              } else {
                                handleUpdateStatus(activeCase.id, "Transferred to Ward");
                                onClose();
                              }
                            }}
                          >
                            🛏️ Allocate Inpatient Ward Bed ➔
                          </Btn>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onTransferToIcu) {
                              onTransferToIcu(activeCase);
                            } else {
                              handleUpdateStatus(activeCase.id, "Transferred to ICU");
                              onClose();
                            }
                          }}
                          className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                        >
                          <span>🫀 Transfer to ICU / SICU</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Modal Bottom Action Footer */}
        <div className="bg-white border-t border-[#DDE2EC] px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Btn
              variant="outline"
              size="xs"
              onClick={() => setBookletActivePage(Math.max(1, bookletActivePage - 1))}
              disabled={bookletActivePage === 1}
            >
              ◀ Previous Page
            </Btn>
            <span className="text-xs font-mono text-slate-500 px-2">
              Page {bookletActivePage} / 14
            </span>
            <Btn
              variant="outline"
              size="xs"
              onClick={() => setBookletActivePage(Math.min(14, bookletActivePage + 1))}
              disabled={bookletActivePage === 14}
            >
              Next Page ▶
            </Btn>
          </div>

          <div className="flex items-center gap-2">
            {saveStatusMsg && (
              <span className="text-xs text-emerald-700 font-semibold animate-in fade-in mr-2">
                {saveStatusMsg}
              </span>
            )}
            <Btn variant="outline" size="xs" onClick={saveBookletProgress}>
              💾 Save Booklet Progress
            </Btn>
            <Btn variant="primary" size="xs" onClick={() => onClose()}>
              Close Booklet
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
};
