# Voice-to-text: where it is, where it is needed

## How it works

One microphone (`components/voice/VoiceMic.tsx`) is used everywhere.

1. **Engine.** If the hospital server has Whisper installed (`faster-whisper`, see `requirements-ai.txt`) the audio goes
   there, together with the hospital's own drug and test names as a prompt (so "amoxicillin" is spelled the way the
   pharmacy master spells it). If not, the browser's speech service is used (Chrome or Edge, needs internet). The app
   checks `/api/ai/transcribe/status` once a minute and chooses by itself.
2. **Clean-up** (`utils/dictationText.ts`, 22 automated checks). The words are turned into what would have been
   written: "bp one twenty over eighty" → `BP 120/80`, "paracetamol five hundred milligram t d s for three days" →
   `Paracetamol 500 mg TDS for 3 days`, "s p o two ninety six percent" → `SpO2 96%`, "ninety eight point six degrees
   fahrenheit" → `98.6 °F`; "full stop", "comma", "new line" work as punctuation; near-miss drug / test spellings are
   corrected against the pharmacy medicine master and the lab catalogue. Words that are also ordinary medicine
   ("colon", "period", "one of them") are left alone.
3. **Review.** The text always lands in the normal, editable box. Nothing is saved until the author presses Save. Saved
   notes carry a "🎤 dictated" mark.
4. **Languages.** English (India), Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, English (US);
   the choice is remembered per device.

**To make it as accurate as it can be:** install the server engine (`pip install faster-whisper`; set
`WHISPER_MODEL_SIZE` = `medium` for a CPU server, `large-v3` needs a GPU or a lot of patience). On a machine without it
the browser engine is used and works, but cannot be primed with the hospital's drug names, so the clean-up step does the
correcting afterwards.

## Where the microphone is now

| Area | Boxes |
|---|---|
| **In-patient (new)** | Doctor round note, plan, orders to nurses, nurse note, shift handover note |
| **Clinical chart / ICU** | Add Evaluation (evaluation notes, treatment plan) |
| **Emergency** | Symptom narrative for triage, clinical notes, disposition reason, and the 16 narrative boxes on the ER visit (arrival circumstances, resuscitation status, orders and treatment pathway, admission / transfer indication, transfer handover, observations ...) |
| **Bed Management** | Admission notes (direct admission and ER allocation), transfer reason, reason for discharging with pending items |
| **Doctor workspace (OP)** | Consultation and prescription-sheet boxes (Doctor Portal, Doctor Workflow) |
| **Nurse Station (OP)** | Nursing notes |
| **Surgery** | OT booklet (9 boxes), stat emergency, transfer to ward, transfer to ICU, surgical discharge, ward post-op care |
| **ICU** | Flowsheet notes, ICU discharge |
| **Radiology** | Reporting (findings, impression ...), worklist, operations and finalised-report remarks |
| **Laboratory** | Result entry remarks, test result modal, pathologist review, order clinical notes |
| **Insurance** | Pre-authorisation clinical justification (3 boxes), discharge finalisation |
| **One-line clinical fields** (`DictationInput`) | Diagnosis / impression (Add Evaluation, Doctor Portal review, ER doctor assessment, OT pre- and post-op diagnosis), allergies (ER triage x2, OT pre-anaesthetic), OP chief complaint (queue token), medicine instructions (Doctor Portal, Doctor Workflow, ICU, in-patient prescription), ER treatment response |

## Where it is needed most (priority order) and what is still without it

1. **Highest** (long, clinical, written under time pressure): in-patient doctor round notes ✅, ER clinical notes ✅,
   operation notes ✅, radiology reports ✅, discharge summary text. The discharge summary is compiled from the stay's notes, which are
   dictated where they are written (it has no box of its own to type into).
2. **High:** nurse notes and handover ✅, ICU flowsheet notes ✅, consultation notes ✅, pathologist comments ✅.
3. **Medium (single-line fields):** done, see the "One-line clinical fields" row. Search boxes, names, numbers and dates are
   deliberately left without a microphone.
4. **Not needed:** HR, accounts, administration, patient messages (typed, short, templated).

Not tested here: speaking into a real microphone (this server has no Whisper, and the browser engine needs a person).
The clean-up, the engine selection, the server prompt and the permission checks are covered by automated tests.
