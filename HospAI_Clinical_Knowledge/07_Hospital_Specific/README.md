# 07_Hospital_Specific: Local Formulary & Clinical Policy Overrides

This directory is reserved for hospital-specific clinical governance, formulary rules, and antibiotic stewardship policies. Files placed here override national baseline recommendations.

---

## 📂 Subfolder Layout & Usage

### 1. `01_Formulary_Overrides/`
- **Purpose:** Define medicines approved for procurement and dispensing in this specific hospital.
- **Accepted Formats:** CSV, XLSX, JSON.
- **Expected Fields:** `brand_name`, `generic_name`, `strength`, `dosage_form`, `hospital_item_code`, `is_formulary` (true/false), `preferred_brand`.
- **System Behavior:** When configured, SmartRx flags non-formulary medications to clinicians and suggests hospital-preferred alternatives.

### 2. `02_Antibiotic_Reserve_Policy/`
- **Purpose:** Hospital Antimicrobial Stewardship Committee (AMSP) restriction policies.
- **Accepted Formats:** CSV, JSON, PDF.
- **Expected Fields:** `antibiotic_name`, `restriction_tier` (Access / Watch / Reserve), `requires_id_approval` (true/false), `max_empirical_duration_days`, `mandatory_culture_required` (true/false).
- **System Behavior:** Enforces local antibiotic authorization workflows before pharmacy dispensing.

### 3. `03_Local_Clinical_Protocols/`
- **Purpose:** Hospital standing orders, clinical pathways, and local treatment guidelines (e.g., Hospital Sepsis Protocol, ER Chest Pain Pathway, Post-Op Pain Management).
- **Accepted Formats:** PDF, Markdown, DOCX.
- **System Behavior:** Indexed into the local clinical knowledge vector store to appear in Doctor Workspace search results.
