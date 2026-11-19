# EHMS - AI and ML models: what is used, what each does, and which ones matter most

Written 2026-11-16 from the code in this tree and from live checks on the running system. "Model" here means anything that
learns or predicts: language / vision models, embedding and re-ranking models, speech recognition, handwriting OCR, layout
detection, trained text matchers. Fixed rules (no learning) are listed separately in section 6 because they behave very
differently: they are predictable, always on, and need no server.

What was **measured** versus **read from the code** is stated each time. Accuracy of any model on your documents was not
measured: no model server is running on this machine (section 8), so the model-dependent paths were checked for how they
behave, not for how well the model reads.

---

## 1. At a glance

| # | Model | Kind | Role in EHMS | Weight |
|---|---|---|---|---|
| 1 | **Qwen2.5-VL-7B-class vision-language model**, served by vLLM (one deployment, name discovered from the server) | Vision + language LLM | The workhorse: reads photographed prescriptions and documents, and writes the answers, summaries, triage and extractions for every AI screen | **Major** |
| 2 | **BGE-M3** (embeddings, 1024-dim) + **BGE-Reranker-v2-m3** + BM25 sparse, on **Qdrant** | Embedding / retrieval | Finds the right passages for "chat with your documents" in Keppler OCR, with page-level citations | **Major** (for document chat) |
| 3 | **Hospital embedding model** (`VLLM_EMBEDDING_MODEL`, via the vLLM embeddings endpoint) | Embedding | Patient-history search and Symptom AI document chat inside the hospital backend | **Major** (for history search) |
| 4 | **Whisper** (`faster-whisper`, default `large-v3`) | Speech-to-text | Server-side dictation, primed with the hospital's drug and test names | Supporting (browser speech is the live engine here) |
| 5 | **Browser speech recognition** (Chrome / Edge) | Speech-to-text | Every microphone when Whisper is not installed | Supporting, **running** |
| 6 | **TrOCR** (`microsoft/trocr-base-handwritten`) | Handwriting OCR | Second opinion on a region the vision model read with low confidence (< 0.75) | Supporting |
| 7 | **DocLayout-YOLO** (via `ultralytics`) | Layout detection | Finds tables, text blocks and fields on a page so each region is read separately | Supporting |
| 8 | **LightRAG** (library, knowledge graph) | Retrieval over a graph | Symptom AI "ask about your documents" | Supporting |
| 9 | **scikit-learn TF-IDF matchers** (`joblib`) | Small trained models | Map noisy OCR tokens to the hospital's frequency list and item master | Supporting |
| 10 | Classical computer vision (OpenCV, CLAHE, deskew, checkbox and cell readers) | Image processing | Cleans pages and reads tick-boxes, handwritten Y / N cells | Supporting |

**Which models play the major role.** One: **model 1, the vision-language model.** By design every text and vision role (OCR,
summaries, chat, entity extraction, triage) resolves to that single vLLM deployment (`core/model_router.py`: "all
text/vision roles currently share the one vLLM deployment"). If it is down, every AI screen degrades at once. Next are
the **two embedding stacks (2, 3)**, which decide whether a question over documents finds the right page. Everything
else is a specialist that improves one step of one pipeline.

**What is *not* an AI model, and carries more everyday weight than any of them:** the prescription splitter, the
ER / OP triage fallbacks, the dictation clean-up, the doctor suggestion, the drug-name matcher and all billing and
access logic are rule-based and always on (section 6). The hospital runs without any model server; the AI screens
then fall back or say plainly that they cannot answer.

**Privacy.** All inference is local (vLLM, Whisper, BGE, TrOCR run on the hospital's own servers); no patient data
goes to a cloud model. Two exceptions to know about: the **browser speech service** used for dictation sends the audio to the browser vendor's
speech service (Chrome: Google) - it is the live engine today because Whisper is not installed; installing Whisper keeps
audio in the building. `google-generativeai` appears in the Keppler OCR requirements as "optional, future use" and is
not called anywhere.

---

## 2. The big picture: how the pieces connect

```
 Browser (React)                       Web server (prod.mjs)              Hospital backend (Flask)           Model servers
 ----------------                      ---------------------              ------------------------           -------------
 Doctor Workspace  ---- photo/text --> /hms-api  -------------------->  /api/ai/prescription-parse  ------> vLLM (vision LLM)   [1]
 Symptom AI        ---- text --------> /hms-api  -------------------->  /api/symptom-ai/*          ------> vLLM                 [1]
 Documents upload  ---- file --------> /hms-api  -------------------->  OCR + entity extraction     ------> vLLM                 [1]
                                                                          + embeddings stored      ------> embedding model      [3]
 History search    ---- question ----> /hms-api  -------------------->  /api/ai/patient-history-search -> embeddings [3] + vLLM [1]
 Any microphone    ---- audio -------> /hms-api  -------------------->  /api/ai/transcribe          ------> Whisper              [4]
                   \--- audio -------> browser speech service (no server)                                                       [5]
 ER triage assist  ---- JSON --------> /vllm-api (signed-in only) ------------------------------------------> vLLM            [1]
 Discharge assist  ---- JSON --------> /vllm-api -------------------------------------------------------------> vLLM            [1]
 Pharmacy invoice OCR -- image ------> /vllm-api -------------------------------------------------------------> vLLM            [1]
 Keppler OCR (iframe) ---- file -----> /keppler-ocr -> OCR backend (FastAPI + Celery) -> vLLM [1], TrOCR [6], YOLO [7],
                                                       BGE-M3 + reranker + Qdrant [2], scikit-learn [9]
```

The browser never talks to a model server directly except through the signed-in `/vllm-api` proxy (new in this round,
section 7).

---

## 3. The major models in detail

### 3.1 Vision-language model (Qwen2.5-VL-7B class, vLLM) - the workhorse

**What it is.** A multimodal model that reads images and text and writes text, served over an OpenAI-compatible API by
vLLM. The code asks the server which model it serves instead of hard-coding a name (`served_model()`,
`llmModel()`), so swapping the model needs no code change. The README names `Qwen2.5-VL-7B-Instruct`; some docstrings
still say `gemma4:26b` or `qwen2.5vl:32b` - those are stale comments, the live name comes from the server.

**Configuration.** Hospital backend: `VLLM_BASE_URL`, `VLLM_MODEL` (preference only), `VLLM_API_KEY`,
`VLLM_TIMEOUT_SECONDS` (240). Keppler OCR: `VLLM_BASE_URL`, `QWEN_OCR_MODEL`, `VISION_MODEL`, `SUMMARY_MODEL`,
`CHAT_MODEL`, `ENTITY_MODEL`. Web server (new): `VLLM_URL`, `VLLM_API_KEY` for the browser-side calls.

**What it does, feature by feature**

| Feature | Screen / endpoint | How it uses the model | Settings | If the model is down |
|---|---|---|---|---|
| Prescription from a photo or PDF | Doctor Workspace > prescription sheet; `/api/ai/prescription-parse` | Reads the sheet image(s) (up to 4 pages) and returns medicines and tests as strict JSON; a second pass flags any line it transcribed but did not file | temp 0, 6144 tokens, JSON mode | A *typed* sheet still splits with the built-in rules (`engine: heuristic`, verified). A photo cannot be read - the screen says so before upload |
| Document OCR | Patient documents upload; `/api/ocr`; Pharmacy invoice OCR | Extracts all visible text as markdown, with "do not invent anything" rules; digital PDFs use the text layer first and the model only reformats | temp 0.1, JSON | The upload is kept; no text is produced |
| Entity extraction from documents | Documents; `classify_and_extract_entities` | Classifies a document (prescription / lab / imaging / discharge) and pulls structured fields | JSON mode | No structured data, the text stays |
| Symptom AI analysis, region detection, chat | Hosp AI > Symptom AI; `/api/symptom-ai/*` | Analyses a described symptom, picks the body region, answers follow-ups | JSON mode | The screen reports the model is unavailable |
| **Triage** | Symptom AI triage; ER triage assist | Chooses department, urgency, level of care, bed need; ER form is pre-filled for staff to confirm | temp 0, JSON, 400 tokens | **Routes to General for staff review and says so** (`fallback: true`, verified live) |
| Clinical summaries | Hosp AI > Clinical Summaries; `/api/emr/...` | Writes a discharge-style or clinical summary from the record's facts | temp 0, JSON, 1600 tokens (browser path) | The facts are compiled without prose |
| Patient-history search answers | `/api/ai/patient-history-search`; Clinical RAG screen | Writes a short answer from the retrieved passages and cites them | temp 0.1 | The matching passages are returned without an answer, and the screen says so |
| Natural-language patient filters and document questions | Hosp AI > PatientReach AI (bulk import, filtering, WhatsApp broadcast) | Turns "diabetic patients over 50" into a filter; answers a question about an uploaded document | JSON mode | The filter cannot be built; manual selection still works |
| Pharmacy invoice OCR | Pharmacy > GRN / invoice | Reads a supplier invoice table (rows, batches, MRP, GST) | temp 0 | Enter the invoice by hand |
| Keppler OCR | `/keppler-ocr` | Region-by-region reading, medical term correction, table extraction, hierarchical case summaries, chat | per module | Screen opens; extraction waits for the model |

**Safeguards built around it** (read from the code): temperature 0 or 0.1 on every clinical path; prompts forbid inventing
names, drugs, doses or values; the prescription path flags uncovered lines instead of silently dropping them; JSON is
parsed strictly and a failed parse falls back rather than guessing; the consultation voice engine is forbidden to create
orders; a one-minute back-off stops the browser hammering an offline server; timeouts (35 s - 90 s browser, 240 s server).
Nothing the model writes is saved as a clinical fact without a person pressing Save, with two reviewed exceptions: the
ER triage form (pre-filled, staff confirm) and the document OCR text (stored as OCR text, labelled).

**State here:** not configured. Measured: ER / Symptom triage return the safe fallback; typed prescriptions split via the
rules; `/vllm-api` answers 503 "not configured".

### 3.2 Keppler retrieval stack: BGE-M3 + BGE-Reranker-v2-m3 + BM25 + Qdrant

**What it is.** The "chat with your documents" engine of Keppler OCR (`modules/rag_engine.py`), replacing an earlier LightRAG
setup that pointed at a model that was never served. Documents are chunked per page, embedded with BGE-M3 (1024 dimensions),
stored in a Qdrant collection tagged with the user's id (so a query only ever searches that user's documents), and found
again by dense + BM25 sparse search; **BGE-Reranker-v2-m3** re-orders the candidates; the chat model (3.1) answers using
only the numbered context, and **every source placed in the context is returned as a citation**, not only the ones the
model chose to cite.

**Config:** `EMBEDDING_MODEL`, `RERANKER_MODEL`, `QDRANT_URL`, `QDRANT_COLLECTION`. **State here:** not configured.

### 3.3 Hospital embedding model (patient-history search)

**What it is.** A model on the vLLM embeddings endpoint (`VLLM_EMBEDDING_URL`, `VLLM_EMBEDDING_MODEL`). Documents and notes are
embedded when stored (`store_document_embedding`), and a question is matched by cosine similarity in Python over JSON
vectors (works on any database; no pgvector needed). It serves the **Clinical RAG** screen (patient-history search) and the
Symptom AI / OCR portal document chat (through LightRAG, 3.5). **State here:** not configured (`generate_embedding` logs it
and returns nothing; a search then returns no sources - measured: `{"answer": null, "sources": []}`).

---

## 4. The supporting models

**4.1 Whisper (`faster-whisper`, default `large-v3`, int8, CPU).** Server speech-to-text for every microphone, 10 languages
(`WHISPER_MODEL_SIZE`, `WHISPER_DEVICE`, `WHISPER_DEFAULT_LANGUAGE`). This round it was given a **prompt of the hospital's own
drug and test names** (a model told how a word is spelled gets it right far more often) and `temperature 0` so the same
audio gives the same note twice. Voice activity detection strips silence (the main cause of hallucinated words).
The app checks `/api/ai/transcribe/status` and falls back to the browser by itself. **State here: library not installed** (measured).
`large-v3` is accurate and slow on a CPU; `medium` is the sensible CPU setting.

**4.2 Browser speech recognition.** Chrome / Edge Web Speech, continuous, interim results, auto-restart after pauses,
locale chosen per language. The live engine here. Cannot be primed with drug names, so the dictation clean-up
(section 6) corrects spellings afterwards.

**4.3 TrOCR (`microsoft/trocr-base-handwritten`).** In Keppler OCR, when the vision model's confidence for a handwritten
region is below 0.75 after six preprocessing retries, TrOCR reads the same crop and the higher-confidence result wins. Both
confidences are computed the same way (mean per-token log-probability) so the comparison is fair.

**4.4 DocLayout-YOLO.** Detects tables, text blocks and form areas (weights downloaded on first use to `models/doclayout.pt`). If it
detects less than 40% of the page it falls back to reading the whole page. Layout confidence is 40% of the final field
confidence (`confidence_engine.py`: 40% layout + 60% semantic).

**4.5 LightRAG.** Knowledge-graph question answering (one workspace per hospital and user) wired to the hospital's LLM and
embeddings. Library installed; it waits for models 3.1 and 3.3.

**4.6 scikit-learn TF-IDF matchers.** Small trained models loaded from `joblib` (`unified_resolver`, `frequency_resolver`,
`itemmaster_resolver`): map a noisy OCR token ("TDS" written badly, a drug-chart abbreviation) to the nearest entry of the
hospital's frequency list or item master. They never invent an entry: no match above threshold means "unresolved", and the
chart validator then **flags** (never edits) dosing anomalies such as micrograms vs milligrams.

**4.7 Classical computer vision.** EXIF orientation, transparency flattening, size bounding and a gentle CLAHE contrast lift
before the vision model (aggressive denoising and deskewing were removed because they erased thin ballpoint strokes);
projection-variance page orientation; checkbox state detection; handwritten Y / N cell reading by descender score.

---

## 5. Where each model is used, screen by screen

| Screen / area | Models involved | Works without a model? |
|---|---|---|
| Doctor Workspace - typed prescription | none (rules), optionally 3.1 to refine | **Yes** |
| Doctor Workspace - photographed prescription | 3.1 | No |
| Doctor Workspace - consultation conversation | 4.1 or 4.2 + rule-based consultation engine | Yes (typing) |
| Every dictation box | 4.1 or 4.2 + dictation clean-up | Yes (typing) |
| ER triage | 3.1, rule-based fallback | **Yes** (falls back) |
| Symptom AI | 3.1 (+ 3.5, 3.3 for document chat) | Partly (triage falls back) |
| Clinical RAG / history search | 3.3 + 3.1 | Shows passages only when embeddings exist |
| Clinical Summaries | 3.1 | Facts without prose |
| Keppler OCR | 3.1, 3.2, 4.3, 4.4, 4.6, 4.7 | Screen opens; extraction needs 3.1 |
| Pharmacy invoice OCR | 3.1 | Manual entry |
| Documents upload (patient chart) | 3.1 (+ 3.3 to index) | File stored, text not extracted |
| PatientReach AI (natural-language filters) | 3.1 | Manual selection |
| Everything else (billing, beds, notices, registry, access, reports) | none | **Yes** |

---

## 6. Rule-based "intelligence" (no model, always on)

| Engine | What it does | Verified |
|---|---|---|
| Prescription splitter (`ai/service.py` heuristic and `prescriptionAI.ts`) | Splits a typed sheet into medicines (dose, frequency, duration, estimated quantity) and tests | Live: `engine: heuristic` |
| Dictation clean-up (`utils/dictationText.ts`) | "bp one twenty over eighty" -> `BP 120/80`; units, abbreviations, punctuation words, near-miss drug and test names corrected by Jaro-Winkler against the pharmacy master and lab catalogue | 22 automated checks |
| Consultation voice engine (`lib/medicalVoiceAI.ts`) | Language detection (Telugu, Hindi, Tamil, Kannada, English), phonetic clean-up, doctor / patient turn separation, SOAP summary; creates no orders by design | In use |
| ER triage and bed-need rules (`erDb.ts`, `suggestBedNeed`) | Triage category and level of care from complaints and vitals when the model is unavailable | In use |
| Doctor suggestion (`/api/op/doctors/suggest`) | Doctors by department / body region from the doctor master | Live |
| Drug / medicine matching | Matches a written medicine to the pharmacy master | In use |
| Aadhaar check (Verhoeff), duplicate detection, vitals sanity checks | Catch mistyped identity numbers and impossible vitals | Automated |

---

## 7. Findings from this review, and what was fixed

1. **Clinical RAG was a stage prop.** The screen answered every question with the same hard-coded text about "John Smith"
   (blood pressure 138/88, two invented sources) after a fake 2-second delay. **Fixed:** it now asks the real
   `/api/ai/patient-history-search` for the chosen patient, shows the AI-written answer only when the model produced one,
   otherwise the matching passages exactly as stored, and says plainly when nothing matches or the model is unavailable.
2. **Patient Experience showed invented numbers** (NPS 72, CSAT 4.6 "based on 450 surveys", 12 grievances, three sample
   reviews). **Fixed:** it now shows the real feedback patients sent on WhatsApp (average rating, responses, low ratings
   waiting for follow-up, escalate / resolve buttons, CSV export); an empty system shows an empty state.
3. **The browser's AI calls had no route in production.** ER triage assist, discharge-summary assist and pharmacy invoice
   OCR call `/vllm-api`, which only the dev server proxied; the production web server answered with the app's HTML page.
   **Fixed:** `/vllm-api` is now proxied to `VLLM_URL` for **signed-in users only** (the model server has no login), strips
   the hospital session cookie, and answers a clear `503 not configured` when no server is set.
4. **Stale model names in comments** (`gemma4:26b`, `qwen2.5vl:32b`, `nomic-embed-text`) contradict the README and the code;
   the live model is whatever the server reports. Comments only, no behaviour.
5. **Keppler README mentions `modules/drug_cdss.py` (a clinical decision-support rule engine) that is not in the tree.** Nothing
   calls it; treat the drug-interaction / CDSS claim as not present.
6. Not changed, worth knowing: Keppler OCR runs as a separate app (own login, database, Redis / Celery, Qdrant); its models
   are configured in its own `.env`, not in the hospital backend's.

---

## 8. State on this server, and what is needed for full function

| Needed | Variable / install | Present here |
|---|---|---|
| vLLM serving the vision-language model | hospital backend `VLLM_BASE_URL`, `VLLM_MODEL`, `VLLM_API_KEY`; web server `VLLM_URL`, `VLLM_API_KEY`; Keppler `VLLM_BASE_URL`, `VISION_MODEL` ... | **No** |
| Embedding model | `VLLM_EMBEDDING_URL`, `VLLM_EMBEDDING_MODEL` | **No** |
| Keppler retrieval | `EMBEDDING_MODEL`, `RERANKER_MODEL`, `QDRANT_URL`, `REDIS_URL` | **No** |
| Whisper | `pip install faster-whisper`, `WHISPER_MODEL_SIZE` | **No** (library missing) |
| TrOCR, DocLayout-YOLO | `transformers`, `torch`, `ultralytics` in the Keppler environment | Not checked (Keppler backend not run here) |
| LightRAG | `lightrag` | Yes (library) |
| Browser speech | Chrome or Edge, internet | **Yes** |

The model servers themselves are outside this code base (see `FIXES_AND_TODO.md` scope), so none were started here.

## 9. How to check each model is working (once the servers exist)

1. `GET /vllm-api/v1/models` while signed in: 200 with a model id = the browser path works (503 = `VLLM_URL` unset, 502 = unreachable).
2. Doctor Workspace > upload a prescription photo: medicines and tests appear; the response says which engine read it.
3. Symptom AI > triage: the reply has no `fallback: true`.
4. `GET /api/ai/transcribe/status` returns `available: true`; dictate a sentence and check `BP 120/80` style output.
5. Clinical RAG: choose a patient who has documents, ask a question: an answer with `match %` citations (needs 3.3).
6. Keppler OCR: upload a page; confidence per region is shown; low-confidence handwriting is re-read by TrOCR.
