# Patient 360° (`modules/patient360`)

Implements the *HospAI Patient 360° End-to-End Implementation Specification* (v1.0, 24 Nov 2026) as a **coordination
layer over the existing HMS** -- no second patient master, no copy of the clinical record.

Frontend: `frontend/src/components/patient360/` (sidebar entry **Patient 360°**, module key `patient360`).

## Reused, not duplicated

| Spec need | Existing feature reused |
|---|---|
| Canonical identity | `patients.patient_id` (bulk-imported rows, `source = 'bulk_import'`, are **excluded** -- spec 9.3) |
| Clinical timeline sources | `utils.database.get_patient_journey`, admissions, encounters, appointments, prescriptions |
| Audit trail | `audit_logs` via `shared.audit.log_audit_event` (`module_name = 'patient360'`); read with `/api/audit/logs?module=patient360` or the per-patient view |
| Communication history / sending | `patient_messages`, `modules/messaging` (the only send path) |
| NL query | `ai.service.translate_patient_filter_prompt` (Keppler/Qwen); output is validated here before use |
| Excel/PDF file-scoped search, broadcast | `modules/bulk_import` + the PatientReach AI screen (linked, untouched) |
| RBAC / tenancy / CSRF | `core.auth` `ASSIGNABLE_MODULES` + `SUB_MODULES`, `current_hospital_id()` on every query |
| Full record / OCR / documents | patient record page and Keppler OCR (linked) |

## New

`schema.py` tables: `patient360_enrollments`, `care_journey_templates`, `care_journey_instances`, `care_checkpoints`,
`care_tasks`, `care_task_events`, `survey_templates`, `survey_responses`, `communication_authorizations`,
`patient360_preferences`, `patient_segments`, `segment_memberships`.

* `rules.py` -- pure decisions (state machines, validation, consent eligibility, segment compiler). Unit-tested in
  `tests/test_patient360_rules.py`.
* `service.py` -- queries and workflows. `routes.py` -- `/api/patient360/*`.

## Hooks into existing code (all fail-safe)

* `modules/beds/routes.py::beds_release` -> `enroll_from_discharge` (idempotent on the discharge event; a failure is
  logged and never blocks the discharge).
* `modules/messaging/routes.py::send_patient_message` -> skips a channel only for an **explicit** opt-out; patients with
  no consent record behave exactly as before.
* `modules/whatsapp/routes.py::handle_incoming_message` -> a `STOP` reply records a blanket opt-out (previously it was
  treated as survey feedback).

## Permissions

`patient360.read`, `patient360.coordination.write`, `patient360.consent.write`, `patient360.approve`,
`patient360.segments.write` (grantable as `patient360` or `patient360.<coordination|consent|approvals|segments>`).
Templates and surveys follow a two-person rule (the author cannot approve); set `PATIENT360_ALLOW_SELF_APPROVAL=true`
only for a single-user pilot.

## Behaviour worth knowing

* **Nothing is sent automatically.** `POST /checkpoints/run-due` records the send-time eligibility decision and creates a
  task; the coordinator sends through Patient Messages. Consent fails closed (no active authorization -> no outreach).
* Survey answers are append-only; escalation is decided only by clinician-approved deterministic rules.
* Segments: the model proposes `(field, op, value)`; anything outside the allow-list in `rules.SEGMENT_FIELDS` is rejected
  and the query is not run. Values are always bound parameters.
* The timeline is assembled at read time (no stale projection table).

## Not built yet (spec sections still open)

* Automatic WhatsApp/SMS dispatch from checkpoints, provider webhook ingestion for inbound survey replies (staff/API
  entry works), and a background scheduler (checkpoints are processed by the endpoint/button).
* Campaign approval workflow and bulk send (use PatientReach AI broadcast; Patient 360° only computes eligibility).
* Appointment booking/rescheduling through the scheduler (appointments are shown read-only).
* Identity-reconciliation cases (18.5), AI survey summaries, OCR review queue for documents, HL7/FHIR mapping.
* Several clinical records in this HMS live in browser stores, not the server DB; those sections show only what the
  server holds. Section 21 decisions (pilot pathway, consent wording, approvers, escalation coverage, retention) are
  still needed before real patients are enrolled.
* The SQL has not yet been run against a live Postgres in CI -- run `init_database()` against a dev DB and exercise the
  flows once before relying on it.
