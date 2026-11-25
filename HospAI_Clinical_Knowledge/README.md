# HospAI Clinical Knowledge Base (CKB) & SmartRx Architecture

Authoritative Clinical Decision Support (CDS) Knowledge Repository for **HospAI EHMS** and the **SmartRx Prescribing Safety Engine**.

---

## 📁 Directory Architecture

```
HospAI_Clinical_Knowledge/
│
├── 00_Staged_CSVs_For_Ingestion/    # Pre-processed, clean CSV & TSV tables ready for database seeding
│   ├── BrandMaster.txt               # 93,911 Indian commercial brand formulations
│   ├── GenericMaster.txt             # 10,305 generic clinical entities with therapeutic roles
│   ├── SubstanceMaster.txt           # 3,283 active chemical substances mapped to SNOMED CT
│   ├── common_lab_codes_india.csv    # 1,473 Indian clinical lab investigations mapped to LOINC
│   ├── nlem_2022_parsed.csv          # 701 essential medicine formulations (Primary, Secondary, Tertiary)
│   ├── medi_indications.csv          # 101,394 drug-to-disease ICD-10 indication mappings
│   └── clinical_rules.csv            # Deterministic KDIGO renal, ISMP high-alert & ICMR rules
│
├── 01_Medicine_Catalogue/            # National formulary lists, DISB search engines & NLEM
│   ├── nlem-2022_downloaded-2026-11-17.pdf
│   ├── DISB_Release_Note_v1.25_downloaded-2026-11-18.pdf
│   └── DrugInfromationServiceBundle_v1.25/   # Extracted Lucene search engine & bundle
│
├── 01_Source_Library/                # International standards, foreign terminologies & evidence bases
│   ├── HL7_FHIR/                     # FHIR R4 Specification & CDS Hooks (order-select, order-sign)
│   ├── RxNorm/                       # NLM prescribable content & terminology mapping
│   ├── MEDI/                         # Medication-indication repository (RxCUI to ICD-9/10)
│   ├── ISMP/                         # List of High-Alert Medications in Acute Care Settings
│   ├── KDIGO/                        # 12 Nephrology clinical practice guidelines (CKD, AKI, BP, Diabetes)
│   ├── ICMR_Guidelines/              # 11 ICMR AMR, AMSP, and pediatric oncology guidelines
│   ├── ICMR_STW/                     # 10 Standard Treatment Workflows for Neonates & Pediatrics
│   ├── NCDC/                         # 13 National CDC antimicrobial stewardship & HAI guidelines
│   ├── NTEP/                         # 8 National Tuberculosis Elimination Programme guidelines
│   ├── CLNtk/                        # C-DAC LOINC Lab Toolkit package
│   ├── UCUM/                         # Unified Code for Units of Measure specification
│   ├── DailyMed/                     # FDA structured drug labels
│   ├── LactMed/                      # Drugs and lactation database
│   ├── CDSCO/                        # Indian drug regulatory alerts & notices
│   ├── AASLD/                        # Liver disease and hepatic dosing guidance
│   ├── WHO_ICD/                      # ICD-10 Reference Manual
│   └── WHO_Patient_Safety/           # Global patient safety action plan & high-risk protocols
│
├── 02_Lab_Codes/                     # Official Indian National Coding Systems (CDCI & CLCI)
│   ├── CommonDrugCodesForIndia_FlatFilePackage/   # Flat file package for CDCI
│   ├── common-lab-codes-for-india-20260629/      # Flat file package for CLCI LOINC
│   ├── DrugInformationServiceBundle_v1.0/        # DISB v1.0 release bundle
│   └── Release notes PDFs (CDCI, CLCI, DISB)
│
├── 03_SNOMED/                        # Indian National Extensions from NRCeS
│   ├── SNOMED CT India Drug Extension Release Notes
│   ├── SNOMED CT India AYUSH Extension Release Notes
│   └── Patient Instructions Multilingual Language Extension
│
├── 04_ICMR_NCDC_Antimicrobial/       # National Antimicrobial Guidelines & Stewardship
│   ├── amr17_downloaded-2026-11-17.pdf  # NCDC National Treatment Guidelines for Antimicrobial Use
│   └── 86111_downloaded-2026-11-17.pdf  # MoHFW Standard Treatment Guidelines on Antimicrobial Use
│
├── 05_MoHFW_STG/                     # 60 Standard Treatment Guidelines across 23 Specialties
│   ├── 01_Cardiovascular_Diseases    ├── 09_Medicine_Respiratory    ├── 17_Laboratory_Medicine
│   ├── 02_Critical_Care              ├── 10_Medicine_Non_Respiratory ├── 18_GI_Surgery
│   ├── 03_Gastroenterological        ├── 11_Paediatrics              ├── 19_Neurology
│   ├── 04_Obstetrics_and_Gynaecology ├── 12_General_Surgery          ├── 20_Epilepsy
│   ├── 05_Haemodialysis              ├── 13_Interventional_Radiology ├── 21_Endocrinology
│   ├── 06_Ophthalmology              ├── 14_Oncology                 ├── 22_National_Health_Programmes
│   ├── 07_ENT                        ├── 15_Organ_Transplant_Liver   └── 23_AYUSH
│   └── 08_Orthopaedics               └── 16_Urology
│
├── 06_Other_Guidelines/              # KDIGO summaries & Pharmacovigilance Programme of India (PvPI)
│   ├── KDIGO AKI & CKD summary recommendations
│   └── PvPI Adverse Drug Reaction (ADR) reporting forms, causality assessment & SOPs
│
├── 07_Hospital_Specific/             # Local Hospital Tenant Overrides
│   ├── 01_Formulary_Overrides/       # Custom hospital-approved formulary items
│   ├── 02_Antibiotic_Reserve_Policy/ # Local restricted/reserve antibiotic authorization rules
│   └── 03_Local_Clinical_Protocols/  # Hospital-specific clinical pathways & standing orders
│
├── Source_Log.csv                    # Master audit log: 214 tracked sources with SHA256 hashes & licensing
└── Scripts_Log.csv                   # Registry of 29 ingestion, validation & verification scripts
```

---

## ⚡ Live PostgreSQL Database Integration (`smartrx` schema)

The staged CSVs in `00_Staged_CSVs_For_Ingestion` are actively synchronized with PostgreSQL:

| Database Table | Ingested Count | Performance / Role |
| :--- | :---: | :--- |
| `smartrx.medication_catalog_items` | **93,911 brands** | Instant typeahead search (<3 ms) with GIN index |
| `smartrx.generic_master` | **10,305 generics** | Clinical formulation & therapeutic role matching |
| `smartrx.substance_master` | **3,283 substances** | Active chemical molecules & SNOMED CT allergy IDs |
| `smartrx.lab_test_catalog` | **1,473 tests** | Indian standardized lab test dictionary (LOINC) |
| `smartrx.nlem_catalog` | **701 formulations** | Essential medicine tiering (`P`, `S`, `T`) |
| `smartrx.clinical_rules` | **14 rules** | Deterministic KDIGO renal, ISMP high-alert & ICMR limits |
| `smartrx.knowledge_sources` | **6 sources** | Audit provenance and release version tracking |

---

## 🔒 Clinical Governance & Safety Policy

1. **Deterministic Safety Rules:**
   - Drug-allergy matching, duplicate therapies, high-alert drug warnings, and renal contraindications (KDIGO cutoffs) are evaluated via **deterministic database logic**, ensuring **zero hallucination** and 100% reproducibility.
2. **Prescription Signing Autonomy:**
   - Critical safety alerts are styled prominently in the Doctor Workspace, but `is_blocking: false` is enforced so that clinical decision-making remains with the prescribing physician.
3. **Manual / Unmapped Drug Entries:**
   - When a clinician enters a medicine not found in the catalogue, SmartRx labels it as `insufficient_data` / `partially_checked`, explicitly informing the doctor that safety checks are limited.
