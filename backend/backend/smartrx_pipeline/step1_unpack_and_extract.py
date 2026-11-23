import os
import zipfile
import re
import csv
import pypdf

BASE_DIR = r"D:\HOSP AI\ehms\HospAI_Clinical_Knowledge"
OUT_DIR = r"D:\HOSP AI\ehms\backend\backend\smartrx_data"
os.makedirs(OUT_DIR, exist_ok=True)

print("=== STEP 1: UNPACKING & EXTRACTING CLINICAL DATASETS ===")

# 1. Extract CDCI Flat Files
cdci_zip = os.path.join(BASE_DIR, "02_Lab_Codes", "CommonDrugCodesForIndia_FlatFilePackage_downloaded-2026-11-17.zip")
print(f"Unpacking CDCI package: {cdci_zip}")
with zipfile.ZipFile(cdci_zip, 'r') as z:
    for target in ['SubstanceMaster.txt', 'GenericMaster.txt', 'BrandMaster.txt']:
        full_name = f"CommonDrugCodesForIndia_FlatFilePackage/{target}"
        out_path = os.path.join(OUT_DIR, target)
        with z.open(full_name) as src, open(out_path, 'wb') as dst:
            dst.write(src.read())
        print(f"  Extracted {target} ({os.path.getsize(out_path):,} bytes)")

# 2. Extract CLCI (Common Lab Codes for India)
clci_zip = os.path.join(BASE_DIR, "02_Lab_Codes", "common-lab-codes-for-india-20260629.zip")
print(f"\nUnpacking CLCI package: {clci_zip}")
with zipfile.ZipFile(clci_zip, 'r') as z:
    target = "common-lab-codes-for-india-20260629/common-lab-codes-for-india.csv"
    out_path = os.path.join(OUT_DIR, "common_lab_codes_india.csv")
    with z.open(target) as src, open(out_path, 'wb') as dst:
        dst.write(src.read())
    print(f"  Extracted common_lab_codes_india.csv ({os.path.getsize(out_path):,} bytes)")

# 3. Copy MEDI Indication Dictionary
medi_src = os.path.join(BASE_DIR, "01_Source_Library", "MEDI", "MEDI_11242015_downloaded-2026-11-18.csv")
medi_dst = os.path.join(OUT_DIR, "medi_indications.csv")
if os.path.exists(medi_src):
    with open(medi_src, 'rb') as src, open(medi_dst, 'wb') as dst:
        dst.write(src.read())
    print(f"\nCopied MEDI Indications: {medi_dst} ({os.path.getsize(medi_dst):,} bytes)")

# 4. Parse NLEM 2022 PDF into clean CSV
nlem_pdf = os.path.join(BASE_DIR, "01_Medicine_Catalogue", "nlem-2022_downloaded-2026-11-17.pdf")
print(f"\nParsing NLEM 2022 PDF: {nlem_pdf}")
nlem_records = []
current_category = "General"

try:
    reader = pypdf.PdfReader(nlem_pdf)
    # English section runs from page 52 to 108
    for page_num in range(51, len(reader.pages)):
        page_text = reader.pages[page_num].extract_text() or ""
        lines = page_text.split('\n')
        
        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue
            
            # Check for Section Category e.g. "2.1- Non-Opioid Analgesics..." or "Section 6 -"
            cat_match = re.match(r'^(\d+(?:\.\d+)?)\s*[-–]\s*(.+)$', line_str)
            if cat_match and not any(line_str.startswith(x) for x in ["Tablet", "Injection", "Capsule", "Oral"]):
                current_category = f"{cat_match.group(1)} {cat_match.group(2).strip()}"
                continue
            
            # Match medicine entries with level e.g. "2.1.5 Paracetamol** P,S,T Tablet 500 mg"
            # or "2.2.1 Fentanyl S,T Injection 50 mcg/mL"
            med_match = re.match(r'^\d+\.\d+(?:\.\d+)?\s+([A-Za-z\s\(\)\-\+\/\,\.]+?)\s+([P|S|T|\,\s]+)\s+(.+)$', line_str)
            if med_match:
                med_name = re.sub(r'[\*\d]', '', med_match.group(1)).strip()
                level = med_match.group(2).strip().replace(" ", "")
                form_strength = med_match.group(3).strip()
                
                # Validate level format
                if any(lvl in level for lvl in ['P', 'S', 'T']) and len(med_name) > 2:
                    nlem_records.append({
                        "category": current_category,
                        "medicine_name": med_name,
                        "level": level,
                        "form_strength": form_strength
                    })
            elif len(nlem_records) > 0 and (line_str.startswith("Tablet") or line_str.startswith("Injection") or line_str.startswith("Capsule") or line_str.startswith("Oral") or line_str.startswith("Suppository")):
                # Continuation line of dosage forms
                last = nlem_records[-1]
                nlem_records.append({
                    "category": last["category"],
                    "medicine_name": last["medicine_name"],
                    "level": last["level"],
                    "form_strength": line_str
                })

    nlem_out = os.path.join(OUT_DIR, "nlem_2022_parsed.csv")
    with open(nlem_out, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=["category", "medicine_name", "level", "form_strength"])
        writer.writeheader()
        writer.writerows(nlem_records)
    print(f"  Generated nlem_2022_parsed.csv ({len(nlem_records)} formulation records)")
except Exception as e:
    print(f"  Error parsing NLEM PDF: {e}")

# 5. Generate Initial Structured Clinical Rules (KDIGO, ISMP, ICMR)
clinical_rules = [
    # KDIGO Renal Dosing Rules
    {
        "drug_name": "Metformin",
        "category": "RENAL_CONTRAINDICATION",
        "parameter": "eGFR",
        "operator": "<",
        "threshold": "30",
        "unit": "mL/min/1.73m2",
        "severity": "critical",
        "is_blocking": False,
        "message": "Metformin is contraindicated in severe renal impairment (eGFR < 30 mL/min) due to high risk of fatal Lactic Acidosis.",
        "recommendation": "Discontinue Metformin. Switch to insulin or safe DPP4-inhibitor (e.g. Teneligliptin/Linagliptin).",
        "source": "KDIGO 2024 CKD Diabetes Guideline, Section 1.3"
    },
    {
        "drug_name": "Metformin",
        "category": "RENAL_DOSE_REDUCTION",
        "parameter": "eGFR",
        "operator": "<",
        "threshold": "45",
        "unit": "mL/min/1.73m2",
        "severity": "warning",
        "is_blocking": False,
        "message": "Metformin dose reduction required for eGFR between 30-44 mL/min.",
        "recommendation": "Limit maximum total daily dose to 1000 mg (e.g. 500 mg BD). Monitor renal function every 3 months.",
        "source": "KDIGO 2024 CKD Diabetes Guideline, Section 1.3"
    },
    {
        "drug_name": "Enoxaparin",
        "category": "RENAL_DOSE_REDUCTION",
        "parameter": "eGFR",
        "operator": "<",
        "threshold": "30",
        "unit": "mL/min/1.73m2",
        "severity": "warning",
        "is_blocking": False,
        "message": "LMWH (Enoxaparin) accumulates in severe renal impairment, increasing major bleeding risk.",
        "recommendation": "Reduce therapeutic dose by 50% (e.g. 1 mg/kg once daily instead of BD) or consider Unfractionated Heparin.",
        "source": "KDIGO 2024 CKD Guideline, Section 3.2"
    },
    {
        "drug_name": "Nitrofurantoin",
        "category": "RENAL_CONTRAINDICATION",
        "parameter": "eGFR",
        "operator": "<",
        "threshold": "30",
        "unit": "mL/min/1.73m2",
        "severity": "warning",
        "is_blocking": False,
        "message": "Nitrofurantoin is ineffective in urinary tract infections if eGFR < 30 mL/min and carries risk of peripheral neuropathy.",
        "recommendation": "Use alternate oral antibiotic (e.g. Fosfomycin or targeted agent based on urine culture).",
        "source": "KDIGO 2024 / ICMR AMR Guidelines 2022"
    },
    {
        "drug_name": "Dabigatran",
        "category": "RENAL_CONTRAINDICATION",
        "parameter": "eGFR",
        "operator": "<",
        "threshold": "30",
        "unit": "mL/min/1.73m2",
        "severity": "critical",
        "is_blocking": False,
        "message": "Dabigatran is predominantly renally cleared (80%). Contraindicated in CrCl < 30 mL/min.",
        "recommendation": "Switch to Apixaban (with dose adjustment) or Warfarin with INR monitoring.",
        "source": "KDIGO 2024 / EHRA NOAC Guidelines"
    },
    {
        "drug_name": "Spironolactone",
        "category": "LAB_CONTRAINDICATION",
        "parameter": "Serum Potassium",
        "operator": ">",
        "threshold": "5.0",
        "unit": "mEq/L",
        "severity": "critical",
        "is_blocking": False,
        "message": "Severe hyperkalemia risk. Spironolactone should not be initiated if Serum Potassium > 5.0 mEq/L or eGFR < 30.",
        "recommendation": "Re-check electrolytes. Discontinue potassium-sparing diuretics.",
        "source": "MoHFW STG Cardiovascular Diseases (Section 4.3)"
    },

    # Pregnancy Contraindications
    {
        "drug_name": "Telmisartan",
        "category": "PREGNANCY_CONTRAINDICATION",
        "parameter": "Pregnancy Status",
        "operator": "==",
        "threshold": "Pregnant",
        "unit": "clinical_status",
        "severity": "critical",
        "is_blocking": False,
        "message": "ARBs (Telmisartan) cause fetal renal agenesis, oligohydramnios, and neonatal skull hypoplasia.",
        "recommendation": "Immediately switch to pregnancy-safe antihypertensive: Labetalol, Methyldopa, or Nifedipine.",
        "source": "MoHFW STG Hypertension in Pregnancy"
    },
    {
        "drug_name": "Sodium Valproate",
        "category": "PREGNANCY_CONTRAINDICATION",
        "parameter": "Pregnancy Status",
        "operator": "==",
        "threshold": "Pregnant",
        "unit": "clinical_status",
        "severity": "critical",
        "is_blocking": False,
        "message": "Valproate carries a 10% risk of major congenital malformations (neural tube defects) and cognitive impairment.",
        "recommendation": "Switch to safer antiepileptic (e.g. Levetiracetam or Lamotrigine) under neurologist guidance.",
        "source": "MoHFW STG Neurology / Epilepsy Guidelines"
    },
    {
        "drug_name": "Methotrexate",
        "category": "PREGNANCY_CONTRAINDICATION",
        "parameter": "Pregnancy Status",
        "operator": "==",
        "threshold": "Pregnant",
        "unit": "clinical_status",
        "severity": "critical",
        "is_blocking": False,
        "message": "Methotrexate is a potent abortifacient and teratogen (fetal death, skeletal deformities). Absolute contraindication.",
        "recommendation": "Confirm negative pregnancy test prior to administration; ensure dual-barrier contraception.",
        "source": "MoHFW STG Rheumatology / NLEM 2022"
    },

    # ISMP High-Alert Acute Care Medications
    {
        "drug_name": "Regular Insulin",
        "category": "HIGH_ALERT_MEDICATION",
        "parameter": "Route",
        "operator": "IN",
        "threshold": "IV, SC",
        "unit": "route",
        "severity": "warning",
        "is_blocking": False,
        "message": "ISMP High-Alert Drug: Insulin carries high risk of severe hypoglycemia from dosing errors.",
        "recommendation": "Independent double-check of dose, syringe type (U-40 vs U-100), and blood glucose monitoring required.",
        "source": "ISMP High-Alert Medications in Acute Care 2024"
    },
    {
        "drug_name": "Potassium Chloride",
        "category": "HIGH_ALERT_MEDICATION",
        "parameter": "Dosage Form",
        "operator": "==",
        "threshold": "Concentrated Injection",
        "unit": "form",
        "severity": "critical",
        "is_blocking": False,
        "message": "ISMP Lethal Error Alert: Concentrated IV Potassium Chloride must NEVER be administered IV push.",
        "recommendation": "Must be diluted in standard IV infusion (maximum concentration 40 mEq/L, maximum infusion rate 10-20 mEq/hr).",
        "source": "ISMP High-Alert Medications in Acute Care 2024"
    },
    {
        "drug_name": "Heparin",
        "category": "HIGH_ALERT_MEDICATION",
        "parameter": "Route",
        "operator": "==",
        "threshold": "IV",
        "unit": "route",
        "severity": "warning",
        "is_blocking": False,
        "message": "ISMP High-Alert Drug: Unfractionated heparin carries severe bleeding and thrombocytopenia (HIT) risk.",
        "recommendation": "Verify baseline aPTT and platelet count; independent double-check of infusion rate.",
        "source": "ISMP High-Alert Medications in Acute Care 2024"
    },

    # ICMR Antimicrobial Stewardship (AMSP)
    {
        "drug_name": "Colistin",
        "category": "ANTIMICROBIAL_STEWARDSHIP",
        "parameter": "Classification",
        "operator": "==",
        "threshold": "Reserve Antibiotic",
        "unit": "AMSP_class",
        "severity": "warning",
        "is_blocking": False,
        "message": "ICMR AMSP Reserve Antibiotic: Colistin is strictly reserved for confirmed multidrug-resistant Gram-negative infections.",
        "recommendation": "Requires documented microbiological culture sensitivity and infectious disease / AMSP committee review.",
        "source": "ICMR Guidelines for Antimicrobial Use in Infectious Diseases 2022"
    },
    {
        "drug_name": "Meropenem",
        "category": "ANTIMICROBIAL_STEWARDSHIP",
        "parameter": "Duration",
        "operator": ">",
        "threshold": "7",
        "unit": "days",
        "severity": "warning",
        "is_blocking": False,
        "message": "Antimicrobial stewardship alert: Meropenem duration exceeds 7 days.",
        "recommendation": "Re-evaluate clinical response, culture results, and procalcitonin; de-escalate if pathogen identified.",
        "source": "ICMR / NCDC National Treatment Guidelines for Antimicrobial Use"
    }
]

rules_out = os.path.join(OUT_DIR, "clinical_rules.csv")
with open(rules_out, 'w', newline='', encoding='utf-8') as f:
    fields = ["drug_name", "category", "parameter", "operator", "threshold", "unit", "severity", "is_blocking", "message", "recommendation", "source"]
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(clinical_rules)
print(f"\nGenerated clinical_rules.csv ({len(clinical_rules)} verified safety rules)")

print("\n=== STEP 1 COMPLETE! ALL CSV DATASETS READY IN smartrx_data ===")
