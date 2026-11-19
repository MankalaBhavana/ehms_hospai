# EHMS - modules, where each works, and the functionality check

Generated 2026-11-16 from the running system (admin sign-in, live data). Two kinds of "model" are listed: the application's **modules** (Part A) and the **AI / ML models** it uses (Part B).

## Result in one table

| Check | Result |
|---|---|
| Screens opened one by one in a real browser (every sidebar entry) | **128 screens, 128 opened with no crash, no JavaScript error and real content**; 0 crashed; 0 blank; 0 raised a JavaScript error |
| Backend: every parameter-less GET endpoint called as administrator | **121 endpoints, none returned a server error** (4xx only where a parameter is required: username, Aadhaar number; CSV / PDF / Word exports return files) |
| Backend automated tests | 67 passed |
| Frontend automated tests | insurance + billing + rates + Aadhaar + helplines + in-patient orders: 53 steps; access control; sync ACL; IP care 12 steps; dictation 22 checks; sync 9; billing 4 |
| Access control | each role opens only the screens its grants allow (tests/access.e2e.ts) |

What the screen check does and does not prove: it proves every screen opens and draws with live data and raises no error. It does not click every button inside every screen; those are covered by the automated suites above for the billing, rate master, insurance, in-patient, Aadhaar, notification, access and dictation logic, and by earlier live checks for registration, payments and notices.

# Part A - Modules

## Dashboard

The landing page: today's appointments, queue and bed counts, alerts and quick actions for the signed-in role.

- **Code:** components/Dashboard.tsx
- **Data / backend:** dashboard routes, local stores

| Screen | Opened | Notes |
|---|---|---|
| Dashboard | ✅ |  |

## Doctor Workspace

A doctor's own workspace: patient queue, consultation (typed / dictated), prescription sheet split into medicines and tests, dispatch to pharmacy / lab / radiology, **IP patients** (concern-doctor list with monitoring, notes, orders). Administrators see the all-doctors overview.

- **Code:** components/doctor/DoctorPortal.tsx, InpatientRounds.tsx, DoctorsOverview.tsx; services/doctorPortalDb.ts, consultationDispatch.ts, ipCare.ts, ipOrders.ts
- **Data / backend:** patients.clinical, /api/ai/prescription-parse, rate master

| Screen | Opened | Notes |
|---|---|---|
| Doctor Workspace | ✅ |  |

## Reception

Patient master and front desk: search, registration with Aadhaar identity key and OP card, the **Registry** (every patient, visits, dues), appointments, patient messages (WhatsApp / SMS / e-mail).

- **Code:** components/PatientSearch.tsx, Registration.tsx, PatientRegistry.tsx, Appointments.tsx, messaging/PatientMessages.tsx; services/db.ts
- **Data / backend:** patients, appointments, messaging routes; Twilio

| Screen | Opened | Notes |
|---|---|---|
| Patient Search | ✅ |  |
| Registration | ✅ |  |
| Registry | ✅ |  |
| Appointments | ✅ |  |
| Patient Messages | ✅ |  |

## OP Department

Outpatient flow: OP management, live queue board and transfers, nurse station (vitals), minor OPD procedures, OP clinical journey.

- **Code:** components/OPManagement.tsx, QueueManagement.tsx, NurseStation.tsx, OPDProcedures.tsx, OPWorkflow.tsx
- **Data / backend:** op, queue routes; db.ts

| Screen | Opened | Notes |
|---|---|---|
| OP Management | ✅ |  |
| Live Queue Board | ✅ |  |
| Nurse Station | ✅ |  |
| OPD Minor Procedures | ✅ |  |

## Clinical

The patient's clinical chart: encounters, evaluations (doctor / nurse notes), vitals, diagnoses, documents.

- **Code:** components/PatientChart.tsx, AddEvaluationModal.tsx
- **Data / backend:** patients notes / EMR routes

| Screen | Opened | Notes |
|---|---|---|
| Encounters | ✅ |  |

## Emergency

ER track board, triage (AI-assisted with a rule-based fallback), treatments, orders, billing, disposition and bed request with the concern doctor.

- **Code:** pages/ErPage.tsx, components/Triage.tsx; services/erDb.ts
- **Data / backend:** er routes; AI triage

| Screen | Opened | Notes |
|---|---|---|
| ED Track Board | ✅ |  |
| Triage | ✅ |  |

## Inpatient

Bed board, bed management (allocate / transfer / discharge), **Ward Nursing**, admissions, readmission, discharge.

- **Code:** components/Inpatient.tsx, pages/BedManagementPage.tsx, nursing/WardNursing.tsx, Admissions.tsx, Readmission.tsx, Discharge.tsx; services/bedDb.ts, ipCare.ts
- **Data / backend:** beds routes

| Screen | Opened | Notes |
|---|---|---|
| Bed Board | ✅ |  |
| Bed Management | ✅ |  |
| Ward Nursing | ✅ |  |
| Admissions | ✅ |  |
| Readmission | ✅ |  |
| Discharge | ✅ |  |

## Critical Care

One workspace for every ICU unit: bed census, flowsheet, drug chart, infusions, lab and medication orders, ICU discharge.

- **Code:** components/ICU.tsx, IcuDepartment.tsx, icu/*
- **Data / backend:** beds, notes routes

| Screen | Opened | Notes |
|---|---|---|
| Medical ICU (MICU) | ✅ |  |
| Surgical ICU (SICU) | ✅ |  |
| Cardiac ICU (CCU) | ✅ |  |
| Neuro ICU (NICU) | ✅ |  |
| Pediatric ICU (PICU) | ✅ |  |
| ICU Ward | ✅ |  |

## Laboratory

Lab orders (paid-first), sample collection, workbench and result entry, pathologist review, reports, inventory, quality analytics, test catalogue configuration.

- **Code:** components/Laboratory.tsx, laboratory/*; services/labOrdersDb.ts, diagnosticTariffDb.ts
- **Data / backend:** lab orders store; billing

| Screen | Opened | Notes |
|---|---|---|
| Lab Dashboard | ✅ |  |
| Lab Orders Directory | ✅ |  |
| Lab Workbench | ✅ |  |
| Lab Reports | ✅ |  |
| Lab Inventory & Consumables | ✅ |  |
| Quality & Analytics | ✅ |  |
| Admin Configuration | ✅ |  |

## Radiology

Imaging worklist, scanning operations, reporting workspace with templates, finalised reports, template management, analytics.

- **Code:** components/Radiology.tsx, radiology/*; services/radiologyWorkflowDb.ts
- **Data / backend:** radiology store; billing

| Screen | Opened | Notes |
|---|---|---|
| Overview Hub | ✅ |  |
| Examination Worklist | ✅ |  |
| Scanning Operations | ✅ |  |
| Reporting Workspace | ✅ |  |
| Finalized Reports | ✅ |  |
| Template Management | ✅ |  |
| Department Analytics | ✅ |  |

## Pharmacy

Prescription queue, dispensing and billing, returns and refunds, medicine master and batches, suppliers, GRN, supplier returns, stock ledger, expiry alerts, write-off, analytics, audit.

- **Code:** components/Pharmacy.tsx, PharmacyModule/*; services/pharmacyDb.ts
- **Data / backend:** pharmacy routes

| Screen | Opened | Notes |
|---|---|---|
| Dashboard | ✅ |  |
| Dispensing & Billing | ✅ |  |
| Doctor Prescriptions | ✅ |  |
| Patient Returns & Refunds | ✅ |  |
| Medicine Catalog & Batches | ✅ |  |
| Suppliers Directory | ✅ |  |
| Inward Stock Entry (GRN) | ✅ |  |
| Supplier Returns (Debit Notes) | ✅ |  |
| Stock Movement Ledger | ✅ |  |
| Expiry & Low Stock Alerts | ✅ |  |
| Medicine Disposal & Write-Off | ✅ |  |
| Pharmacy Analytics & Reports | ✅ |  |
| Alerts & Notifications | ✅ |  |
| Pharmacy Audit Log | ✅ |  |

## Surgery

OT scheduling and booklet (pre-op, intra-op, post-op), stat emergency, transfer to ward / ICU, surgical discharge.

- **Code:** components/Surgery.tsx, surgery/*; services/surgeryDb.ts
- **Data / backend:** ot routes

| Screen | Opened | Notes |
|---|---|---|
| Surgery | ✅ |  |

## Billing

OP / IP / ER counters, investigation (lab + radiology) billing, unified patient bill, payment history, revenue and dues; amounts come only from Administration's rate master.

- **Code:** components/Billing.tsx, LabBillingQueue.tsx, PaymentCollection.tsx, billing/*; services/billingDb.ts, priceMaster.ts
- **Data / backend:** billing routes, payment ledger

| Screen | Opened | Notes |
|---|---|---|
| Billing Dashboard | ✅ |  |
| OP Billing | ✅ |  |
| IP Billing | ✅ |  |
| Emergency Billing | ✅ |  |
| Investigation Billing | ✅ |  |
| Unified Patient Bill | ✅ |  |
| Payment History | ✅ |  |
| Revenue & Dues | ✅ |  |

## Insurance

Patient policies, eligibility, pre-authorisation, claims / queries / denials, e-mail and TPA hub, settlement and reconciliation, reports, set-up, audit rules.

- **Code:** components/insurance/*; services/insuranceDb.ts
- **Data / backend:** insurance routes

| Screen | Opened | Notes |
|---|---|---|
| Patient Insurance | ✅ |  |
| Intake & Eligibility | ✅ |  |
| Pre-Authorization | ✅ |  |
| Claims, Queries & Denials | ✅ |  |
| Email & TPA Decision Hub | ✅ |  |
| Settlement & Reconciliation | ✅ |  |
| Insurance Reports | ✅ |  |
| Setup | ✅ |  |
| Audit Log & Rules | ✅ |  |

## Accounts & Finance

Chart of accounts, general ledger and journals, receipt / payment vouchers, cash and bank, AR / AP, pharmacy and insurance accounts, tax, budgets, assets, statements, period closing.

- **Code:** components/accounts/*
- **Data / backend:** accounts routes

| Screen | Opened | Notes |
|---|---|---|
| Finance Dashboard | ✅ |  |
| Chart of Accounts | ✅ |  |
| General Ledger & Journals | ✅ |  |
| Receipt Vouchers | ✅ |  |
| Payment Vouchers | ✅ |  |
| Cash & Bank | ✅ |  |
| Accounts Receivable (AR) | ✅ |  |
| Accounts Payable (AP) | ✅ |  |
| Pharmacy Accounts | ✅ |  |
| Insurance Accounts | ✅ |  |
| GST & Tax Setup | ✅ |  |
| Budgeting & Cost Centres | ✅ |  |
| Fixed Assets | ✅ |  |
| Financial Statements | ✅ |  |
| Period Closing | ✅ |  |
| Audit & Integrations | ✅ |  |
| Finance Manager Hub | ✅ |  |

## HR & Staff

Employees master, attendance, shifts and roster, staffing, leave, approvals, payroll, recruitment, organisation, training, appraisals, audits, grievances, statutory reports, circulars.

- **Code:** components/hr/*, hrms/*, HRMS.tsx
- **Data / backend:** hr /api/v1 routes

| Screen | Opened | Notes |
|---|---|---|
| Executive Dashboard | ✅ |  |
| Employees Master | ✅ |  |
| Attendance & Bio | ✅ |  |
| Duty Shifts & Roster | ✅ |  |
| Department Staffing | ✅ |  |
| Leave Requests | ✅ |  |
| Pending Approvals | ✅ |  |
| Payroll Processing | ✅ |  |
| Recruitment & Onboarding | ✅ |  |
| Organization Structure | ✅ |  |
| Training & Compliance | ✅ |  |
| Staff Appraisals | ✅ |  |
| Regulatory Audits | ✅ |  |
| Disciplinary & Grievances | ✅ |  |
| Statutory HR Reports | ✅ |  |
| Staff Circulars | ✅ |  |

## Hosp AI

Keppler OCR (document capture, vault, knowledge base, chat), Symptom AI, Clinical Summaries, PatientReach AI.

- **Code:** components/SmartOCR.tsx, DpiOcrPortal.tsx, SymptomAI.tsx, ClinicalSummaries.tsx, PatientExperience.tsx; ocr-frontend / ocr-backend
- **Data / backend:** symptom_ai, ocr_portal routes; vLLM

| Screen | Opened | Notes |
|---|---|---|
| Keppler OCR | ✅ |  |
| Symptom AI | ✅ |  |
| Clinical Summaries | ✅ |  |
| PatientReach AI | ✅ |  |

## Reports

Overview and report pages for patients, OP, ER, IP, appointments, doctors, pharmacy, lab, radiology, beds, admissions, discharges, staff, revenue, damaged stock, supplier returns.

- **Code:** components/reports/*
- **Data / backend:** reports routes

| Screen | Opened | Notes |
|---|---|---|
| Overview | ✅ |  |
| Patient Reports | ✅ |  |
| OP Reports | ✅ |  |
| ER Reports | ✅ |  |
| IP / Inpatient Reports | ✅ |  |
| Appointment Reports | ✅ |  |
| Doctor Reports | ✅ |  |
| Pharmacy Reports | ✅ |  |
| Laboratory Reports | ✅ |  |
| Radiology Reports | ✅ |  |
| Bed Reports | ✅ |  |
| Admission Reports | ✅ |  |
| Discharge Reports | ✅ |  |
| Staff Reports | ✅ |  |
| Revenue Reports | ✅ |  |
| Pharmacy Damaged Stock | ✅ |  |
| Supplier Return Ledger | ✅ |  |

## Administration

Control centre: doctor master, **Rates & Charges** (every amount, extra items, **helpline numbers**), roles and access, users, audit trail, configuration.

- **Code:** components/Administration.tsx, RatesAndCharges.tsx, HelplineNumbers.tsx; services/priceMaster.ts, hospitalContacts.ts
- **Data / backend:** admin routes, sync server

| Screen | Opened | Notes |
|---|---|---|
| Control Centre | ✅ |  |
| Doctor Workspace & Master | ✅ |  |

# Part B - AI and ML models

> The full reference (what each model is, every feature that uses it, safeguards, fallbacks, and which models carry the major role) is in **AI_MODELS_REFERENCE.md**. This table is the summary.

| Model / engine | What it does | Where it is used | Needs | State on this server |
|---|---|---|---|---|
| **vLLM chat / vision LLM** (a Qwen family model; the served model name is asked from the server, never hard-coded) | Reads prescription / document images (OCR), triage, symptom analysis and chat, clinical summaries, patient-history search, ER triage suggestions, discharge-summary assist, pharmacy invoice OCR | Hosp AI (Symptom AI, Clinical Summaries, Keppler OCR), ER triage, Doctor Workspace photo prescriptions, Pharmacy invoice OCR, Discharge | `VLLM_BASE_URL`, `VLLM_MODEL`, `VLLM_API_KEY` | **Not configured here.** Every feature degrades safely: ER and Symptom AI triage route to General for staff review (the API says so), prescriptions typed in the doctor workspace use the built-in splitter (`engine: heuristic`, verified) |
| **Embedding model** (vLLM embeddings endpoint) | Vector search over documents and notes | Symptom AI document chat, OCR knowledge base | `VLLM_EMBEDDING_URL`, `VLLM_EMBEDDING_MODEL` | Not configured here |
| **LightRAG** (library) | Knowledge-graph question answering over uploaded documents, one workspace per hospital and user | Symptom AI "ask about documents", Keppler OCR assistant | the LLM and embedding model above | Library installed; waits for the two models |
| **Whisper** (`faster-whisper`, default `large-v3`; set `WHISPER_MODEL_SIZE`) | Server speech-to-text, primed with the hospital's drug and test names | Every microphone (see VOICE_TO_TEXT_PLACES.md) | `pip install faster-whisper` | **Library not installed.** `/api/ai/transcribe/status` reports `available: false`, and the app automatically uses the browser speech service |
| **Browser speech recognition** (Chrome / Edge Web Speech) | Speech-to-text in 10 languages | Every microphone | Chrome or Edge, internet | **Working** (this is the live voice engine) |
| **Keppler OCR** (separate app: `ocr-frontend` + `ocr-backend`) | Document capture, vault, knowledge base, chat; its own model settings (`QWEN_OCR_MODEL`, `VISION_MODEL`, `CHAT_MODEL`, `EMBEDDING_MODEL` ...) | Hosp AI > Keppler OCR (embedded at `/keppler-ocr`) | its own model servers | **Screen up** (proxied correctly, answers on port 3000); extraction needs the vision model |
| Prescription splitter (rule-based, no model) | Splits a typed sheet into medicines and tests | Doctor Workspace | nothing | **Working** (verified live) |
| Consultation voice engine (rule-based) | Language detection, phonetic clean-up, doctor / patient turn separation, SOAP summary; deliberately creates no orders | Doctor Workspace consultation | nothing | Working |
| Dictation clean-up (rule-based) | Turns speech into clinical shorthand (BP 120/80, 500 mg TDS), corrects drug and test names against the pharmacy master and lab catalogue | Every microphone | nothing | **Working** (22 automated checks) |
| Triage and bed-need suggestions (rule-based fallback) | Suggests triage category, department and level of care when the LLM is not available | ER | nothing | Working |

Everything that depends on an AI model server fails safe: nothing is invented, the screen says what was not available, and the manual path still works. The model servers themselves are outside this code base (see FIXES_AND_TODO.md scope).

# Part C - What the check found

- **No screen crashed, none was blank, none raised a JavaScript error** (128 screens opened with the administrator's live data; the Keppler OCR screen is an embedded app and is checked as a frame).
- The first pass could not reach 11 screens by clicking (the sidebar shows the Critical Care group as "ICU", and three Reports entries sit under a collapsed "Financial Reports" sub-group); they were opened in a second pass and also open cleanly.
- **AI model servers are the one thing not running here** (vLLM chat / vision, embeddings, Whisper). Nothing breaks: each feature falls back (ER and Symptom AI triage route to General for staff review and say so; typed prescriptions use the built-in splitter; the microphone uses the browser engine), but photographed prescriptions, document OCR extraction, Symptom AI analysis / chat, Clinical RAG answers and pharmacy invoice OCR need the model servers to produce results.
- Server-side speech needs `pip install faster-whisper`; until then voice typing uses the browser (Chrome / Edge, internet required).
- The in-patient flow, notices, registry, helplines, ordering, dictation and access control are covered by automated tests (Part A table above), not only by opening the screen.
- Test data on the live system: patient BALA KRISHNA (PAT-100006) is admitted to PICU Bed 1 with no concern doctor; assign one from the Bed Board to see the full flow.
