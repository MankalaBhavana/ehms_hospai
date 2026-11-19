# EHMS - Code fixes, code bugs and code-structure work

Scope: application code only (backend, hr-api, ocr-backend, frontend, ocr-frontend). Infrastructure, AI model servers and deployment are handled elsewhere.

Status key: **DONE** = fixed in this tree and checked; **PARTLY** = fixed in part, remainder listed; **OPEN** = not done.
"Checked" means exercised against a running backend (embedded PostgreSQL) and/or a scripted two-user simulation. **No change below has been clicked through in a real browser yet** - items marked *needs browser check* should be verified on screen first.

Contents:
0. Status of this round (what changed, by file)
1. Earlier fixes (still in place)
2. Code bugs (with status)
3. Browser console errors
4. Code-base structure and optimization (all OPEN - refactors for the team)
5. Suggested order
6. Hardcoded device addresses
7. User and doctor management (section 8 of the previous version) - DONE
8. Known gaps / needs browser check

---

## 0. Status of this round

### 0.1 Login and account management (DONE, checked)
| Problem | Cause | Fix |
|---|---|---|
| Doctors get "Invalid credentials" with correct details | Doctor form built usernames like `dr.dr.srinu` (`replace('dr.','')` missed "Dr " without a dot). Name/username comparison was exact, so "Dr. Srinu", "dr srinu", "DR. SRINU" never matched. The login query joined several tables and `fetchone()` took an arbitrary row. | `core/auth.py` `authenticate()`: tries every matching account and keeps the one whose password verifies; compares on a normalised name (title stripped, punctuation = space, case-insensitive) in SQL. `utils/database.py` `create_admin_doctor()`: username is `dr.<name>` once. Existing `dr.dr.*` accounts still log in. |
| Same-named doctors overwrite each other | Existing-doctor lookup matched on username alone | Match on staff id or name+department only; a taken username gets a numeric suffix |
| Re-saving a doctor resets their password | Password hash was rewritten to `Doctor@123` on every save | Password changes only when one is supplied |
| Any 4+ character password logged you in as a doctor listed in `doctors` | Bootstrap fallback in `authenticate()` (`or len(doc_pw) >= 4`) | Removed |
| Deleted doctor still signs in; `DELETE /api/admin/doctors/DOC-1002` returns 500 | `id = ?` compared a text code with an integer column; users were matched by **full name** (could deactivate another person); login re-activated inactive doctors | `delete_admin_doctor()` resolves one doctor exactly, deactivates only the linked login, and the route revokes its sessions. `authenticate()` only auto-activates `pending`/`invited` doctors, never `inactive` |
| Second user without a staff id always fails (`STF-1001` duplicate); doctor ids can repeat | `random` was never imported; doctor ids were time-based | `_next_staff_id()` takes the next free number from the database |
| Doctor created twice, first copy without password | `addDoctorMaster()` POSTed to the backend **and** `Administration.tsx` POSTed again; both ran concurrently | `doctorMaster.ts` add/update/delete take `syncBackend` (admin screen passes `false`); one save at a time (ref guard); server call happens **before** the dialog closes and a rejection shows the real error |
| Errors hidden / everything 400 | `_safe_admin_error` logged nothing | `_admin_error_response()` logs, returns 409 duplicate / 400 bad input / 500 server error with specific text (email / username / staff id) |
| Invalid email like `kumar@123@hospital.org` | Email built from raw username | Sanitised local part |
| `POST /api/auth/reset-admin-credentials` open to anyone | No auth check | Requires a signed-in administrator; no built-in `Admin@123` fallback |
| `mock_hash_*` fallbacks accepted as known-password logins | Hashing failure fell back to a fake hash | Removed (raises instead) |
| `INITIAL_ADMIN_PASSWORD` default `Admin@123` | Hard-coded fallback | First administrator is **not** created unless `INITIAL_ADMIN_PASSWORD` is set (min 8 chars). `start-team-test.ps1` sets it |

### 0.2 Data shared between users / screens not updating (DONE, checked by simulation)
Every store (OP queue, doctor portal, lab, radiology, pharmacy, ER, beds, billing ...) lives in browser `localStorage`, so each browser had its own copy of the hospital.
- `frontend/server/sync/kvSync.mjs` + `merge.mjs`: server-side key/value store (file `frontend/server/data/sync-kv.json`), session-authenticated, with **long-poll** delivery (works through Cloudflare / any proxy; changes arrive in ~1 s).
- `frontend/src/lib/serverSync.ts` (started in `main.tsx`): intercepts `localStorage` writes to shared keys, pushes them, applies other users' changes and wakes the stores through the signals they already listen to. Per-device keys (current user, saved credentials, draft state ...) are excluded.
- Concurrent edits use a **per-record three-way merge** (only records someone actually changed win; deletes stay deleted; records added by others are kept). Checked with two simulated users, including concurrent edit + add + delete.
- Hosted in the Vite server (`vite.config.ts` plugin) for dev and `vite preview`. **For production move this into the backend database** (see 8).

### 0.3 Workflow bugs
| Area | Cause | Fix (file) |
|---|---|---|
| Finished patients reappear in doctor queue | `syncOPVisitsWithBackend` reset statuses from the server queue on every poll (`services/db.ts`); "Awaiting Investigation" was not a closed status (`doctorPortalDb.ts`) | Closed statuses are never downgraded; added to `CLOSED_STATUSES` |
| After sending prescription the doctor stays on the patient | `toast` was never imported in `DoctorPortal.tsx` -> ReferenceError before the screen moved on. `q` undefined in the inbox empty state | Import added, `q` defined |
| Deleted visits come back | Queue sync re-creates any visit the server still lists | Tombstones (`hospai_db_deleted_enc_v1`, shared via sync) |
| Radiology: completing one scan completes the patient's other scans | Stage stored under the **accession number** (shared by all scans of an order) and UMR | `RadiologyOperationsView.tsx`, `radiologyWorkflowDb.ts`: stage keyed by scan id only; `billingDb.updateRadiologyStudy` fallbacks (accession/invoice) apply only when exactly one study matches; exact id wins in selection |
| Radiology preview empty, PDF full | Template preview and print used only `study.findings`; structured field values reached only the PDF | `RadiologyReportPdfModal.tsx`, `utils/radiologyPrint.ts`: same resolved findings everywhere; findings/impression appended when the template has no slot *(needs browser check)* |
| ER "Request Bed" says submitted but nothing arrives | Server call ran last with errors swallowed; local store created a phantom visit | `ErPage.tsx`: server first, real error shown (403 -> permission message). Server stores the requested level of care *(needs browser check)* |
| ER unidentified patient cannot be edited | Edit changed only the in-memory copy; refresh reverted it | New `POST /api/er/visits/<id>/unknown-details` (+ `er_visits.unknown_details` column); list/detail return the details; form pre-fills from them |
| Nurse station slow | Encounter/patient lists re-parsed from JSON on every call (called per row) | `db.getEncounters()/getPatients()` cached by stored string *(not profiled in a browser)* |
| Medicine / lab search too strict | Short-form expansion matched by prefix of the *typed* text (`methylprednisolone` -> Metformin) | `prescriptionAI.ts expandMedicineName()`: exact key or prefix of a known drug (catalogue + short forms), any case; `labCatalogueSchema.findTestDefinition()` ranks name/alias prefixes |
| Card QR unreachable from phones | QR used localhost / LAN address | `/app-config.json` serves the public URL (env `PUBLIC_APP_URL` or `frontend/server/data/public-url.txt`); `patientRecord.ts` prefers it |
| Missing imports (runtime ReferenceErrors) | `radiologyWorkflowDb.ts` (`isRadiologyTest`, `getModalityForTest`), `billingDb.ts` (`normEffective`), `BedManagementPage.tsx` (`BillingDatabase`), `App.tsx` (`getDoctorById`, `setSelectedDoctorEncounterId`) | Fixed |
| OP Journey shows data nobody entered | Queue Management journey panel (`QueueManagement.tsx`) fell back to invented values: diagnosis "Acute Coronary Syndrome", ICD-10 I20.9, "ECG 12-Lead, Serum Troponin I", a default Aspirin prescription, vitals 120/80 / 76 bpm / 98.6 F / 99% / 74 kg, "Boston, MA", times 10:00-10:55 AM, a radiologist name. The printed/PDF journey (`utils/journeyPrint.ts`) also printed made-up vitals, dosages ("1 Tab", "Twice Daily", "5 Days") and marked every step "Completed"; it and the journey modals read non-existent billing fields (`totalBilled`, `paymentStatus`) so an unpaid visit printed as Paid, and read `timestamps.consultationDone`, which does not exist | All fallbacks now show a dash / "Not recorded yet" / "No medicines prescribed yet"; steps show Pending until their timestamp or status exists; the PDF lists only steps that happened; billing reads `billing.status` / `billing.total` *(needs browser check)* |
| Patient "already consultation completed" without being seen; patient missing from nurse / doctor / billing flow | (1) Queue sync matched a returning patient's NEW visit to their old finished visit (same UMR + first name), so it inherited "Consultation Completed" (`db.ts`). (2) Settling a bill (registration fee at reception, or a lab bill) set the visit to "Billing Completed" even before the consultation; that status is "closed", so the patient vanished from the nurse's waiting list and the doctor's queue (`billingDb.ts`). The claim -> visit match also fell back to the first visit with the same UMR | Sync matches the exact visit, or the patient's *open* visit only. New `statusAfterBillingSettled()`: "Billing Completed" only after the consultation (or `consultationEnd`); before it the status is left alone (Registered / Doctor Assigned -> In Queue). Claim -> visit match: exact id / OP number first, then the patient's latest visit *(needs browser check)* |
| Switch-doctor dropdown in the doctor workspace | Not rendered by this source (leftover memo + prop only) | Leftovers removed; the deployed `ehms.hospai.ai` build must be rebuilt from this source |

### 0.3b Round 3 (ER, billing, bed times, lab, insurance, templates)
| Area | Cause | Fix |
|---|---|---|
| Lab modules "This page could not be displayed" | Lab screens are lazy-loaded chunks. Every rebuild changes their file names, so a tab opened before the update asked for files that no longer exist ("Failed to fetch dynamically imported module"). Hit all lab modules at once | `main.tsx` reloads once on `vite:preloadError`; `PageErrorBoundary` recognises the error and reloads (loop-guarded). Tested: open tab, rebuild underneath, click Lab Workbench -> recovered |
| ER "Request Bed" failed | `ErDatabase.createBedRequest` called `this.saveVisits()`, which does not exist -> `TypeError: this.saveVisits is not a function` **after** the server had already recorded the request, leaving it half done. The local bed-request number also differed from the server's, so Bed Management called `/api/er/bed-requests/<wrong id>/allocate` (404) | `erDb.ts` uses `save()`, new `ensureLocalVisit()` copies the real visit instead of inventing "Emergency Patient"; `ErPage` uses the server's `bed_request_id`; Bed Management looks up the real pending request, and only falls back to a direct assign when there is none (it used to retry on *any* error, turning a 409 into another 409/500) |
| ER board counters wrong | "Bed requested" / "Bed allocated" were derived from the ER bay label, so everyone in an ER bay counted as *allocated* and nobody as *requested* | Counted from the visit status; list API now returns `bed_request_care/status`; raw `bed_requested` badges now read "Bed Requested" etc. |
| ER "Recent Investigations" empty after ordering | The order only posted a timeline note and a billing charge, never saved on the visit | New `er_investigations` table + `POST /api/er/visits/<id>/investigations`; returned with the visit. Failures now show an error instead of "ordered" |
| ER "Collect in Billing" button | Not wanted: ER sends the bill, billing settles | Removed; the "Sent to Billing (Awaiting Payment)" / "Paid" status chips stay |
| Bed Management time wrong | Admission time was written as IST wall-clock into a UTC column (PostgreSQL drops the `+05:30`), and room rent was computed against IST "now" (overcharged 5h30). Naive timestamps were also sent without a zone | `current_ist_timestamp()` now stores UTC; rent uses UTC; the DB session is pinned to GMT; the API marks timestamps `Z`; screens convert to IST. (Rows written before this fix keep their old values) |
| Bed modal UI | Plain text block | Redesigned occupied-bed popup: status/bed-type/rate chips, patient card with avatar + UMR chip, Admitted / Length-of-stay (progress bar) / Room-charges tiles, grouped actions |
| `POST /api/billing/invoices` and `.../payments` 400 | Front end sends department words ("Outpatient", "Emergency", "Laboratory") and modes ("Bank Transfer", "Cheque", "Insurance Copay"); server accepted only codes. `status` was ignored | Server maps words/modes to codes (`_MODULE_ALIASES`, `_PAYMENT_MODE_ALIASES`) and accepts `status` as `payment_status`. All 9 module names x 6 modes return 200 |
| `beds/<id>/assign` 500 | Unknown patient id -> foreign-key violation unhandled | Returns 404 with a clear message |
| ER timeline "Visit not found" | Bill dispatch wrote the timeline to the browser store instead of the server | Writes to the server timeline |
| Template upload rejects `.docx` | A renamed legacy `.doc`/RTF with a `.docx` name was rejected as "corrupted"; embedded images were base64'd with `String.fromCharCode(...bytes)` (stack overflow on large logos) | Content sniffing instead of trusting the extension; chunked base64 *(a normal docx and a docx with a 480 KB logo both worked before the change, so if a specific file still fails, send it)* |
| Insurance: patient sent to Insurance not shown | Intake **never created a case**: submit updated the policy of the *first existing case* (another patient) or showed "case created" with a fixed fake id `INS20250928056`. Pre-Auth did the same with `claims[0]` and App fell back to `cases[0]` | Intake opens/updates the selected patient's case (`openEncounterCase`); Pre-Auth, Discharge and Detail use only their own case; **verified in the browser**: Intake -> case appears on the dashboard, Patient Policies, Claims and Email Hub |
| Insurance dummy data | Case detail/discharge/profile/claim screens showed invented diagnosis, doctor, dates, emails, documents, amounts (85,000 / 71,000 / 14,500 ...), a fake email thread and activity log, a fake patient (Ramesh Kumar, 9876543210), hospital ids, fixed dates, "95.2% Recovery", +12%/8%/15% trends; discharge gates were hard-wired "done"; the Email Hub invented a pre-auth request and TPA approval for every case | All bound to the case's own data or shown as "—" / empty states; dashboard "Active" counts every open case |

| OP appointment / registration -> billing | "Collect consultation fee" and "Go to billing" opened the generic Billing Dashboard with nothing selected (and no OP counter), so the booked patient looked as if it never reached billing | `Registration`/`Appointments` pass the visit id; `App.goToOpBilling()` makes sure the bill exists, preselects it and opens **OP Billing**. Tested: register -> Go to billing -> lands on OP Billing, patient first and selected (this also exposed that `BillingDatabase` was not imported in `App.tsx`) |
| "Bed allocated" without a bed | (1) ER board "BED" column showed the patient's **ER bay** (e.g. "ER Bed 03"), so a patient who had only *requested* a bed looked allocated. (2) Allocating a bed could mark **another patient's** transfer notification "allocated" (request ids are per-browser counters that collide). (3) Assigning from the bed board invented a patient (random id, fake phone) when the typed name matched nobody | Column is now "WARD BED": the real ward/room/bed once allocated (list API `allocated_bed_label`), else "Awaiting bed" with the bay as a small note; notifications match on visit/patient only; no invented patients (must pick an existing one) |

| Doctor workspace "send both" | "Send both" only appeared on the Review step and only when both halves were pending | Sheet step has **Digitise & send both** (digitises, sends medicines + investigations, finishes the consultation); Review step always offers Send both / Send all pending. Pasted-table test names ("Test<TAB>Sample<TAB>Purpose") are cut to the test name |
| Radiology "Awaiting Scan" after scanning, fake times | Scan state came from the `status` label only (a study sent to reporting still read "Orders"); Operations view showed invented times (09:35 / 09:50 AM) | State also derived from sent flag / stage / workflow & report status; invented times replaced by "—"; real ISO scan start/finish saved |
| Payment History accuracy | Totals summed the *bills'* "amount paid" (a payment reachable from two bills counted twice, derived bills assume paid), "today" used the UTC date, a receipt number could belong to two patients | Everything comes from a de-duplicated receipt ledger (receipt + patient + amount); new **By patient (total spent)** view with billed / paid / outstanding / receipts / last payment and a total row, drill-down to receipts, and a flag where a bill claims more paid than it has receipts for; calendar "today/7/30 days"; new receipts use a shared counter (`newReceiptNo`); invoices of patients known only locally are no longer dropped |
| Assigned beds | Directly assigning a bed left the patient's ER request "pending" (Admissions kept offering Assign Bed); request table showed the UMR instead of the name; allocated label lacked the room | Server closes the ER request on assignment (`link_er_requests_to_assignment`); names joined; full ward/room/bed label; one stuck record repaired |

Test pass: 101 sidebar pages opened as admin with live data: 0 crashes, 0 failed requests, 0 JS errors.

### 0.4 Backend platform
| Item | Status |
|---|---|
| Reports: every `/api/reports/<type>` returned 403 even for the administrator - **no role was ever granted `reports.read`** | DONE: granted to administrators (`ADMIN_PERMISSIONS`). `patients` report used a non-existent `umr` column -> fixed. All 14 types answer 200 (checked). Grant `reports.read` to other roles deliberately |
| Pool exhaustion returned a 500 stack trace | DONE: `DatabaseBusy` -> clear 503 + log (`utils/database.py`, `app.py`). Default max is already 60 |
| Readiness | DONE: `GET /api/ready` (database, Redis if configured); `/api/health` stays shallow |
| Blueprint registration check | DONE: `backend/backend/tests/test_blueprints_registered.py` (2 tests pass). `queue` blueprint renamed `queue_bp` |

---

## 1. Earlier fixes (still in place)
1. `backend/backend/app.py`: ICU, clinical, OT blueprints registered (do not register `queue_bp` twice).
2. `PharmacyModule/pages/PrescriptionQueue.tsx`: `useMemo` import.
3. `services/bedDb.ts`: `/api/beds` through `API_BASE`.

---

## 2. Code bugs

### 2.1 Reports endpoints - DONE (see 0.4)
The previous text ("14 endpoints do not exist") was out of date: `GET /api/reports/<type>` exists. The real fault was the missing permission and a bad column. KPI deltas in `modules/reports/routes.py` (`+12%`, `+8%`) are still hard-coded placeholders - **OPEN**: compute them or hide them.

### 2.2 Database pool - DONE (0.4)
Still do: audit modules that take connections directly and confirm `putconn` in `finally`.

### 2.3 Default credentials and sample data - PARTLY
- DONE: `Admin@123` default removed from `reset-admin-credentials` and from first-boot bootstrap; `mock_hash_*` removed; unauthenticated admin reset closed.
- OPEN: first-login forced password change.
- OPEN: `password123` still appears in frontend fallbacks (`Administration.tsx` 1110/1572, `lib/api.ts` 1889/1926, `doctorMaster.ts` 28, `roleDb.ts` 547) - these feed the browser-side role store, not the backend login, but should go.
- OPEN: compiled-in sample patients/records (`services/db.ts`, `OPWorkflow.tsx`, `bedDb.ts`, `labOrdersDb.ts`, `surgeryDb.ts`) and the offline mock layer (`lib/api.ts`, `memoryStore.mjs`) - guard behind `VITE_DEMO_DATA` (default false) or remove. Note `vite.config.ts` returns canned answers when the backend port is down; make that opt-in.

### 2.4 Clinical data only in the browser - PARTLY
Shared across users/devices by the sync layer (0.2), so it is no longer per-browser. Still **OPEN**: move each store to its API / database (the sync file is a bridge, not a database), version the storage keys, and clear shared keys when a different user signs in on the same machine.

### 2.5 Raw `fetch("/api/...")` - DONE (searched)
No raw `fetch("/api|/hms-api ...")` calls remain outside `apiFetch`/`API_BASE`. (`/sync-api` and `/app-config.json` are same-origin by design.)

### 2.6 Authenticated call before login - DONE
`App.tsx` no longer calls `syncDoctorMasterFromBackend()` until logged in. (`DoctorsOverview.tsx` is only mounted after login.)

### 2.7 Checks so these cannot come back - PARTLY
DONE: blueprint test, `/api/ready`. OPEN: run `tsc --noEmit` in CI - it currently reports ~180 pre-existing errors (mostly strictness: `possibly undefined`, implicit `any`); fix or baseline them first. This round removed every `Cannot find name` error (each was a real runtime crash), so none remain. Add ESLint `no-undef`.

---

## 3. Browser console errors
| Console error | Status |
|---|---|
| `GET /api/beds 404` | DONE (fix 3) |
| `useMemo is not defined` (Pharmacy) | DONE (fix 2) |
| 404 on ICU / OT / clinical | DONE (fix 1) |
| `GET /hms-api/api/reports/<type>` 404/403 | DONE (0.4) |
| `GET /hms-api/api/admin/doctors 401` on login screen | DONE (2.6) |
| `GET /api/icu/P-100260/... 404` (sample data IDs) | OPEN (2.3) |
| `checkout.js: Unrecognized feature: 'web-share'` | Third party; ignore |

---

## 4. Code-base structure and optimization - all OPEN
These are refactors for the team, unchanged from the previous version except 4.2.
1. Folder/package names (`backend/backend/` -> `backend/app/`; one package instead of `shared/core/utils/ai/modules`; remove the `sys.modules` patch in `app.py`).
2. Blueprint names - **DONE for `queue`** (`queue_bp`); the registration test now enforces `<module>_bp`.
3. One naming scheme (HospAI / hospai / HMS / EHMS / Keppler / dpi-ocr / Drake; `hospai_session` cookie).
4. Dev-machine leftovers in docs/comments/`.claude/settings.local.json`.
5. Schema management: ~110 tables created by hand-written SQL at startup -> Alembic. (This round added one `ALTER TABLE er_visits ADD COLUMN IF NOT EXISTS unknown_details` next to the existing DDL for consistency; move it into the Alembic migration.)
6. Pin dependencies (lock files).
7. Remove unused dependencies, split requirements per module group.
8. Remove non-runtime files (`Keppler.jpeg`, `datasets/`, `postman/`, `load/`, `newmig.sh`, `ocr-backend/scripts`).
9. Tests + Makefile + CI (a first test exists: `backend/backend/tests`).
10. Duplicate OCR/RAG code - one implementation per function.
11. OCR as part of the app (auth, frontend port, API prefix, data link).
12. OCR runtime behaviour (import-time `makedirs`, `.env` reading, blocking model warm-up).
13. Retire the legacy Node HR (`frontend/server/`). **Note:** `frontend/server/sync/` is new and must stay (or move to the backend with 0.2's production note).
14. Long-running work in the web process (`CELERY_TASK_ALWAYS_EAGER`).
15. Backend module hygiene; remove old `services/<name>/app.py` entry points if unused.

---

## 5. Suggested order
1. Browser-check the items marked *needs browser check* above; fix anything found.
2. Move the shared-data bridge (0.2) into the backend database; version/clear shared keys on user change (2.4).
3. Sample data / mock layer / `password123` / forced password change (2.3).
4. `tsc` + lint in CI after clearing the ~180 baseline errors (2.7).
5. Alembic (4.5), pinned and split dependencies (4.6, 4.7).
6. Rename and restructure (4.1 - 4.4, 4.8, 4.9).
7. Merge the OCR code (4.10 - 4.12), retire legacy HR (4.13), then the worker model (4.14).

## 6. Hardcoded device addresses - OPEN
Sample device IPs/serials are compiled into code and seed data: biometric readers in `frontend/server/db/schema.sql` (606-610) and `frontend/src/services/hrmsDb.ts` (399-459), lab machines in `frontend/src/services/labLisService.ts` (209-288), a POS terminal address in `PharmacyModule/pages/Dispensing.tsx` (865). Move to database/config. `backend/gateway/nginx.conf` is the old gateway config - delete it.

## 7. User and doctor management - DONE
All seven findings of the previous section 8 are fixed (see 0.1): doctor/login consistency, double create, delete that really deactivates and signs out, recreate after delete, id mismatch (`PUT/DELETE` by code or number both work), hidden errors, generated values.
Still open from that list: **link `doctors.user_id`** and create doctor + login in one transaction (today they are created in the same request but matched by staff id / username), and a real hard-delete for test data.

## 8. Known gaps / needs browser check
- **Not verified on screen:** radiology preview/print, ER request bed, unidentified-patient edit, nurse station speed, doctor workspace after completing a consultation, QR scan from a phone on another network.
- **Lab:** the request mentioned a lab issue but no details arrived. Lab data now travels through the same sync as every other store, but any other lab defect is unconfirmed.
- **Request Bed** can still be refused by the server for a role without `er.disposition.write`; the screen now says so.
- **Shared-data bridge is a file** (`sync-kv.json`) with all patient data in it - fine for testing, not for production (0.2).
- **First connection:** the first browser to connect seeds the server from its local data; afterwards the server copy wins and other browsers' old local data is discarded.
- **Same-named doctors:** logging in by bare name is ambiguous when two doctors share a name and password; staff id or `dr.<name>.<n>` username is unambiguous.
- **Keppler OCR** ("is starting..." forever): the embedded OCR screens are a separate app on port 3000 that nothing started. It is now started by `start-team-test.ps1` (in `ocr-frontend`, `@tailwindcss/vite 4.3.4` hangs on import here, so 4.3.3 is installed without saving). The OCR **backend** (`ocr-backend`, port 7620, models) is not running; the screens fall back to the built-in mock answers, so uploads and summaries are not real OCR until it is deployed.
- **Cloudflare quick tunnel:** address changes at every restart (`start-team-test.ps1` prints it and updates the QR address). Use a named tunnel / domain for anything lasting.

## 9. Deployment readiness (this round)
* **Removed** (backup zip saved next to the project folder as `devGnani-update-backup-2026-11-11.zip`): `changes.patch`, the empty `backend/backend.db`, the retired `backend/gateway/` nginx config, all `__pycache__` / `.pytest_cache` / `*.pyc`. **Kept on purpose:** `ocr-backend/datasets` (read by the OCR resolvers), live data (`backend/.pgdata`, `frontend/server/data`; both git/docker-ignored and must never ship), `restart-preview.ps1` / `start-local.ps1` (local helpers).
* **Added:** `frontend/server/prod.mjs` (production web server: static files, shared-data sync, API proxy, OCR screens, security headers, correct caching, `/healthz`), `deploy/` (backend + web Dockerfiles, `docker-compose.yml`, `.env.example`), root `README.md`, `.gitignore`, `.dockerignore`.
* **Backend:** `APP_ENV=production` refuses to start without `SESSION_PEPPER` (16+ chars), `SESSION_COOKIE_SECURE=true` and `DATABASE_URL`; `TRUST_PROXY` enables ProxyFix. `npm start` runs the production server; dead npm scripts removed.
* **Verified:** the production server on a test port (SPA and deep links, `/healthz`, API proxy login, session-protected sync: 401 without a session / 200 with, cache headers); the production guard refuses weak config; the compose file parses and validates. **Not verified:** that the Docker images build (Docker daemon not running here) - do a staging trial first.
* **Still open for a true production release:** ~150 pre-existing TypeScript strictness errors (the build does not typecheck); move the browser-store data into PostgreSQL; add the OCR backend and a Celery worker to the stack; Alembic migrations instead of startup DDL; pinned Python lock files.
