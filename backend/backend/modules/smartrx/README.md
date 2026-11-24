# SmartRx: runbook

Deterministic prescription safety engine. No LLM output ever produces an alert, and no alert blocks signing.

## Set up / upgrade
```
cd backend/backend
export DATABASE_URL=postgresql://...        # same variable as the API
python smartrx_pipeline/step2_ingest_db.py  # runs pending migrations, then reloads knowledge in ONE transaction
python smartrx_pipeline/benchmark.py        # exit code 1 if search is slower than 50 ms
```
- Migrations: `modules/smartrx/migrations/NNN_*.sql`, forward-only, checksummed. Never edit an applied file; add a new one.
- Knowledge files: `SMARTRX_DATA_DIR` (default `backend/backend/smartrx_data`).
- Re-running ingest is safe; `smartrx.patient_allergy` is never truncated.
- Ingest aborts, writing nothing, if a rule or class cannot be tied to a substance (`--allow-unresolved` overrides).

## Behaviour switches
| Variable | Default | Meaning |
|---|---|---|
| `SMARTRX_INCLUDE_DRAFT` | false | Also load `draft` rules/classes/cross-reactivity (shadow-mode review). Alerts carry `knowledge_status: draft`. |
| `SMARTRX_LAB_STALE_DAYS` | 90 | Older renal results are used but flagged stale. |
| `SMARTRX_FUZZY_MIN_RATIO` | 0.86 | Minimum similarity for typo correction (always shown as "interpreted as"). |
| `SMARTRX_MAX_ITEMS` | 60 | Max lines per evaluation. |
| `SMARTRX_RULE_CACHE_SECONDS` | 60 | How often the knowledge version is re-checked. |

## API (all need a session; reads `patients.read`, allergy writes `patients.clinical.write`)
`GET /api/smartrx/health` · `GET /api/smartrx/catalog/search` · `POST /api/smartrx/evaluate` ·
`GET|POST /api/smartrx/patients/<id>/allergies` · `DELETE .../allergies/<n>` · `POST .../allergies/import-legacy`

`/evaluate` returns `check_status` (`complete` | `partial`) with `partial_reasons`; a 503 `engine_unavailable` means
checks did NOT run and the UI must say so.

## Governance
Rules and classes carry `status` (`draft`/`approved`/`retired`), `reviewed_by`, `reviewed_at`. The engine loads only `approved`
unless `SMARTRX_INCLUDE_DRAFT` is set. The `rule_set_version` (date + content hash) is returned on every evaluation.

## Adding sources, and the doctor-workspace alert panel
```
python smartrx_pipeline/fetch_source.py smartrx_data/source_manifest_2026-11_india.csv --dry-run   # then without --dry-run
python smartrx_pipeline/fetch_source.py --retry-failed                                              # register rows that failed on a transient error
python smartrx_pipeline/step4_index_guidelines.py                                                   # index what was fetched
```
`fetch_source.py` accepts only real PDFs (file signature, not file name), enforces a size limit, never bypasses a login/licence/CAPTCHA, skips a URL or a
file (SHA-256) already registered, and writes the file, its SHA-256, a `Source_Log.csv` row and a jurisdiction. The downloaded PDFs are **not committed**
(size, and some carry a "no reproduction without permission" notice): only the register, manifest and jurisdiction rows are.

The panel (`frontend/src/components/doctor/SmartRxPanel.tsx`, hook `useSmartRx`, client `services/smartrx.ts`) checks the sheet as the doctor types.
- **Never a made-up answer:** if the server cannot be reached it says *the check did not run* (and does not block sending). `/api/smartrx/*` is excluded
  from the browser mock store for this reason.
- **Critical alerts need an acknowledgement with a reason** before the prescription is sent; the acknowledgement is saved to `smartrx.alert_override`
  and restored after a reload. Warnings and notes never block.
- Every alert shows how well-sourced it is (verified / cited / draft / hospital policy), the document and page, and the source's jurisdiction.
- `smartrx.evaluation_log` records each evaluation (alert ids, severities, rule-set version, input hash) with no free-text or clinical values.
- Frontend tests: `cd frontend && npm run test:smartrx`.

## Reviewer workflow (Step 3): from guideline to live rule
```
python smartrx_pipeline/step5_build_worklist.py --drug metformin --drug "valproic acid"     # or no args: every drug the seed rules mention
   -> <knowledge root>/08_Reviewer_Worklists/<date>/worklist.html   (read this), worklist.csv, coverage.csv, missing_sources.csv

python smartrx_pipeline/knowledge_review.py template --kind dose_limit                      # columns for the extraction sheet
python smartrx_pipeline/knowledge_review.py submit extractions.csv                          # validate (dry run)
python smartrx_pipeline/knowledge_review.py submit extractions.csv --apply                  # append as draft + cited (inactive)
python smartrx_pipeline/knowledge_review.py list                                            # rows waiting for a second person
python smartrx_pipeline/knowledge_review.py approve --row-id ab12cd34 --reviewer "Dr A" --approver "Dr B"
python smartrx_pipeline/step2_ingest_db.py                                                  # the rule goes live
```
1. **Find.** The worklist shows, per drug and topic (dose, renal, hepatic, pregnancy, contraindication, interaction, stewardship), the guideline sentences that
   mention it: Indian sources first, drug names highlighted, OCR pages and hash-mismatched files flagged. `coverage.csv` shows where the library has *nothing*.
2. **Extract.** A named person copies the wording into a sheet row (kind, subject, severity, message, `source_id`, page, exact quote, their name).
   `submit` rejects: unknown drugs/classes, invalid values, rules the engine cannot evaluate, a quote that is not on that page, OCR or tampered sources,
   duplicates, and **treatment content (clinical rules, antibiotic policy) citing a non-Indian source**.
3. **Approve.** A second person re-reads the page and runs `approve`. It re-verifies the quote and enforces reviewer != approver and approver != extractor.
   AI/system names are refused. Only then is the row `approved` + `verified`.
Source jurisdiction (India / WHO / International / US) comes from `smartrx_data/source_jurisdiction.csv` (reviewable), is stored on `guideline_source`,
and appears on every alert as `source_jurisdiction`.

## Provenance: no clinical advice without a citation
Every rule row has `provenance`: `unsourced` (never loads, not even in shadow mode), `cited` (legacy / label-level citation, active only if
approved, always reported as unverified) or `verified` (source_id from `Source_Log.csv` + page + verbatim quote, extracted by one person and
approved by a different person). The database itself refuses an `approved` row that is `unsourced`. Every alert carries `provenance` and,
for verified rules, `source_ref` (for example `SRC_012, p.34`). `/api/smartrx/health` -> `knowledge_integrity` shows how much is verified.

```
python smartrx_pipeline/validate_knowledge.py --worklist   # CI check; writes unsourced_worklist.csv (what still needs a guideline citation)
```
To source a rule: fill `provenance=verified, source_id, source_page, source_quote, extracted_by, reviewed_by, approved_by, approved_at`
and `status=approved` in its CSV row. `SMARTRX_ALLOW_UNSOURCED=true` is a development/test switch only; never set it in a deployment.

## Guideline index and quote verification (Step 2)
Every registered guideline (148 PDFs, HTML pages and the LactMed archive) is indexed page by page, so a reviewer can find the passage and the system
can prove a citation is real.

```
python smartrx_pipeline/step4_index_guidelines.py          # ~45 s for the whole library; incremental (unchanged files are skipped)
python smartrx_pipeline/step4_index_guidelines.py --ocr    # also OCR pages with no text layer (slow; needs: pip install rapidocr-onnxruntime)
python smartrx_pipeline/search_guidelines.py "metformin eGFR" --exclude-ocr
```
- A rule marked `verified` must cite `source_id` + `source_page` + a verbatim `source_quote`. Ingest checks the quote really appears on that page
  (case, typography and line-break hyphens are ignored; **digits and units must match exactly**). It rejects the rule otherwise, and says which page the wording is on.
- Citations cannot rest on **OCR** pages (OCR can misread digits) or on a document whose **file hash differs from `Source_Log.csv`**.
- Each file's SHA-256 is compared with the register on every run; mismatches are reported and recorded in `smartrx.guideline_document`.
- LactMed is parsed straight from the `.tar.gz` (entities and network access disabled); nothing is extracted to disk.
- If OCR libraries were installed with `pip --target`, point `SMARTRX_OCR_LIBS` at that folder.

## Phase 2 knowledge (interactions, dose limits, pregnancy/lactation, antibiotic policy, formulary)
The CSVs in `smartrx_data/` are the **source of truth**; ingest reloads them. Clinical review = edit the row in the CSV
(`status` -> `approved`, add `reviewed_by` and `reviewed_at` columns) and commit: git is the audit trail.

| File | Content | Shipped status |
|---|---|---|
| `drug_interactions.csv` | 47 curated high-severity pairs (class or substance) | `draft` |
| `interaction_label_candidates.csv` | ~630 mention-level pairs mined from label text; `info` only, quotes the label sentence | `draft` |
| `dose_limits.csv` | adult / child max single, daily, mg/kg/day, doses/week | `draft` |
| `reproductive_risk.csv` | pregnancy / lactation by drug or class | `draft` |
| `antibiotic_policy.csv` | global Reserve-tier list | `draft` |
| `drug_classes.csv` | therapeutic classes used by the above | `draft` |
| `drug_synonyms.csv` | INN/BAN <-> USAN names (paracetamol = acetaminophen) and combination names | n/a |

Nothing marked `draft` reaches prescribers unless `SMARTRX_INCLUDE_DRAFT=true` (shadow mode).
Regenerate label candidates after a GenericMaster refresh: `python smartrx_pipeline/step3_mine_label_interactions.py`.

Hospital-specific data lives in `smartrx.hospital_formulary` and `smartrx.antibiotic_policy (hospital_id = N)`; it is runtime data and is
never touched by ingest. Manage via `GET|PUT /api/smartrx/hospital/formulary`, `DELETE .../formulary/<id>`,
`PUT /api/smartrx/hospital/antibiotic-policy` (write needs `pharmacy.inventory.write`).

Request additions to `/evaluate`: `lactating` (bool), `current_medications` (list of names, max 40). Recent prescriptions in
`pharmacy_prescriptions` (last `SMARTRX_ACTIVE_MED_DAYS`, default 14) are also treated as current: that table has no duration or
frequency, so "current" is a recency heuristic.

Known limits: dose checks apply only to single-ingredient lines with a mass strength (mg/g/mcg) and need the patient's age;
combination products, liquids (mg/5 ml) and bare numbers ("500") are reported as "not checked", never guessed. Hepatic-impairment
rules are not implemented: there is no structured liver-function source.

## Tests
`python -m pytest tests/test_smartrx_api.py` — pure tests always run; database tests skip unless the knowledge is loaded.
