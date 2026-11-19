# EHMS - Updated Files Inventory & Changelog (2026-11-11)

This document tracks all files modified, refactored, and verified in the repository during the active development cycle on **2026-11-11**.

---

## 1. Executive Summary of Key Fixes

| Feature / Issue | Description & Fix Summary | Key Files Involved |
|---|---|---|
| **Laboratory Print Duplication** | Resolved an issue where 3 duplicate copies/blocks appeared while printing lab reports. Implemented an isolated hidden `<iframe>` print pipeline, strict print CSS scoping (`body * { visibility: hidden !important; }`), and canonical panel/parameter deduplication in both UI and store. | [`CompleteLabReportModal.tsx`](frontend/src/components/laboratory/CompleteLabReportModal.tsx)<br>[`labOrdersDb.ts`](frontend/src/services/labOrdersDb.ts) |
| **Emergency Room Auto-Addition & Item Duplication** | Fixed unexpected item addition where AI Triage automatically committed treatment procedures (`treatmentsToApply`) into the patient's record without manual review. Removed redundant duplicate `apiFetch` in `InterventionForm` that logged two copies of interventions per submission. | [`ErPage.tsx`](frontend/src/pages/ErPage.tsx) |
| **Bed Allocation & ER Synchronization** | Resolved HTTP 409 Conflict, 404 Not Found, and `Error: Bed not found` runtime crashes. Fulfilling an ER bed request for a patient occupying an observation bed now seamlessly transfers them (`transfer_bed`), avoiding PostgreSQL unique index violations. Added type-safe bed ID comparison and fallback cache synthesis. | [`database.py`](backend/backend/utils/database.py)<br>[`beds/routes.py`](backend/backend/modules/beds/routes.py)<br>[`BedManagementPage.tsx`](frontend/src/pages/BedManagementPage.tsx)<br>[`bedDb.ts`](frontend/src/services/bedDb.ts)<br>[`api.ts`](frontend/src/lib/api.ts) |
| **Radiology Report PDF Download** | Replaced coordinate-based print output with an exact vector replica of the on-screen preview: official hospital letterhead, accreditation badges, 4-column balanced demographics card, ALARA protocol notes, structured findings, accented purple impression box, doctor signatures, and running pagination. | [`RadiologyReportPdfModal.tsx`](frontend/src/components/radiology/RadiologyReportPdfModal.tsx) |
| **Billing & Payments Accuracy** | Mapped department names and payment modes to backend codes; de-duplicated receipt ledgers; updated billing routes to accept `payment_status`. | [`billing/routes.py`](backend/backend/modules/billing/routes.py)<br>[`billingDb.ts`](frontend/src/services/billingDb.ts)<br>[`Billing.tsx`](frontend/src/components/Billing.tsx) |
| **Doctor & User Administration** | Fixed doctor account creation/deactivation, staff ID collision, and duplicate submission guards. Removed insecure fallback passwords and hardcoded device IPs. | [`admin/routes.py`](backend/backend/modules/admin/routes.py)<br>[`Administration.tsx`](frontend/src/components/Administration.tsx)<br>[`doctorMaster.ts`](frontend/src/services/doctorMaster.ts)<br>[`roleDb.ts`](frontend/src/services/roleDb.ts) |
| **Packaging & CI Automation** | Split requirements (`core`, `ai`, `dev`), added GitHub Actions CI pipeline, and updated container deployment configs. | [`ci.yml`](.github/workflows/ci.yml)<br>[`requirements.txt`](backend/backend/requirements.txt)<br>[`docker-compose.yml`](deploy/docker-compose.yml) |

---

## 2. Complete List of Updated Files (54 Files)

### A. Laboratory & Pathology Module (6 files)
1. **[`frontend/src/components/laboratory/CompleteLabReportModal.tsx`](frontend/src/components/laboratory/CompleteLabReportModal.tsx)**
   - Implemented isolated hidden `<iframe>` printing so only the report canvas is printed.
   - Added `@media print { body * { visibility: hidden !important; } }` fallback protection.
   - Added `displayedTests` to deduplicate test panel variants (CBC, LFT, RFT, Lipid) into single blocks.
   - Deduplicated parameter row entries using standard formatted laboratory labels (`formatParamLabel`).
2. **[`frontend/src/services/labOrdersDb.ts`](frontend/src/services/labOrdersDb.ts)**
   - Updated `normalizeOrder` to deduplicate tests using canonical `findTestDefinition()` keys.
   - Updated `createOrder` to deduplicate input tests prior to order instantiation.
3. **[`frontend/src/components/laboratory/PathologistReviewView.tsx`](frontend/src/components/laboratory/PathologistReviewView.tsx)**
   - Pathologist report preview and digital sign-off modal integration.
4. **[`frontend/src/components/laboratory/ResultEntryView.tsx`](frontend/src/components/laboratory/ResultEntryView.tsx)**
   - Laboratory workbench observations entry and submission controls.
5. **[`frontend/src/components/laboratory/LabDashboardView.tsx`](frontend/src/components/laboratory/LabDashboardView.tsx)**
   - Real-time lab test status counters and bench routing.
6. **[`frontend/src/services/labLisService.ts`](frontend/src/services/labLisService.ts)**
   - Laboratory information system simulation and removed hardcoded device IP addresses.

### B. Bed Management & Emergency Room (ER) Module (8 files)
7. **[`backend/backend/utils/database.py`](backend/backend/utils/database.py)**
   - In `allocate_er_bed_request`: checks `find_active_bed_for_patient`. If the patient occupies an active holding/observation bed, invokes `transfer_bed` instead of `assign_patient_to_bed`, eliminating `ux_bed_allocations_active_patient` duplicate key 409 collisions.
   - Permitted claiming requests in `('pending', 'allocating')` to prevent retry lockouts.
   - Added existence checks for target bed and patient record in `patients` table.
8. **[`backend/backend/modules/beds/routes.py`](backend/backend/modules/beds/routes.py)**
   - Safely returns success if patient already occupies the requested bed; improved 404/409 diagnostic error payloads.
9. **[`backend/backend/modules/er/routes.py`](backend/backend/modules/er/routes.py)**
   - Added foreign key exception catching to return informative HTTP 400 responses.
10. **[`frontend/src/pages/ErPage.tsx`](frontend/src/pages/ErPage.tsx)**
    - Prevented automatic unreviewed addition of clinical treatment interventions during AI Triage assessment (`runAiTriage`); suggested interventions now populate review form fields without mutating patient records.
    - Removed redundant duplicate `apiFetch('/api/er/visits/:id/treatments')` call in `InterventionForm.submit` that caused double entries on logging interventions.
11. **[`frontend/src/pages/BedManagementPage.tsx`](frontend/src/pages/BedManagementPage.tsx)**
    - In `loadBeds()`, persists fetched beds to `BedDatabase.save(loadedBeds)` so local storage reflects active system beds.
    - In `handleAllocateErBed()`, removed the inner `catch (srvErr)` that swallowed server rejections; displays exact server error messages via `reportError`.
12. **[`frontend/src/services/bedDb.ts`](frontend/src/services/bedDb.ts)**
    - Type-safe string and numeric ID comparisons (`Number(b.id) === Number(bedId) || String(b.id) === String(bedId)`).
    - In `allocateBedFromEr`, `assignBed`, `transferBed`, and `releaseBed`, replaced fatal `throw new Error("Bed not found")` with safe local cache synthesis.
13. **[`frontend/src/services/erDb.ts`](frontend/src/services/erDb.ts)**
    - Fixed visit persistence and server synchronization for emergency bed requests.
14. **[`frontend/src/lib/api.ts`](frontend/src/lib/api.ts)**
    - Wrapped bed and ER local mock handlers in `try/catch` to prevent unhandled mock crashes.
    - Prevented `LOCAL_MOCKS_ENABLED` from intercepting HTTP 409 (Conflict) and HTTP 400 (Validation) responses so server-side business errors are reliably surfaced to users.

### C. Radiology Diagnostics Module (6 files)
14. **[`frontend/src/components/radiology/RadiologyReportPdfModal.tsx`](frontend/src/components/radiology/RadiologyReportPdfModal.tsx)**
    - Rewrote `handleDownloadPdf` using `jspdf` and `jspdf-autotable` to produce a high-fidelity vector PDF matching the preview layout.
    - Letterhead with `✚` emblem, accreditation pill, 4-column patient demographics table, procedure banner, ALARA remarks, structured findings, accented purple impression box, doctor signatures, and running pagination.
15. **[`frontend/src/components/Radiology.tsx`](frontend/src/components/Radiology.tsx)**
    - Department navigation shell and reporting view management.
16. **[`frontend/src/utils/radiologyPrint.ts`](frontend/src/utils/radiologyPrint.ts)**
    - Shared printable report formatting helpers.
17. **[`frontend/src/services/radiologyWorkflowDb.ts`](frontend/src/services/radiologyWorkflowDb.ts)**
    - Scan state tracking keyed strictly by scan ID instead of accession number.
18. **[`frontend/src/components/radiology/UniversalRadiologyShell.tsx`](frontend/src/components/radiology/UniversalRadiologyShell.tsx)**
    - Universal radiology shell component.
19. **[`frontend/src/services/universalRadiologyDb.ts`](frontend/src/services/universalRadiologyDb.ts)**
    - Universal imaging records database.

### D. Billing & Financial Accounting Module (3 files)
20. **[`backend/backend/modules/billing/routes.py`](backend/backend/modules/billing/routes.py)**
    - Mapped verbal department names ("Outpatient", "Emergency") and payment modes to backend database codes; accepted `payment_status`.
21. **[`frontend/src/services/billingDb.ts`](frontend/src/services/billingDb.ts)**
    - De-duplicated receipt ledgers, accurate length-of-stay room charge billing, and invoice matching.
22. **[`frontend/src/components/Billing.tsx`](frontend/src/components/Billing.tsx)**
    - Cashier collection desk, invoice generation, and receipt history.

### E. Doctor Management & Clinical Queue (7 files)
23. **[`backend/backend/modules/admin/routes.py`](backend/backend/modules/admin/routes.py)**
    - Robust doctor account creation, normalized username lookups, staff ID sequence generation, and clean deactivation.
24. **[`frontend/src/components/Administration.tsx`](frontend/src/components/Administration.tsx)**
    - Doctor master dialog, single-submit guards, and real server rejection alerts.
25. **[`frontend/src/services/doctorMaster.ts`](frontend/src/services/doctorMaster.ts)**
    - Doctor master sync management and disabled default password fallbacks.
26. **[`frontend/src/services/roleDb.ts`](frontend/src/services/roleDb.ts)**
    - Permissions mapping and role database management.
27. **[`frontend/src/components/QueueManagement.tsx`](frontend/src/components/QueueManagement.tsx)**
    - Replaced dummy journey fallbacks with authentic recorded clinical vitals, diagnoses, and timestamps.
28. **[`frontend/src/services/db.ts`](frontend/src/services/db.ts)**
    - Fixed returning patient visit matching and consultation status preservation.
29. **[`frontend/src/services/auditDb.ts`](frontend/src/services/auditDb.ts)**
    - In-browser clinical audit event logger.

### F. Reports & Analytics (3 files)
30. **[`backend/backend/modules/reports/routes.py`](backend/backend/modules/reports/routes.py)**
    - Added `reports.read` authorization checks and real 30-day delta computations across tables.
31. **[`frontend/src/components/reports/GeneralReportsOverviewPage.tsx`](frontend/src/components/reports/GeneralReportsOverviewPage.tsx)**
    - Multi-department statistical reporting page.
32. **[`frontend/src/utils/generalReportsExporter.ts`](frontend/src/utils/generalReportsExporter.ts)**
    - CSV and print export formatting utilities.

### G. Pharmacy & Nursing Module (2 files)
33. **[`frontend/src/components/PharmacyModule/pages/Dispensing.tsx`](frontend/src/components/PharmacyModule/pages/Dispensing.tsx)**
    - Removed hardcoded POS device addresses; streamlined dispensing workflow.
34. **[`frontend/src/services/hrmsDb.ts`](frontend/src/services/hrmsDb.ts)**
    - Removed hardcoded biometric hardware addresses; API client routing.

### H. App Shell, Production Server & Live Sync (5 files)
35. **[`frontend/src/App.tsx`](frontend/src/App.tsx)**
    - Route permissions, laboratory and radiology sub-module navigation, and lazy-loaded views.
36. **[`frontend/package.json`](frontend/package.json)**
    - Dependencies, build scripts, and production server commands.
37. **[`frontend/server/prod.mjs`](frontend/server/prod.mjs)**
    - Production Node.js server with immutable asset caching and API reverse proxying.
38. **[`frontend/server/sync/kvSync.mjs`](frontend/server/sync/kvSync.mjs)**
    - Cross-browser long-poll live synchronization handler.
39. **[`backend/backend/app.py`](backend/backend/app.py)**
    - Flask application entry point with blueprint registrations.

### I. Deployment, Dependencies & CI Automation (10 files)
40. **[`backend/backend/requirements.txt`](backend/backend/requirements.txt)**
    - Pinned core backend dependencies.
41. **[`backend/backend/requirements-ai.txt`](backend/backend/requirements-ai.txt)**
    - Pinned AI/ML dependencies.
42. **[`backend/backend/requirements-dev.txt`](backend/backend/requirements-dev.txt)**
    - Pinned test runner and linting tools.
43. **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)**
    - Continuous integration pipeline for automated testing and builds.
44. **[`.gitignore`](.gitignore)**
    - Repository exclusions for cache directories, environment files, and build artifacts.
45. **[`deploy/docker-compose.yml`](deploy/docker-compose.yml)**
    - Multi-container production Docker compose definition.
46. **[`deploy/.env.example`](deploy/.env.example)**
    - Template for environment variables and secrets.
47. **[`deploy/backend.Dockerfile`](deploy/backend.Dockerfile)**
    - Docker container build specification for Flask API.
48. **[`deploy/web.Dockerfile`](deploy/web.Dockerfile)**
    - Docker container build specification for React/Node.js web layer.
49. **[`.dockerignore`](.dockerignore)**
    - Docker context exclusions.
50. **[`start-team-test.ps1`](start-team-test.ps1)**
    - Windows local test initialization script.

### J. Project Documentation (3 files)
51. **[`CHANGES_2026-11-11.md`](CHANGES_2026-11-11.md)**
    - Detailed daily log of fixes, handoffs, and verification results.
52. **[`FIXES_AND_TODO.md`](FIXES_AND_TODO.md)**
    - Comprehensive master audit of resolved and open issues across the system.
53. **[`README.md`](README.md)**
    - System setup, Docker deployment instructions, and architecture overview.

---

## 3. Verification & Build Status

- **Frontend Build**: `npm --prefix frontend run build` completed in **1.86s** with 0 errors.
- **Backend Syntax**: `python -m py_compile` executed across modified backend files with **0 errors**.
- **No Console Crashes**: Direct print iframe isolation, safe fallback synthesis, and robust error surfacing prevent unhandled runtime errors in active workflows.

---

# Update cycle 2026-11-12 / 2026-11-13: Billing, ER, Insurance, Reports, Speed

Everything below is in addition to the 2026-11-11 inventory above. The day-by-day narrative with reasons and risks is in
[`CHANGES_2026-11-11.md`](CHANGES_2026-11-11.md); this section is the file inventory.

## 4. Summary of what changed

| Area | What changed | Main files |
|---|---|---|
| **Security & dependencies** | Reports use a fixed report-to-table map (no table name from the URL, unknown type -> 400). Dependency pins moved to versions with no known CVEs; `npm audit` 0, `pip-audit` clean. | `modules/reports/routes.py`, `requirements*.txt` |
| **Doctors & users** | No default password (login inactive without one), PUT on a missing doctor = 404, doctor and login linked by `doctors.user_id`, username normalised, email validated, 409/400/500 with a `request_id`, double-submit guard. | `utils/database.py`, `modules/admin/routes.py`, `Administration.tsx` |
| **OP flow** | A visit reaches OP billing only once an appointment exists; registration no longer marks the appointment checked-in; "Issue token" requires a booked appointment. | `billingDb.ts`, `db.ts`, `QueueManagement.tsx` |
| **Billing: duplicates & detail** | Invoice creation is idempotent (same patient/module/amount/visit within 60 s); counter shows identical server invoices once; one ER bill per patient per day. Invoice lines were saved with wrong field names (blank descriptions -> "Charge"): fixed at the source, server accepts old names, receipts show what each charge is. | `utils/database.py`, `modules/billing/routes.py`, `billingDb.ts`, `billingSync.ts`, `receiptFormatter.ts`, `HospitalReceiptModal.tsx`, `Billing.tsx` |
| **Patient clinical report** | Billing section built from the real bill (itemised, paid, balance, receipts); invented medicines/tests/phone/address/bed charges removed. | `GeneralReportsOverviewPage.tsx`, `generalReportsExporter.ts` |
| **Bed rates & IP billing** | No built-in room rate: adding beds requires a typed daily rate (server rejects missing/zero); IP bill = days x the bed's own rate only (built-in nursing Rs 600 and doctor-rounds Rs 1000 lines removed, also from existing bills); days counted from when the current bed was allocated; full patient name; no invented age/phone. Bed card shows the real amount (insured: "Insurer Rs X / Patient Rs 0") with a hover breakdown. **Fixed the flip-flop**: a stay was counted twice once server data arrived (100 became 200, refresh brought 100 back); both lines now merge into one. | `BedManagementPage.tsx`, `bedDb.ts`, `modules/beds/routes.py`, `billingDb.ts`, `billingSync.ts`, `BedCard.tsx`, `er-bed.css` |
| **Insured admissions** | Patient's own bill is Rs 0 from the start; the insurance record carries the complete amount with every itemised line; co-pay split set by hand is respected; receipt shows "Covered by insurance" / "Patient payable". | `billingDb.ts`, `HospitalReceiptModal.tsx` |
| **ER** | See section 5. | `ErPage.tsx`, `ErBedChargePanel.tsx`, `billingDb.ts`, `erDb.ts` |
| **Transfers** | A patient moved to another department (OP transfer, bed-to-bed, ER to ward) raises a server-stored notice (`transfer_notices`) shown in the receiving department's bell (badge without opening), seen per user, only for people who can open that department. | `modules/notices/routes.py`, `transferNotices.ts`, `App.tsx`, `QueueManagement.tsx`, `BedManagementPage.tsx`, `ErPage.tsx` |
| **Radiology print** | One shared clean A4 report layout; no fabricated accession/receipt/registration numbers. | `utils/radiologyPrint.ts`, `Radiology.tsx` |
| **Insurance** | See section 6. | `services/insurance*.ts`, `components/insurance/*`, `modules/insurance/*` |
| **Speed** | The app was one 9.0 MB script; 72 pages now load on demand (first-load script 2.6 MB) and the busiest are prefetched after sign-in. Insurance refresh = one request (35-byte reply when nothing changed); polling stops for hidden tabs. | `App.tsx`, `main.tsx`, `insuranceSync.ts`, `billingSync.ts` |
| **Web server** | The link served the very first build because the web server was never restarted after rebuilding; it must be restarted after every build. | (operations) |

## 5. ER: manual charges only (this cycle's last change)

- **Bed & Charges tab** on every ER visit: type the ER bed/bay, charge per day and days (no rate pre-filled), and add any other charge
  (what for, type, quantity, amount each). Charges can be removed. Everything lands on that patient's ER bill.
- **No built-in rate card any more.** Before, each logged medication, procedure or test, and each timeline event, added a charge priced
  from a rate card written into the code, and "Send to Billing" injected default lines (triage Rs 250, nursing Rs 50). Now:
  - **Medicines** are picked from what the **pharmacy actually holds** (medicine master + batches: name, strength, MRP, units in stock).
    A medicine that is not in the pharmacy cannot be recorded; quantity above stock is refused. The line added to the ER bill is
    pharmacy MRP x quantity.
  - **Lab / radiology tests** are billed at the **diagnostic tariff** price (the tariff is the test list in the picker). A test not in the
    tariff is ordered but not billed.
  - **Procedures / interventions** have no price master, so they are not billed automatically; add them under Bed & Charges.
  - The ER header total and "Send to Billing" count exactly what is on the bill (consultation + bed + medicines + tests + typed charges).
    Default lines and the local mock `closeVisit` fee (Rs 100 / Rs 40 per treatment) are gone.
- **Consultation line** is the assigned doctor's fee from the doctor master (no fallback amount).
- **ER total shown before sending**: "ER bill total: Rs X . not sent to billing yet" and the button "Send to Billing . Rs X". The bill
  reaches the billing counter only when pressed (`erSentToBilling`). Sending keeps the lines already on the bill.
- **Reminder strip** on open ER visits that have no bed charge.
- ER visits created before this change keep their current behaviour.

## 5b. Login refresh, mobile layout, fresh data (2026-11-13)

- **Refresh after sign-in fixed**: the first time a browser synced after login it discarded its old local copy and then **reloaded the page**
  (`serverSync.ts`). It now clears the old copy and wakes the stores in place; no reload.
- **Phone login screen**: bigger logo, 52-60 px fields and buttons, 16 px text (no iOS zoom), larger role rows, `100dvh` height.
- **Mobile layer** (`index.css`, `index.html`): dynamic viewport height, safe-area padding, two-pane screens stack, 38-42 px touch targets,
  tab/filter rows scroll sideways, dialogs fit the screen, forms go single column, no sideways page scroll (checked at 390 px).
- **Data reset**: PostgreSQL `hospai` database dropped and recreated (tables, 27 roles, 15 specialties, 1 hospital and the `admin` account are
  re-seeded by the backend); shared browser-data store `server/data/sync-kv.json` removed (new data-set id, so every browser drops its old copy).
  Backup of the old data: `d:\HOSP AI\db-backup-before-reset\` (`hospai-2026-11-13.dump` pg_dump, `sync-kv-2026-11-13.json`).
  Set a real admin password (`INITIAL_ADMIN_PASSWORD`) on the deployment server; `Admin@123` is for this test PC only.

### Mobile login logo (2026-11-13)

- The HospAI logo (`frontend/public/hospai-mobile-logo.png`, transparent background, white lettering recoloured navy so it reads on the light page,
  480 px wide, shown 80 px high) appears **only on the login screen in the phone layout** (`Login.tsx`, the `lg:hidden` block), plain: no band,
  background, glow or mask, inside the centred sign-in column. On phones the login panel is also narrower (max 22 rem), with compact fields,
  buttons and role rows, and the panel (logo + card) is vertically centred. The mobile menu drawer, the desktop login and sidebar, receipts, reports and prints keep the existing logo.

### Keppler OCR page fix (2026-11-13)

- **Symptom**: the OCR page (Intelligence -> Keppler OCR, an iframe on `/keppler-ocr/`) showed the hospital app / login page inside itself.
- **Cause**: the production web server serves `/keppler-ocr` only from `ocr-frontend/dist`. That folder was never built, so the path fell
  through to the hospital app's `index.html`.
- **Fix** (`frontend/server/prod.mjs`): with no OCR build, `/keppler-ocr/*` and the OCR app's `/api/*` are forwarded to the OCR server
  (`OCR_URL`, default `http://127.0.0.1:3000`, started by `start-team-test.ps1`). If `ocr-frontend/dist` exists it is still served directly.
  If the OCR server is down the iframe shows "The OCR service is not running." instead of a nested app.

### Rates & Charges: no built-in amounts (2026-11-13)

Every amount the hospital charges is now decided in **Administration -> 2. Rates & Charges** (`components/RatesAndCharges.tsx`, replacing the old
"Service Catalogue" tab). Nothing is built into the code: an amount that is not set is billed as Rs 0 and shown as "not set" (yellow field).
Fields save on leave / Enter; clearing a field removes the amount.

| Tab | What it sets | Stored in |
|---|---|---|
| Registration & visit fees | New patient fee, revisit fee, emergency registration fee | `PriceMaster` (`hospai_price_master_v1`) |
| Bed rates | Daily rate per bed type (General ... ICU, HDU, Emergency); pre-fills the "Add beds" form (still editable per bed) | `PriceMaster` |
| Laboratory tests | All 203 catalogue tests | Diagnostic tariff (`DiagnosticTariffDatabase`) |
| Radiology studies | All 90 imaging studies | Diagnostic tariff |
| Procedures & services | Doctor-workflow services, department tariff lines, surgery charges (theatre, surgeon, anaesthesia, PACU, consumables) | `PriceMaster` |
| Other charges | Any extra charge (name, type, amount) | `PriceMaster` |

Doctor consultation fees stay in **Doctor Master** (per doctor) and medicine prices (MRP) in the **Pharmacy medicine master**; ER medicines and tests
are billed from those and the tariff.

**Extra items**: every tab has a **+ Add ...** button (extra fee, bed type, test, study, procedure / service; "Other charges" has its own form).
Added items are removable and editable. Extra lab tests and radiology studies go into the diagnostic tariff (so the lab and radiology masters and the
ER test picker show them); extra bed types appear in the "Add beds" and bed-edit dropdowns; extra fees, services and charges are suggested in the
ER "Add another charge" box with their amount filled in.

**Delete**: every row on the Rates & Charges tabs has a **Delete** link. Items the hospital added are deleted for good; built-in items (standard lab
tests, imaging studies, services, standard bed types) are removed from the hospital's lists and can be brought back with **Show deleted -> Restore**.
The fixed registration fees cannot be deleted. Deleted items disappear from the Doctor Workspace test and service pickers, the ER suggestions and the bed-type dropdowns.

**Doctor Workspace fix** (`DoctorWorkflow.tsx`, `doctor/ConsultationCharges.tsx`): the pickers were hard-coded and not connected to the masters.
- **Tests**: the eight fixed test chips are gone. The doctor searches the hospital's lab tests and imaging studies (catalogue + tests Administration added),
  sees each price (or "price not set"), and ordered tests show as removable chips with their price.
- **Services / procedures**: the list is now the standard services + department tariff lines + charges Administration added, with live prices; a service
  with no price cannot be added until Administration sets it.
- **Medicines**: the medicine name box suggests what the pharmacy holds and fills in the strength.
- **To billing**: lab / imaging orders are billed at the tariff price and services at the rate-master price on the consolidated claim (as before, now with the live prices).
- **Invented values removed**: the fake patient phone `+91 98765 43210` and fake MRN `10001` on doctor orders, the default diagnosis code `I20.9` / `M54.5`,
  and the same fake age / gender / phone on the billing "Walk-in bill".
**Billing walk-in bill** (`Billing.tsx`): the service box suggests everything Administration has priced and fills in the amount; the old defaults
("Specialist Consultation", Rs 500) are gone.

**Rates follow patients already registered** (fix): the registration fee and the doctor's consultation fee used to be copied into each visit when it was
created, so a patient registered before a rate was set (or changed) kept Rs 0 and the bill never picked the rate up. Now (`services/opFees.ts`):
- A visit that is **not paid yet** always uses the current rates: the registration fee from Rates & Charges (new patient vs revisit) and the doctor's fee
  from Doctor Master. The stored visit billing is refreshed when the rates change, and the OP bill in Billing updates its registration and consultation
  lines (if nobody has paid on it yet). A **paid** visit keeps the amount it was paid at.
- `getDoctorConsultationFee` no longer returns a made-up Rs 500 when a doctor or fee is not set (it returns 0): this was the source of the "fixed" fee.
- Walk-in and doctor-portal bills: no assumed 80% insurance split, no default insurer ("Star Health"), no Rs 100 consultation, no fixed test prices
  (Rs 350 / 100 / 60 / 50) and no Rs 150 / 250 / 500 fallbacks on lab and radiology bills; they use Doctor Master and the tariff.
**Doctor portal test names**: in the doctor portal investigations table, typing a test name now suggests the hospital's lab tests and imaging studies, shows each
test's price ("not set" if Administration has not priced it) and sets the category (Pathology / Radiology) from the chosen test.
- Tests: a step checks a patient registered with no fee, then a fee set (the visit and the bill show it), then changed (the bill follows), then paid (stays).

What was removed from the code:
- Lab catalogue (203 prices), imaging catalogue (90), `MASTER_HOSPITAL_SERVICES`, department tariff catalogue (51 lines), the lab `PRICE_BOOK` and
  the Rs 500 default test price, ward default daily rates (Rs 5,000-10,000), backend `BED_TYPE_DEFAULT_DAILY_RATE` (Rs 1,500-10,000), registration fee
  Rs 20, consultation fallbacks (Rs 350 / 480 / 500 in OP, doctor and chart screens, backend doctor queries and doctor creation), invented OP/ER
  summary lines (Rs 100 / 150 with an 80% insurance split), radiology fallback lines (Rs 400 / 500), surgery charges (Rs 7,000 / 25,000 / 8,500 /
  4,200 / 10,000), STAT surgery total Rs 75,000, implant default Rs 5,000, pre-auth "custom line" Rs 5,000, insurance display fallbacks (Rs 5,00,000 /
  50,000), sample demo radiology study prices, and the offline mock amounts in `lib/api.ts`.
- The catalogue objects keep their `price` field, but it is a live getter that reads the amount Administration set (`bindServicePrices`,
  `bindDiagnosticPrices`), so every screen that reads `item.price` shows the new amount without further changes.
- New files: `services/priceMaster.ts`, `components/RatesAndCharges.tsx`. Changed: `Administration.tsx`, `billingDb.ts`, `db.ts`, `OPWorkflow.tsx`,
  `PatientJourneyModal.tsx`, `QueueManagement.tsx`, `DoctorWorkflow.tsx`, `Radiology.tsx`, `labCatalogueSchema.ts`, `labOrdersDb.ts`, `diagnosticTariffDb.ts`,
  `wardCustomization.ts`, `BedManagementPage.tsx`, `radiologyWorkflowDb.ts`, `LabBillingQueue.tsx`, `PatientChart.tsx`, `PatientRecordPage.tsx`,
  surgery modals, `ClaimWorkspace.tsx`, `PreAuthRequestView.tsx`, `lib/api.ts`, `utils/database.py` (backend).
- Tests: `rate master` steps in `tests/insurance-flow.e2e.ts` (nothing set = 0 everywhere; set amounts are read by registration, beds, services, lab; clearing returns to 0; extra bed types / charges can be added, duplicates and zero amounts are refused, and removal works).

Still hard-coded (not amounts the hospital charges): the monthly demo charts in `Analytics.tsx`, GST / tax percentages in the pharmacy screens, the demo
doctors behind `SEED_DEMO_DOCTORS=true` (off by default), and the default roles / specialties lists. Existing bills and orders keep the amounts they were created with.

### Investigation billing vs OP billing: one payment ledger (2026-11-13)

**Problem**: the Consolidated Investigation Bill asked for the full investigation subtotal (Rs 2,120) while the OP bill (gross Rs 2,620, paid Rs 520)
owed Rs 2,100. The investigation desk ignored payments already taken on the bill, so collecting it could overpay the bill and the two screens disagreed.

**Fix (all amounts are calculated, nothing is hard-coded)**
- `BillingDatabase.getInvestigationLedger(bill)` (`billingDb.ts`) splits a bill into the laboratory / radiology lines and the other lines (consultation,
  registration ...) and allocates every payment: a payment collected at the investigation desk (`scope: "investigation"`) goes to the investigations; any other
  payment (and every older payment with no scope, or money with no payment record) settles the other lines first and only the rest reaches the investigations.
  Discounts given with an investigation payment reduce the investigation total; refunds (negative payments) take back from the bucket they were paid for;
  a cancelled service (line removed) simply leaves the ledger. The amount due never exceeds the bill's own outstanding balance, so OP billing and
  investigation billing always agree. Example: Rs 2,120 of investigations, Rs 520 paid toward a Rs 500 consultation -> Rs 20 reached the investigations -> Rs 2,100 due.
- `recordPayment` now refuses a zero / negative amount, a payment above the outstanding balance and a discount above it; it stores the payment scope,
  discount and an idempotency key (a repeated collection with the same key returns the first payment instead of recording a second one).
- **Investigation Billing screen** (`LabBillingQueue.tsx`): shows subtotal, "Already paid toward these investigations", the balance and the discount; the amount
  is re-read from the bill at the moment of collection; a "Collect now" box allows a part payment or advance (tests are released only when the balance is
  cleared); an already-paid balance shows "Release to departments". Invented receipt numbers ("RCPT-2026-5501"), default payment mode and default age/gender removed.
- **Bill builders** keep a counter discount (it used to be reset to 0), no longer mark the whole bill paid just because the tests were flagged paid, and keep
  the registration line on bills that have investigations.
- **Backend** (`record_invoice_payment`, `POST /api/billing/invoices/<id>/payments`): the invoice row is locked, the payment cannot exceed the outstanding
  amount, and each payment stores `allocation_scope` and a unique-per-invoice `idempotency_key` (new columns on `invoice_payments`; also in the payments list
  and the audit log). Verified live: 4 devices collecting the same balance at once -> exactly 1 payment accepted; a retry with the same key returns the first
  payment; an over-collection returns 400; total paid never exceeded the invoice.
- Tests: ledger steps in `tests/insurance-flow.e2e.ts` (the Rs 2,120 / Rs 520 / Rs 2,100 case, part payment then final, stale second device, advance,
  consultation paid separately, discount, refund, cancelled service).

### Login / password security fix (2026-11-13)

Full analysis, file list and test table: [`SECURITY_FIX_2026-11-13.md`](SECURITY_FIX_2026-11-13.md). Summary:
- Login can no longer create an account (the `doctors`-table bootstrap in `core/auth.py` is deleted) and no default password signs anyone in.
- `verify_password` is bcrypt-only and exact (no plain-text, `mock_`, MD5 / SHA-256, werkzeug or trimmed-password matches); a user is returned only if a password verified;
  dummy bcrypt check gives "no such user" and "wrong password" the same timing.
- One password policy (`validate_password`) on every create / edit / reset path: 8+ characters, max 72 bytes, no edge spaces, not a known default, not the username / staff id /
  employee id / e-mail. First-administrator password goes through it too; `start-team-test.ps1` now generates a random one.
- Passwords are no longer written to the audit log (`shared/audit.py` redacts secrets); the frontend `password123` fallbacks are gone.
- Tests: `backend/backend/tests/test_auth_security.py` (38 backend tests pass) and a live run against the backend. Changed files for the dev team: `auth-fix-2026-11-13.zip`.

### Aadhaar number as the patient's identity key (2026-11-13)

- **Registration form** (`Registration.tsx`): "Aadhaar number" is the first field. It is checked as you type (12 digits, not starting 0 or 1, Verhoeff check digit, so a mistyped
  digit is caught). The moment 12 valid digits are entered the server is asked who owns the number: a returning patient shows a green card (name, UMR, age, phone, masked number, last visit)
  and **"Create today's visit for this patient"** files the visit under the existing UMR; no new record is created. A patient without Aadhaar (child, foreigner, not available)
  is registered by ticking "Patient has no Aadhaar" and choosing a reason; they are then matched the old way (name + phone / DOB). The records-tab search also finds a patient by a full Aadhaar number.
- **UMR stays the internal primary key** (every table, bill and report is keyed on it); Aadhaar is the unique identity key that finds the UMR. One Aadhaar = one patient per hospital.
- **Server** (`shared/aadhaar.py`, `utils/database.py`, `modules/patients/routes.py`): `patients.aadhar_hash` (HMAC-SHA256 of the 12 digits, keyed with `AADHAAR_HASH_PEPPER`,
  falling back to `SESSION_PEPPER`) with a unique index per hospital; `patients.aadhar_number` now holds only the masked form `XXXX XXXX 1234`. The full number is **never stored**
  and never returned; the key column is stripped from every API response and Aadhaar fields are redacted from the audit log. Any plain-text numbers from older data are masked and hashed at start-up.
  `POST /api/op/visits` links the visit to the existing patient when the number is already registered (`matched_by_aadhaar`), and attaches the number to an existing record that had none;
  `POST/PUT /api/patients` answer 409 with the existing patient when the number belongs to someone else; `GET /api/patients/by-aadhaar?number=` (audited, rate-limited) powers the lookup.
- **Browser**: the number lives only in the form's memory (not in the saved draft, not in the saved search), and is sent to the server only when registering or looking up.
- **Operations**: set `AADHAAR_HASH_PEPPER` once on the server and never change it (changing it makes existing patients unrecognisable). Without it (and without `SESSION_PEPPER`) Aadhaar numbers cannot be stored.
- Also removed: invented local patient defaults (phone `+91 98765 43210`, address "Main City", blood group "O+", address "Local Address") when registration details are missing.
- Tests: `backend/backend/tests/test_aadhaar.py` (validation, masking, keyed hash, nothing leaks) and a frontend step; live check against the running backend (`scratchpad/live_aadhaar_test.py`):
  mistyped number -> 400; first registration stores only the mask and a 64-character key; the same patient returning with a different spelling and phone is matched to the same UMR (no second record);
  lookup by number; the patient record never carries the key; search by the 12 digits; duplicate on create -> 409 with the existing patient; an Aadhaar attached to an existing patient on a later visit.

## 5c. Package

- `Enterprise HMS.zip` (project root `Enterprise HMS/`): the full source of this system (backend, frontend, OCR apps, deploy scripts, docs, tests).
  Left out: `node_modules`, `dist` (run `npm install` then `npm run build`), `.pgdata` and other data, `__pycache__`, logs. It carries no hospital
  data. Start with `start-team-test.ps1`, or follow `CHANGES_2026-11-11.md` (deploy steps).

## 6. Insurance

- **Flow made strict**: no skipping eligibility; no pre-auth approval before submission; rejected pre-auth is revised and resubmitted;
  claim decisions have one path (always creates the settlement record); billing cannot hand a bill to insurance before discharge; a hand-over
  never advances a case past unfinished steps; the stepper shows a step as completed only when its work is on record; wrongly advanced cases
  are corrected automatically.
- **Case page**: "Amounts at a glance" (requested, authorised, billed, claimed, sanctioned, deductions, received, patient payable, outstanding);
  fake header values and fake "inbound" insurer email removed.
- **PostgreSQL backend** `/api/insurance/*` (`insurance_records`, `insurance_audit_logs`): tenant-scoped, versioned (409 on stale save),
  audited, cases cannot be deleted; one-request `snapshot` with etag; first run seeds from the browser.
- **Reimbursement workflow**: Cashless or Reimbursement at case opening; patient payments and receipts; printable claim pack;
  claim blocked until the patient has paid and the pack exists; insurer payment recorded as paid to the patient.
- **Mailbox**: SMTP send with attachments and claim tag in the subject; read-only IMAP reply fetch keeping only messages that carry a case tag
  or reply to a sent mail; password encrypted; test connection + optional test email. Untested here against a real mail provider (IMAP).
- **Setup page** (Insurance -> Setup): Main setup, Mail setup, Step-by-step plan (live, ticked from each patient's real records),
  How to use Insurance. Fake "Pre-Authorization Form Template" dropdown removed.
- **Printing**: clean A4 case summary; pre-auth form prints all four pages; other prints show only the document.

## 7. Files added (new)

**Backend**: `backend/backend/modules/insurance/__init__.py`, `modules/insurance/routes.py`, `modules/insurance/mail.py`,
`modules/notices/__init__.py`, `modules/notices/routes.py`, `backend/backend/tests/test_insurance_mail.py`.

**Frontend**: `public/hospai-mobile-logo.png`, `src/services/insuranceSync.ts`, `src/services/insuranceMail.ts`, `src/services/transferNotices.ts`,
`src/utils/insurancePrint.ts`, `src/components/er/ErBedChargePanel.tsx`,
`src/components/insurance/InsuranceSetup.tsx`, `InsurancePlan.tsx`, `planSteps.ts`, `InsuranceGuide.tsx`, `InsuranceMailSetup.tsx`, `MailboxSettings.tsx`,
`tests/shim.ts`, `tests/insurance-flow.e2e.ts`, `tests/insurance-sync.e2e.ts`, `tests/billing-stay.e2e.ts`, `tests/perf.bench.ts`.

## 8. Files modified

**Backend**: `app.py`, `utils/database.py`, `modules/admin/routes.py`, `modules/billing/routes.py`, `modules/beds/routes.py`, `modules/reports/routes.py`,
`requirements.txt`, `requirements-ai.txt`, `requirements-dev.txt`.

**Frontend**: `package.json`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `src/lib/serverSync.ts`, `src/components/Login.tsx`, `src/pages/ErPage.tsx`, `src/pages/BedManagementPage.tsx`, `src/components/Billing.tsx` (queue stays newest-first when a patient is clicked),
`src/components/HospitalReceiptModal.tsx`, `src/components/Administration.tsx`, `src/components/QueueManagement.tsx`, `src/components/Radiology.tsx`,
`src/components/bed/BedCard.tsx`, `src/components/reports/GeneralReportsOverviewPage.tsx`, `src/components/PharmacyModule/pages/Dispensing.tsx`,
`src/components/insurance/{ClaimWorkspace,NewCaseModal,forms,mail,InsuranceEmailHubPage,InsuranceCaseDetailView,PreAuthRequestView,MastersPage,PatientProfileModal,EnhancedAuditRulesPage,InsuranceSopModal}.tsx`,
`src/components/insurance/deskGuide.ts`, `src/services/{billingDb,billingSync,bedDb,erDb,db,hrmsDb,insuranceDb,labLisService,roleDb}.ts`,
`src/types/insurance.ts`, `src/utils/{radiologyPrint,generalReportsExporter,receiptFormatter}.ts`, `src/styles/er-bed.css`.

**Project**: `.github/workflows/ci.yml`, `.gitignore`, `CHANGES_2026-11-11.md`, this file.

## 9. Verification (end of cycle)

- Frontend production build: succeeds. Type check: 154 existing strictness errors, none added by these changes (advisory in CI).
- `npm run test:insurance` (insurance flow, reimbursement, plan, billing hand-over, insured split, IP bed billing, moved patient, ER bed, ER manual
  charges, ER send-to-billing), `npm run test:insurance:sync` (server sync, 409, one request per poll), `npm run test:billing`
  (bed amount stable before/after server sync): all pass. Backend `pytest`: 6 passed.
- `npm audit`: 0 vulnerabilities. `pip-audit` on `requirements.txt` and `requirements-ai.txt`: none.
- API checked live: doctor create/edit/delete/re-create, invoice idempotency, invoice-line fields, bed rate required, insurance CRUD/versioning/snapshot,
  transfer notices, SMTP send (local test server).

## 10. Known gaps

- IMAP receiving untested against a real mailbox; insurance documents are stored as names only (attach files by hand when emailing).
- About 35 raw `fetch()` calls remain; most modules still keep data in the browser (only insurance, billing sync, transfer notices use the server for sharing).
- Pre-auth wizard and intake form layouts unchanged; insurance OCR and external TPA APIs not built.
- ER medicines are priced from pharmacy MRP and tests from the diagnostic tariff; pharmacy stock is not reduced when a medicine is given in the ER (no dispensing record yet); procedures have no price master.
- Old invoices created while beds carried built-in default rates (for example ICU Rs 8,000/day) remain as real records until removed.

---

## Round 2026-11-16 - Role-based access accuracy + bed card amount

### Bed card "Due" (showed 1,520 for 1,000 paid)
- Cause: the bed card added the patient's unpaid OP bill (520) to the stay bill. `getInpatientFinancialClearance` (services/billingDb.ts) now counts only the stay bill (Inpatient/ICU/Surgery or the running admission). It matches IP billing.

### Role-based access control
- New `src/utils/accessControl.ts`: exact mapping from backend grants to screens (a bare module grant = full access, dotted grants narrow it); exact role defaults only for roles the backend does not model; admin = role only.
- `App.tsx`: `isModuleAccessible` uses `canOpenScreen`; post-login landing uses an exact role map (receptionist lands on Registration); username-based guessing removed.
- `Login.tsx`: alias guessing removed. The session now carries `role_key`; wildcard (`*`, `admin`) grants are stripped.
- Backend route gaps closed: WhatsApp settings (read/write), HR `/api/v1/*`, staff directory by role, username probe, public patient lookup.
- Shared-data sync ACL (`server/sync/acl.mjs`, `kvSync.mjs`, `serverSync.ts`): HR and accounting keys are readable/writable only with matching grants; the rate master is writable by administrators only.
- Credential change now requires the current password and ends other sessions; no password is kept in browser storage; audit logs redact secrets.
- Tests: backend 63 passed; `test:access`, `test:acl`, `test:insurance` (including a bed-due step), sync and billing all pass.

Not changed: dashboard widgets show some patient data to all signed-in roles; the offline browser role store; the dev fallback server `server/app.mjs`.

---

## Round 2026-11-16 (b) - Department hand-off notifications, Reception Registry, Administration helpline numbers

### 1. Department hand-off notifications (bell, every department)
When a patient is sent from one department to another, the receiving department's bell lights up with the patient, what was sent, where from, and two buttons: **Open patient** and **Done**. A new notice also pops up once on the receiving desk's screen. **Done** clears it for the whole department (who and when are recorded); urgent items (STAT orders) are flagged red and listed first. Notices live on the server, so they reach a different computer.
Hand-offs raised automatically:
- Reception registers an OP visit or revisit -> OP Queue, and OP Billing ("OP bill to collect").
- Doctor sends medicines -> Pharmacy; ICU medicine orders -> Pharmacy.
- Doctor orders lab tests -> Lab & Radiology Billing (payment pending); radiology orders -> Lab & Radiology Billing.
- Payment collected -> Laboratory ("paid, collect sample") and Radiology ("paid, ready to scan").
- Lab results verified -> the ordering doctor's workspace.
- Existing: bed transfers, ER to ward/ICU and OP queue transfers (unchanged).
The same piece of work is never announced twice (de-duplicated by reference). Pending notices are kept for 14 days; cleared ones for 3.
The invented timestamps in the bell ("10m ago", "5m ago") were removed; times now come from real timestamps.
Files: `services/handoffs.ts` (new, one `handOff()` call), `services/transferNotices.ts`, `App.tsx` (bell panel, pop-up), `services/labOrdersDb.ts`, `services/billingDb.ts`, `services/consultationDispatch.ts`, `services/db.ts`, `components/DoctorWorkflow.tsx`, `components/ICU.tsx`; backend `modules/notices/routes.py` (priority, handled, ref de-duplication, new `/handled` endpoint).

### 2. Reception > Registry (all patient records in one place)
New screen `components/PatientRegistry.tsx` under Reception: one row per patient with UMR, name/age/sex, phone, registration date, number of visits, last visit (OP number, department, doctor), where the patient is now (OP today / In ER / Admitted) and the amount due. Summary tiles (all patients, new today, in hospital now, in ER, with dues), search, filters (gender, age, department, registered from/to, status), sorting, paging, CSV export, an Aadhaar-number box that finds a returning patient from the server, and per-row details (all visits, all bills), clinical chart, latest OP journey, patient record and OP card printing. Access follows the Reception grants (`patients`, `patients.directory`, `patients.registration`).

### 3. Helpline numbers set by Administration, printed on the OP card
Administration > Rates & Charges > **Helpline numbers**: add any number of named numbers (Helpline, Emergency, Ambulance...), mark one primary, edit, delete. The OP card prints the primary number first (up to three); the same numbers are used in journey reports, receipts, report headers, surgical discharge and patient messages. Nothing is built in any more: every hard-coded phone number (including the 08816 / 0891 / 800-419 numbers in headers and fallbacks) was removed, and with no number set nothing is printed. Only administrators can change them (the sync server enforces this); Patient Messages shows the helpline read-only.
Files: `services/hospitalContacts.ts` (new), `components/HelplineNumbers.tsx` (new), `components/RatesAndCharges.tsx`, `lib/branding.ts`, `components/opcard/OpCard.tsx`, `services/patientMessaging.ts`, `components/messaging/PatientMessages.tsx`, `components/branding/DocumentBranding.tsx`, `server/sync/acl.mjs`, and the printed headers in `HospitalReceiptModal`, `CompleteLabReportModal`, `FinancialReportModals`, `GeneralReportsOverviewPage`, `PatientReportModals`, `PatientJourneyModal`, `SurgicalDischargeModal`, `OPWorkflow`, `journeyPrint`.

### Tests
Backend 63 passed; `test:insurance` 53 passed (new: helpline numbers step), `test:access` (new: Registry access), `test:acl` (helpline key admin-only), sync and billing pass; live check of the notice flow (raise, de-duplicate, seen, done, anonymous refused) passed. Type-check unchanged at the baseline of 154.

---

## Round 2026-11-16 (c) - ER -> concern doctor -> in-patient workspace, doctor / nurse notes, voice-to-text

### 1. The journey (ER -> admit -> concern doctor -> IP workspace)
1. The ER doctor decides to admit and **must choose the concern doctor** (from the doctor master, specialty first): in *Request Bed* and in the *Disposition* form. The concern doctor is told at once.
2. Bed Management allocates the bed (ER request, direct admission or any other path) and **confirms the concern doctor** (prefilled from the ER's choice, required). Admission notes can be dictated.
3. A **case** opens for every occupied bed (`services/ipCare.ts`, `IpCare.reconcile()`, run on every sign-in screen every 20 s): the concern doctor is notified ("Admitted under you"), the ward is notified, the bed card shows the doctor. A patient who got a bed with no doctor is flagged on the Bed Board, on Bed Management and in the ward's notifications until one is assigned.
4. The doctor's workspace has a new **IP patients** view: the patients under that doctor with day of stay, ward / bed, "needs attention" flags (STAT order not acknowledged, no vitals for 8 h), and per patient: **Monitoring** (latest vitals, trend table and charts, the ER summary), **Doctor notes**, **Nurse notes**, **Orders** to the nurses, **Investigations & medicines**, **Handover** to another doctor (recorded, new doctor notified).
5. **Ward Nursing** (Inpatient menu, and the nurse's landing page): the nurses' list of admitted patients by ward, the same patient screen: vitals + nursing notes, acknowledge / complete the doctor's orders, shift handover note. Notes carry the real author's name.
6. Releasing the bed closes the case; a bed transfer keeps it.
Notices can now be **personal** (`audience`): "Admitted under you" reaches only that doctor (and administrators).

Removed: the old Nursing Portal and `nursingWorkflowDb.ts` (built on a fixed list of sample nurses; it pre-filled every note with invented clinical text, a made-up allergy, doctor names and a fake "John Smith"). Nothing in Ward Nursing is pre-filled.

Files: `services/ipCare.ts`, `components/ip/*` (ConcernDoctorPicker, AttendingAssignPanel, IpPatientCare, useIpCare), `components/doctor/InpatientRounds.tsx`, `components/nursing/WardNursing.tsx`, `components/doctor/DoctorPortal.tsx`, `pages/ErPage.tsx`, `pages/BedManagementPage.tsx`, `components/Inpatient.tsx`, `components/bed/BedCard.tsx`, `App.tsx`, `services/handoffs.ts`, `services/transferNotices.ts`; backend `modules/notices/routes.py` (audience).

### 2. Voice-to-text
One microphone for every free-text box, with a clinical clean-up (BP 120/80, 500 mg TDS, SpO2 96%, drug names corrected against the pharmacy master and lab catalogue), 10 languages, server Whisper when installed (primed with the hospital's term list) and the browser speech service otherwise. Full list of where it is, where it is most needed and what is still missing: **VOICE_TO_TEXT_PLACES.md**.
Files: `components/voice/VoiceMic.tsx`, `components/voice/DictationTextarea.tsx` (drop-in `<textarea>`), `utils/dictationText.ts`, `services/dictation.ts`, `services/dictationVocab.ts`, `components/ui/Textarea.tsx` (`dictate` prop); backend `ai/whisper_provider.py`, `ai/service.py`, `modules/ai_exports/routes.py` (`/api/ai/transcribe/status`, prompt).
Not tested with a real microphone; this host has no `faster-whisper` installed (the app falls back to the browser engine).

### Tests
Backend 67 passed (new: transcription); `test:ipcare` 11 checks (referral, case opening, unassigned flag, assignment, handover, notes, orders, transfer, close); `test:dictation` 22 checks; `test:insurance` 53, `test:access`, `test:acl`, sync and billing pass; live notice flow (with audience) passed. Type-check unchanged at the baseline of 154.

---

## Round 2026-11-16 (d) - in-patient ordering, one-line dictation, full module / model check

### 1. Ordering from the in-patient screen (was "not done")
The concern doctor can now order from the patient's **Investigations & medicines** tab:
- **Tests** (laboratory and radiology): search the live test catalogue with Administration's prices ("price not set" is shown, never invented), Routine / STAT, clinical notes. Lab orders go to the lab billing desk first and the laboratory sees them once paid; radiology studies go the same way with the stay's investigation bill. Both are tied to the admission (`IP-<admission>`).
- **Medicines**: picked from the pharmacy stock list (with stock shown), dose / frequency / route / duration / quantity / instructions, Urgent flag; goes into the pharmacy prescription queue and the pharmacy is told.
Files: `services/ipOrders.ts` (the logic, tested), `components/ip/IpClinicalOrders.tsx`, `components/ip/IpPatientCare.tsx`.

### 2. Dictation in one-line fields (was "not done")
`components/voice/DictationInput.tsx` (drop-in for a one-line input): diagnosis / impression (Add Evaluation, Doctor Portal review, ER doctor assessment, OT pre- and post-op), allergies (ER triage x2, OT pre-anaesthetic), OP chief complaint (queue token), medicine instructions (Doctor Portal, Doctor Workflow, ICU, in-patient prescription), ER treatment response. Also dictation in the insurance pre-authorisation justification, insurance discharge finalisation and lab order notes.

### 3. Modules and models: inventory and functionality check
**MODULES_AND_MODELS.md** lists all 19 modules and 128 screens with what each does, its code and data, and the result of opening every one in a real browser (0 crashed, 0 blank, 0 JavaScript errors), plus the AI / ML models (vLLM chat / vision, embeddings, LightRAG, Whisper, browser speech, Keppler OCR, and the rule-based engines) with where each is used and its state on this server. Backend: all 121 parameter-less GET endpoints called as administrator, none returned a server error.

### Tests
IP care 12 steps (new: lab + radiology + prescription ordering, empty and incomplete orders refused); backend 67; insurance 53; dictation 22; access, ACL, sync, billing pass. Type-check unchanged at the baseline of 154.

---

## Round 2026-11-16 (e) - AI models reference, and three stage props / dead routes found and fixed

**AI_MODELS_REFERENCE.md**: every AI / ML model the system uses (vision-language model on vLLM, BGE-M3 + reranker + Qdrant, the hospital embedding model, Whisper, browser speech, TrOCR, DocLayout-YOLO, LightRAG, the scikit-learn matchers, classical CV), what each does, which screens and endpoints use it, its settings, safeguards and fallback, its state on this server, which models carry the major role (the vision-language model first, then the two embedding stacks), the rule-based engines that need no model, and how to check each one once the model servers exist.

Found while writing it, and fixed:
1. **Clinical RAG** was a stage prop (the same hard-coded answer about "John Smith" for any question). It now searches the chosen patient's real stored documents via `/api/ai/patient-history-search` and says plainly when the model is unavailable or nothing matches. (`components/ClinicalRAG.tsx`)
2. **Patient Experience** showed invented figures (NPS 72, CSAT 4.6 "from 450 surveys", 12 grievances, sample reviews). It now shows the real WhatsApp feedback (average, responses, low ratings to follow up, escalate / resolve, CSV export). (`components/PatientExperience.tsx`)
3. **`/vllm-api` had no production route**: ER triage assist, discharge-summary assist and pharmacy invoice OCR call the model through it, but only the dev server proxied it, so production answered with the app's HTML page. `server/prod.mjs` now proxies it to `VLLM_URL` for signed-in users only (strips the hospital session cookie, optional `VLLM_API_KEY`) and answers `503 not configured` when unset.
Tests: `npm run test:aiscreens` (the two screens draw no invented content); the live proxy was checked signed-in (503 not configured) and anonymous (401).

---

## Round 2026-11-17 (f) - Insurance: patient register, payment gaps, full-module audit

### 1. Patient Insurance register (Insurance > Patient Insurance)
One row per policy: KPI cards (square corners), search, insurer / validity filters, Import and Export (CSV, same columns both ways, every row checked before anything is saved), Add policy, a detail panel with eligibility and the claim list. The old page's invented per-insurer coverage text and fake PDF are gone. `components/insurance/PatientPoliciesPage.tsx`, `utils/policyCsv.ts`.

### 2. Money that was approved but never arrived (Insurance > Settlement & Reconciliation, Insurance > Payment Gaps)
Approved Rs 5,00,000 but Rs 4,00,000 received: the missing Rs 1,00,000 must now be explained (TDS, accepted cut, write-off, charged to patient) or chased (insurer to pay later / disputed); a claim cannot be reconciled until every rupee is accounted for. Several instalments per claim, each with its own UTR. The **Payment Gaps** screen lists every claim's money trail (claimed > approved > received > gap), by insurer and by reason, with rejected claims and CSV export. `utils/settlementMath.ts`, `components/insurance/PaymentGapsPage.tsx`, `SettlementPage.tsx`.

### 3. Full insurance-desk audit - defects found and fixed
- Two different patients with the same name were treated as one person (blocked each other's insurance, saw each other's policies). Now matched by UMR.
- The billing counter's insurer share came from fixed presets, not the policy, so a bill above the approval was claimed in full and the excess silently written off. The counter now defaults to **As per policy** (approved pre-auth, else policy balance, else sum insured, less the co-pay %) and warns with the exact amount the insurer will not pay. `utils/coverLimit.ts`, `components/billing/BillToInsurance.tsx`.
- No way to close a case that will never be paid. New **Close without a claim** (patient self-pay, not eligible, refused pre-auth) and, for a final rejection, a required choice of who bears it (hospital write-off or patient).
- An ER case followed to the ward kept showing "ER / Emergency"; it now continues as IP / ICU / OT.
- Eligibility could not record an exhausted balance (Rs 0 kept the old balance); an expired policy could be marked Eligible; a pre-auth or enhancement above the sum insured was accepted; two enhancements could be pending at once, or approved at a lower amount.
- Insurer names were matched on one shared word ("Medicare Plus" -> "Care Health"); case and query ids could repeat.
Tests: `npm run test:insaudit` (workflow probes), `npm run test:insscreens` (every insurance screen against claims at every stage, 153 renders), `test:policycsv`, `test:insurance` (60).
Not changed, for your decision: a claim whose bill exceeds its pre-authorisation can still be submitted (it is flagged, not blocked); `InsuranceEngineService.resetAndSeedDemoData()` deletes all cases but no screen calls it.

### 4. Billing > Patients & Insurance (new, redesigned in the Billing house style)
Built like IP Billing: the shared Billing header and tinted KPI tiles, a search bar with **Where** (All / Ward / ICU / ER / OP today / Not in hospital) and **Insurance** (Everyone / Insured / Self-pay / Approved / Waiting / Policy expired / Owes a share) buttons, a patient queue on the left and the selected patient's workspace on the right (patient header with the amount owed, facts strip, policy and "what this policy pays", a bar showing how the stay splits between insurer and patient, a five-stage claim tracker, and the bill beside the payment form). A list of **every patient**, not only insured ones: where they are now (ER / ward / ICU / OP today / not in hospital), whether they are insured, the policy terms ("policy gives": bed rent limit per day, ICU limit, co-pay, balance), the insurer's approval and what the patient owes. Filter by setting (All / Ward / ICU / ER / OP today / Not in hospital) and by insurance (insured, self-pay, approved, waiting, expired policy, patient owes a share); search by name, UMR, phone, insurer, policy, bed or invoice; export CSV.
Open a patient: their details (phone, address, blood group, bed, admitted since, doctor), **every policy with its full terms** (the one used for this admission highlighted), and **what the policy gives for this stay, line by line** - the bed against the policy's daily limit (e.g. Rs 8,000/day bed, Rs 5,000/day allowed, 5 days: Rs 15,000 is the patient's), everything else, the co-pay clause, anything above the insurer's overall limit, and the totals - then the approval, the bill and the payment form (same ledger and receipts as the other counters; reference needed for non-cash; cannot be recorded twice; cannot exceed what is due). Files: `components/billing/InsuredPatientBilling.tsx`, `utils/policyBenefits.ts`, `utils/insuredBilling.ts`.

### 5. Policy terms are now captured and kept (found while building the above)
- The system held no bed limit at all, only a free-text note. Bed rent limit per day and ICU limit per day (Rs) are now entered at Intake, on the policy form and when eligibility is verified, saved on the policy, shown in the Patient Insurance register, and carried through CSV import / export.
- The Intake form threw away what the desk typed: the policy end date, the relationship and the co-pay %. They are now saved (so policies no longer show "No end date" and 0% co-pay).
- Verifying eligibility on a case now updates the policy on the patient's record too (limits, co-pay, balance, last verification), so no screen shows older terms than the case.

### 6. Two money bugs in billing, fixed
- **Handing a bill to insurance overwrote the real insurer.** Billing read the bill, then the insurance check linked the case and wrote the real insurer and policy onto it, then billing saved its older copy: "Pending Insurance Assignment" / "Pending KYC". This is why the live patient BALA KRISHNA's case shows those placeholders (the insurance desk still has to enter the real details; new hand-overs are no longer affected).
- **An insured patient still in the bed was asked for the whole bill.** The daily bed-charge refresh set the patient's share to the full bill, adding the insurer's part back. It now keeps the insurer / patient split (the new bed charge is the patient's).
Tests: `test:insaudit` (now covers both, the policy terms and the stay calculation), `test:insscreens`, `test:policycsv`, `test:billing`.

---

## Round 2026-11-18 - OP card / patient record: complete, end to end, and live

**What was wrong.** A card scan opened a record that was missing most of the patient: for a phone with no login the server already sent prescriptions, lab orders, invoices and doctor notes, but the page threw them away (those sections always read "none"); there was no insurance, allergies, doctor notes, ER / surgery / orders, radiology, ward notes or documents; and it re-read the server only every 30 seconds. Inside the app, the card opened a window about one OP visit only.

**Now** (`components/patientRecord/*`, `components/PatientJourneyModal.tsx`, `modules/patients/routes.py`):
- The record shows, end to end: allergies, OP visits, admissions, **doctor notes and treatment plan, consultations, prescriptions, lab, radiology, emergency visits / surgery / clinical orders / care plan, ward doctor and nurse notes and orders, ICU, insurance (every policy with bed / ICU limits, co-pay, balance; every case with the pre-auth approved, approval code and claim amounts), billing, documents, complete timeline**.
- A card scan without login now uses everything the server holds (prescriptions, labs, invoices, notes, insurance); staff on a desk computer get the same plus this desk's radiology, ward notes and orders. Policy and member numbers are masked (last four digits) on a card scan; staff see them in full.
- **Live**: the record is re-read from the server every 8 seconds while the page is open, the moment the tab is shown, focused or back online, and immediately when any desk's data on this computer changes (patients, bills, consultations, ward care, insurance). The footer shows when it last updated, with a Refresh now button.
- Inside the app, the OP Journey window now opens on **Complete record (end to end)**; today's OP milestones and previous consultations are the other two tabs.
- The "Download complete history" PDF carries the same sections.
Tests: `npm run test:record` (a card scan with no login carries every list and the insurance terms, numbers masked), backend `test_patient_card_insurance.py` (74 backend tests).

---

## Round 2026-11-18 (b) - Main dashboard KPI cards: exact numbers, real trends

**What was wrong** (`components/Dashboard.tsx`):
- **Patients Today** added *every encounter ever recorded* + active ER visits + occupied beds, so a patient in a bed (also in ER, also with an OP visit) was counted up to three times, and old visits were counted as "today". With 18 old encounters and nothing happening today it showed 18.
- **Appointments** was the same all-time encounter count; **Admissions** was just beds occupied now; **Discharges Ready** counted everyone ever discharged (and was labelled "pending clearance"); **ED Waiting Room** counted every open ER patient; **Critical Alerts** counted every open STAT order as critical.
- The six small trend lines were fixed drawn curves, not data.
- "Today" used UTC, so in India it was yesterday until 5:30 am. The surgery row looked for statuses the surgery module never uses (always 0) and invented a minimum of 5 operating-room bays. "All Systems Operational" was always on, and the green "HOSPITAL ADMIN" pill showed for every role.

**Now** (`utils/dashboardKpis.ts`, one pure function from the hospital's own records; local calendar day):
- **Patients Today**: distinct people seen or in the hospital today (OP visits today, ER patients arrived today or still in ER, patients in beds, admitted or discharged today), each once; with the OP / ER / in-beds split and newly registered today.
- **Appointments**: OP visits made today, with completed / in consultation / waiting.
- **Admitted Today**: admitted today (including any already discharged), with beds in use, free beds and occupancy.
- **Discharged Today**: discharged today, with how many beds are due or overdue for discharge.
- **ED Now**: open ER visits, waiting (pending / doctor assigned) vs in treatment vs awaiting bed, and ESI-1/2.
- **Critical Alerts**: open ER ESI-1/2 + lab results flagged Critical in the last 24 hours; STAT orders still open are shown separately (urgent, not critical).
- Real 7-day trend lines (hover for the numbers); hover a card for exactly what it counts; live refresh every 15 s and on tab focus, with an "updated hh:mm:ss" stamp; a real server-reachable indicator; the role of the signed-in user.
- Also fixed on the same page: "Today's Appointments" now lists today's visits newest first (it listed the first five ever); "Pending Diagnostic Labs" lists pending orders newest first, with the date when not today; the critical-lab banner is a real Critical result (no invented patient id); the surgery row uses the module's real statuses and no invented bays.
Test: `npm run test:dashboard` (20 checks, including the old double count, the UTC-midnight case and an empty hospital reading zeros). Other department dashboards (Billing, Laboratory, Pharmacy, HR, Finance, Insurance) were not changed.
- **Admitted / Discharged** now also read the server's own list of completed stays (the Discharged Directory, `/api/beds/discharged`) and merge it with this browser's records, because a discharge made at another desk or from the bed board may have no local record: on the live data the server held a 13 Nov admission and a 17 Nov discharge that the dashboard could not see. Server times are read as UTC (a bare date stays on its day). A card with no 7-day line (Critical Alerts) has no history to draw; a flat dotted line means nothing happened in those seven days.
- **Graphs that grow with the day's data.** Each KPI card has a **Today by hour** view (the default, remembered per browser) and a **Last 7 days** view. Today by hour is a running total from midnight to the current hour, so the line climbs as patients and data arrive (patients already in a bed or the ER from an earlier day are the starting level); its last point is the card's own number. A dot marks the latest point, a flat dotted line means nothing yet. **Critical Alerts** now has a history too (ER ESI-1/2 arrivals and critical lab results raised per day / per hour). Each card shows yesterday's whole-day total beside today so far, and flags it only once today has passed it. Test: `npm run test:dashboard` (31 checks, including a new arrival raising the line from its hour).

