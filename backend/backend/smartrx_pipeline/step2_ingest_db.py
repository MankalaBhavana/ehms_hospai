"""Load the staged SmartRx knowledge files into the ``smartrx`` schema.

    cd backend/backend
    python -m smartrx_pipeline.step2_ingest_db [--allow-unresolved]

Configuration (no hard-coded paths):
    DATABASE_URL        target database (same variable the API uses)
    SMARTRX_DATA_DIR    folder with BrandMaster.txt etc. (default: backend/backend/smartrx_data)

The whole load is one transaction: a failure leaves the previous knowledge untouched.
Patient-owned tables (smartrx.patient_allergy) are never truncated.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import psycopg2  # noqa: E402
from psycopg2.extras import execute_batch  # noqa: E402

from modules.smartrx import migrate  # noqa: E402
from modules.smartrx import provenance, quotes  # noqa: E402
from modules.smartrx.config import DATA_DIR, SOURCE_LOG  # noqa: E402
from modules.smartrx.textnorm import build_moiety_map, name_key, normalize_text  # noqa: E402
from utils.database import DATABASE_URL, _normalize_database_url  # noqa: E402

# Rule/class names that do not appear verbatim in SubstanceMaster.
RULE_NAME_ALIASES = {
    "regular insulin": {"token": "insulin"},  # every insulin product is on the ISMP list
    "sodium valproate": {"names": ["valproate", "valproic acid"]},
    "benzylpenicillin": {"names": ["penicillin g"]},
    "phenoxymethylpenicillin": {"names": ["penicillin v"]},
    "benzathine benzylpenicillin": {"names": ["penicillin g"]},
    "procaine benzylpenicillin": {"names": ["penicillin g"]},
    "cefalexin": {"names": ["cephalexin"]},
}

SOURCES = [
    ("CDCI", "Common Drug Codes for India", "Release 2026-08-31", "NRCeS / MoHFW"),
    ("CLCI", "Common Lab Codes for India", "Release 2026-06-29", "NRCeS / MoHFW"),
    ("NLEM", "National List of Essential Medicines", "2022 Final", "MoHFW / NPPA"),
    ("ISMP", "List of High-Alert Medications in Acute Care", "2024", "ISMP / ECRI"),
    ("KDIGO", "Clinical Practice Guideline for CKD & AKI", "2024 / 2012", "KDIGO"),
    ("ICMR_AMR", "Guidelines for Antimicrobial Use in Infectious Diseases", "2022", "ICMR"),
    ("SMARTRX_CLASSES", "SmartRx drug classes and cross-reactivity", "Phase 1", "HospAI (pending clinical sign-off)"),
]


def key_in(n, rep):
    return name_key(n) in rep


def _tsv(name):
    return csv.DictReader(open(DATA_DIR / name, "r", encoding="utf-8", errors="ignore"), delimiter="\t")


def _csv(name):
    return csv.DictReader(open(DATA_DIR / name, "r", encoding="utf-8", errors="ignore"))


def _route_hint(generic_name):
    n = (generic_name or "").lower()
    if re.search(r"injection|infusion|injectable", n):
        return "parenteral"
    if re.search(r"\boral\b|tablet|capsule|syrup|suspension|chewable|lozenge", n):
        return "oral"
    if re.search(r"cream|ointment|gel|lotion|topical|dermal|shampoo", n):
        return "topical"
    if re.search(r"eye|ophthalmic", n):
        return "ophthalmic"
    if re.search(r"inhal|nebul|nasal", n):
        return "inhalation"
    return None


def _load_synonyms():
    out = {}
    path = DATA_DIR / "drug_synonyms.csv"
    if path.exists():
        for r in csv.DictReader(open(path, encoding="utf-8")):
            out[r["synonym"].strip().lower()] = [c.strip() for c in r["components"].split("|") if c.strip()]
    return out


SYNONYMS = _load_synonyms()


def resolve_names(names, rep, token_index):
    """Resolve drug names to moiety identifiers. Returns (moieties, unresolved_names)."""
    found, missing = set(), []
    for raw in names:
        n = raw.strip().lower()
        alias = RULE_NAME_ALIASES.get(n, {})
        if not alias and n in SYNONYMS and not key_in(n, rep):
            alias = {"names": SYNONYMS[n]}
        hit = set()
        if "token" in alias:
            hit |= token_index.get(alias["token"], set())
        for cand in alias.get("names", [n]):
            key = name_key(cand)
            if key in rep:
                hit.add(rep[key])
        (found.update(hit) if hit else missing.append(raw))
    return found, missing


def stamp(cur, table, where_sql, where_params, filename, row, source_ids, problems):
    """Record provenance for the row just inserted; collect (not raise) problems so all are reported at once."""
    for p in provenance.check_row(filename, row, source_ids):
        problems.append(f"{filename}: {row.get('drug') or row.get('a') or row.get('target') or row.get('class_code') or row.get('drug_name') or row.get('from_class')}: {p}")
    prov, f = provenance.effective(filename, row)
    if prov not in provenance.PROVENANCE_VALUES:
        return
    if prov == "verified" and f["source_id"] and f["source_page"] and f["source_quote"]:
        ok, reason = quotes.verify_quote(cur, f["source_id"], f["source_page"], f["source_quote"])
        if not ok:
            problems.append(f"{filename}: {row.get('drug') or row.get('a') or row.get('target') or row.get('drug_name') or row.get('from_class')}: citation not verified: {reason}")
    final_status = (row.get("status") or provenance.DEFAULT_STATUS.get(filename, "draft")).strip().lower()
    cur.execute(f"""UPDATE smartrx.{table} SET status=%s, provenance=%s, source_id=%s, source_page=%s, source_section=%s, source_quote=%s,
                        extracted_by=%s, reviewed_by=COALESCE(%s, reviewed_by), approved_by=%s, approved_at=%s
                    WHERE {where_sql}""",
                (final_status, prov, f["source_id"], f["source_page"], f["source_section"], f["source_quote"], f["extracted_by"],
                 f["reviewed_by"], f["approved_by"], f["approved_at"], *where_params))


def last_id(cur, table):
    cur.execute(f"SELECT currval(pg_get_serial_sequence('smartrx.{table}', 'id'))")
    return cur.fetchone()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-unresolved", action="store_true",
                    help="load even if some rule/class members match no substance (they are reported)")
    args = ap.parse_args()

    print(f"=== SmartRx ingest | data: {DATA_DIR}")
    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    applied = migrate.run(conn)
    print("Migrations applied:", applied or "none (up to date)")
    cur = conn.cursor()

    try:
        problems = []
        source_ids = provenance.load_source_ids(SOURCE_LOG)
        cur.execute("TRUNCATE smartrx.guideline_source")
        if SOURCE_LOG.exists():
            with open(SOURCE_LOG, encoding="utf-8-sig", newline="") as fh:
                rows = [(r["source_id"].strip(), r.get("source_name"), r.get("publisher"), r.get("url"), r.get("version_or_date"),
                         r.get("downloaded_on"), r.get("filename"), r.get("sha256"), r.get("licence"))
                        for r in csv.DictReader(fh) if r.get("source_id")]
            execute_batch(cur, "INSERT INTO smartrx.guideline_source VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", rows)
            print(f"Guideline register: {len(rows)} sources from {SOURCE_LOG.name}")
        else:
            print(f"WARNING: {SOURCE_LOG} not found; no source can be verified")

        # ---- knowledge sources
        cur.execute("TRUNCATE smartrx.knowledge_sources RESTART IDENTITY")
        execute_batch(cur, "INSERT INTO smartrx.knowledge_sources (source_code, source_name, source_version, publisher) VALUES (%s,%s,%s,%s)", SOURCES)

        # ---- substances + moieties
        subs = []
        for r in _tsv("SubstanceMaster.txt"):
            ident, name = (r.get("Identifier") or "").strip(), (r.get("Substance Name") or "").strip()
            if ident and name:
                subs.append((ident, name, r))
        id_to_moiety, rep = build_moiety_map((i, n) for i, n, _ in subs)
        token_index = {}
        for key, moiety in rep.items():
            for tok in key:
                token_index.setdefault(tok, set()).add(moiety)

        cur.execute("TRUNCATE smartrx.substance_master CASCADE")
        execute_batch(cur, """
            INSERT INTO smartrx.substance_master (identifier, substance_name, cas_number, unii, description,
                molecular_weight, toxicity, smiles, iupac_name, molecular_formula, moiety_identifier)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (identifier) DO NOTHING""",
            [(i, n[:500], (r.get("CAS Number") or "")[:100], (r.get("UNII") or "")[:100],
              r.get("Substance Description") or "", (r.get("Molecular Weight") or "")[:50],
              r.get("Toxicity") or "", r.get("SMILE") or "", r.get("IUPAC Name") or "",
              (r.get("Molecular Formula") or "")[:100], id_to_moiety[i]) for i, n, r in subs],
            page_size=2000)
        print(f"Substances: {len(subs):,} -> {len(set(id_to_moiety.values())):,} moieties")

        # ---- generics
        generic = {}
        gen_rows = []
        for r in _tsv("GenericMaster.txt"):
            ident, name = (r.get("Identifier") or "").strip(), (r.get("Generic Name") or "").strip()
            if not (ident and name):
                continue
            sub = (r.get("Substance Identifier") or "").strip()
            generic[ident] = {"name": name, "sub": sub, "form": (r.get("Dose Form") or "").strip(),
                              "route": (r.get("Route of Administration") or "").strip()}
            gen_rows.append((ident, name[:500], sub[:500], generic[ident]["route"][:255], generic[ident]["form"][:255],
                             r.get("Therapeutic Role") or "", r.get("Indication") or "", r.get("Contra Indication") or "",
                             r.get("Interaction with Drugs") or "", r.get("Classification of Drugs") or ""))
        cur.execute("TRUNCATE smartrx.generic_master CASCADE")
        execute_batch(cur, """INSERT INTO smartrx.generic_master (identifier, generic_name, substance_identifier, route,
            dose_form, therapeutic_role, indication, contra_indication, drug_interaction, classification)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (identifier) DO NOTHING""", gen_rows, page_size=2000)
        print(f"Generics: {len(gen_rows):,}")

        # ---- labs
        cur.execute("TRUNCATE smartrx.lab_test_catalog CASCADE")
        labs = [((r.get("LOINC Code") or "").strip()[:50], (r.get("General Name") or "").strip()[:500],
                 r.get("Fully-Specified Name (FSN)") or "", r.get("Long Common Name") or "")
                for r in _csv("common_lab_codes_india.csv")]
        execute_batch(cur, "INSERT INTO smartrx.lab_test_catalog (loinc_code, general_name, fsn_name, long_common_name) VALUES (%s,%s,%s,%s) ON CONFLICT (loinc_code) DO NOTHING",
                      [l for l in labs if l[0] and l[1]], page_size=1000)
        print(f"Lab tests: {len(labs):,}")

        # ---- NLEM (matched to brands by moiety set, not substring)
        nlem_rows, nlem_by_moieties = [], {}
        for r in _csv("nlem_2022_parsed.csv"):
            med = (r.get("medicine_name") or "").strip()
            if not med:
                continue
            lvl = (r.get("level") or "").strip()
            nlem_rows.append(((r.get("category") or "")[:255], med[:255], lvl[:50], r.get("form_strength") or ""))
            parts = [p for p in re.split(r"\s*(?:\+|\band\b|\bwith\b)\s*", med, flags=re.I) if p.strip()]
            moieties, missing = resolve_names(parts, rep, token_index)
            if moieties and not missing:
                prev = nlem_by_moieties.get(frozenset(moieties), "")
                nlem_by_moieties[frozenset(moieties)] = ",".join(sorted(set((prev + "," + lvl).strip(",").split(","))))
        cur.execute("TRUNCATE smartrx.nlem_catalog CASCADE")
        execute_batch(cur, "INSERT INTO smartrx.nlem_catalog (category, medicine_name, level, form_strength) VALUES (%s,%s,%s,%s)", nlem_rows, page_size=1000)
        print(f"NLEM: {len(nlem_rows):,} ({len(nlem_by_moieties):,} matched to moieties)")

        # ---- clinical rules + rule_moiety
        cur.execute("TRUNCATE smartrx.clinical_rules RESTART IDENTITY CASCADE")
        unresolved = []
        high_alert_moieties = set()
        rule_defs = []
        for r in _csv("clinical_rules.csv"):
            name = (r.get("drug_name") or "").strip()
            moieties, missing = resolve_names([name], rep, token_index)
            if missing:
                unresolved.append(f"rule drug '{name}'")
            if r.get("category") == "HIGH_ALERT_MEDICATION":
                high_alert_moieties |= moieties
            cur.execute("""INSERT INTO smartrx.clinical_rules (drug_name, category, parameter, operator, threshold, unit,
                    severity, is_blocking, message, recommendation, source, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'draft') RETURNING id""",
                (name[:255], (r.get("category") or "")[:100], (r.get("parameter") or "")[:100],
                 (r.get("operator") or "")[:20], (r.get("threshold") or "")[:100], (r.get("unit") or "")[:50],
                 (r.get("severity") or "warning")[:50], (r.get("is_blocking") or "").lower() == "true",
                 r.get("message") or "", r.get("recommendation") or "", r.get("source") or ""))
            rid = cur.fetchone()[0]
            stamp(cur, 'clinical_rules', 'id = %s', (rid,), 'clinical_rules.csv', r, source_ids, problems)
            rule_defs.append((name, r.get("category"), r.get("parameter"), r.get("operator"), r.get("threshold"), sorted(moieties)))
            execute_batch(cur, "INSERT INTO smartrx.rule_moiety (rule_id, moiety_identifier) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                          [(rid, m) for m in moieties])
        print(f"Rules: {len(rule_defs)}")

        # ---- drug classes, members, cross-reactivity
        cur.execute("TRUNCATE smartrx.drug_class CASCADE")
        class_defs = []
        for r in _csv("drug_classes.csv"):
            code = r["class_code"].strip()
            cur.execute("""INSERT INTO smartrx.drug_class (class_code, class_name, kind, source, status)
                           VALUES (%s,%s,%s,%s,%s)""", (code, r["class_name"], r["kind"], r["source"], "draft"))
            stamp(cur, "drug_class", "class_code = %s", (code,), "drug_classes.csv", r, source_ids, problems)
            for alias in filter(None, (a.strip().lower() for a in r["aliases"].split("|"))):
                cur.execute("INSERT INTO smartrx.drug_class_alias VALUES (%s,%s) ON CONFLICT DO NOTHING", (code, alias))
            members = [m for m in r["members"].split("|") if m.strip()]
            moieties, missing = resolve_names(members, rep, token_index)
            # Members legitimately absent from the Indian substance list are reported, not fatal.
            for m in moieties:
                cur.execute("INSERT INTO smartrx.drug_class_member VALUES (%s,%s) ON CONFLICT DO NOTHING", (code, m))
            if not moieties:
                unresolved.append(f"class {code} has no resolvable members")
            if missing:
                print(f"  class {code}: {len(missing)} member names not in SubstanceMaster: {', '.join(missing)}")
            class_defs.append((code, r["status"], sorted(moieties)))
        xr_defs = []
        for r in _csv("cross_reactivity.csv"):
            cur.execute("""INSERT INTO smartrx.cross_reactivity (from_class, to_class, severity, message, recommendation, source, status)
                           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                        (r["from_class"], r["to_class"], r["severity"], r["message"], r["recommendation"], r["source"], "draft"))
            stamp(cur, "cross_reactivity", "id = %s", (last_id(cur, "cross_reactivity"),), "cross_reactivity.csv", r, source_ids, problems)
            xr_defs.append((r["from_class"], r["to_class"], r["status"]))
        print(f"Classes: {len(class_defs)}, cross-reactivity pairs: {len(xr_defs)}")

        cur.execute("TRUNCATE smartrx.drug_synonym")
        syn_defs = []
        for r in _csv("drug_synonyms.csv"):
            moieties, missing = resolve_names([c for c in r["components"].split("|") if c.strip()], rep, token_index)
            if missing:
                unresolved.append(f"synonym '{r['synonym']}' components not found: {', '.join(missing)}")
            for m in moieties:
                cur.execute("INSERT INTO smartrx.drug_synonym VALUES (%s,%s) ON CONFLICT DO NOTHING", (r["synonym"].strip().lower(), m))
            syn_defs.append((r["synonym"], sorted(moieties)))
        print(f"Synonyms: {len(syn_defs)}")


        # ---- Phase 2 knowledge: interactions, dose limits, reproductive risk, antibiotic policy
        class_codes = {c[0] for c in class_defs}

        def ref(kind, value, label):
            """Resolve an interaction/reproductive endpoint to (kind, ref) or None."""
            if kind == "class":
                return ("class", value) if value in class_codes else None
            moieties, _ = resolve_names([value], rep, token_index)
            if len(moieties) != 1:
                return None
            return ("substance", next(iter(moieties)))

        def reviewer(r):
            return (r.get("reviewed_by") or None, r.get("reviewed_at") or None)

        cur.execute("TRUNCATE smartrx.drug_interaction RESTART IDENTITY")
        ix_defs, skipped_candidates = [], 0
        for fname, evidence in (("drug_interactions.csv", "curated"), ("interaction_label_candidates.csv", "label_text")):
            if not (DATA_DIR / fname).exists():
                continue
            for r in _csv(fname):
                a, b = ref(r["a_kind"], r["a"], "a"), ref(r["b_kind"], r["b"], "b")
                if not a or not b or a == b:
                    if evidence == "curated":
                        unresolved.append(f"interaction {r['a']} + {r['b']}")
                    else:
                        skipped_candidates += 1
                    continue
                rb, ra = reviewer(r)
                cur.execute("""INSERT INTO smartrx.drug_interaction (a_kind,a_ref,b_kind,b_ref,severity,mechanism,message,recommendation,
                                   source,evidence,evidence_excerpt,status,reviewed_by,reviewed_at)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (*a, *b, r["severity"], r.get("mechanism"), r["message"], r.get("recommendation"), r.get("source"),
                             evidence, r.get("excerpt"), "draft", rb, ra))
                stamp(cur, "drug_interaction", "id = %s", (last_id(cur, "drug_interaction"),), fname, r, source_ids, problems)
                ix_defs.append((a, b, r["severity"], r["status"], evidence))
        print(f"Interactions: {len(ix_defs)} ({skipped_candidates} label candidates skipped: name not resolvable)")

        cur.execute("TRUNCATE smartrx.dose_limit RESTART IDENTITY")
        dose_defs = []
        for r in _csv("dose_limits.csv"):
            moieties, _ = resolve_names([r["drug"]], rep, token_index)
            if len(moieties) != 1:
                unresolved.append(f"dose limit drug '{r['drug']}'")
                continue
            m = next(iter(moieties))
            num = lambda k: (r.get(k) or "").strip() or None  # noqa: E731
            rb, ra = reviewer(r)
            cur.execute("""INSERT INTO smartrx.dose_limit (moiety_identifier,population,max_single_mg,max_daily_mg,max_mg_per_kg_day,
                               max_doses_per_week,note,source,status,reviewed_by,reviewed_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (m, r["population"], num("max_single_mg"), num("max_daily_mg"), num("max_mg_per_kg_day"),
                         num("max_doses_per_week"), r.get("note"), r.get("source"), "draft", rb, ra))
            stamp(cur, "dose_limit", "id = %s", (last_id(cur, "dose_limit"),), "dose_limits.csv", r, source_ids, problems)
            dose_defs.append((m, r["population"], num("max_single_mg"), num("max_daily_mg"), num("max_mg_per_kg_day"), num("max_doses_per_week"), r["status"]))
        print(f"Dose limits: {len(dose_defs)}")

        cur.execute("TRUNCATE smartrx.reproductive_risk RESTART IDENTITY")
        repro_defs = []
        for r in _csv("reproductive_risk.csv"):
            t = ref(r["target_kind"], r["target"], "target")
            if not t:
                unresolved.append(f"reproductive risk target '{r['target']}'")
                continue
            rb, ra = reviewer(r)
            cur.execute("""INSERT INTO smartrx.reproductive_risk (target_kind,target_ref,context,severity,message,recommendation,source,status,reviewed_by,reviewed_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (*t, r["context"], r["severity"], r["message"], r.get("recommendation"), r.get("source"), "draft", rb, ra))
            stamp(cur, "reproductive_risk", "id = %s", (last_id(cur, "reproductive_risk"),), "reproductive_risk.csv", r, source_ids, problems)
            repro_defs.append((t, r["context"], r["severity"], r["status"]))
        print(f"Reproductive-risk rules: {len(repro_defs)}")

        cur.execute("DELETE FROM smartrx.antibiotic_policy WHERE hospital_id IS NULL")  # hospital rows are runtime data
        policy_defs = []
        for r in _csv("antibiotic_policy.csv"):
            moieties, missing = resolve_names([r["drug"]], rep, token_index)
            if len(moieties) != 1:
                unresolved.append(f"antibiotic policy drug '{r['drug']}'")
                continue
            m = next(iter(moieties))
            cur.execute("""INSERT INTO smartrx.antibiotic_policy (hospital_id,moiety_identifier,tier,restricted_to,requires_justification,message,source,status)
                           VALUES (NULL,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (m, r["tier"], r.get("restricted_to"), (r.get("requires_justification") or "").lower() == "true",
                         r.get("message"), r.get("source"), "draft"))
            if cur.rowcount == 1:
                stamp(cur, "antibiotic_policy", "id = %s", (last_id(cur, "antibiotic_policy"),), "antibiotic_policy.csv", r, source_ids, problems)
            policy_defs.append((m, r["tier"], r["status"]))
        print(f"Antibiotic policy rows: {len(policy_defs)}")

        if problems:
            raise SystemExit("Provenance problems (nothing was written):\n  " + "\n  ".join(problems[:60])
                             + (f"\n  ... and {len(problems) - 60} more" if len(problems) > 60 else ""))
        if unresolved and not args.allow_unresolved:
            raise SystemExit("Unresolved knowledge entries (nothing was written):\n  " + "\n  ".join(unresolved)
                             + "\nFix the names/aliases or pass --allow-unresolved.")
        for u in unresolved:
            print("  WARNING unresolved:", u)

        # ---- brands -> catalog
        cur.execute("TRUNCATE smartrx.medication_catalog_items RESTART IDENTITY CASCADE")
        brands = []
        for r in _tsv("BrandMaster.txt"):
            b_id, b_name = (r.get("Identifier") or "").strip(), (r.get("Brand Name") or "").strip()
            if not (b_id and b_name):
                continue
            g_id = (r.get("Generic Identifier") or "").strip()
            g = generic.get(g_id, {})
            sub_ids = [s for s in (g.get("sub") or "").split("+") if s]
            moieties = sorted({id_to_moiety.get(s, s) for s in sub_ids})
            nlem = nlem_by_moieties.get(frozenset(moieties)) if moieties else None
            brands.append((b_id[:100], b_name[:500], g_id[:100] or None, (g.get("name") or None) and g["name"][:500],
                           (g.get("sub") or None) and g["sub"][:500], (g.get("form") or None) and g["form"][:255],
                           (g.get("route") or None) and g["route"][:255], nlem, bool(set(moieties) & high_alert_moieties),
                           "+".join(moieties)[:500] or None, _route_hint(g.get("name")), normalize_text(b_name)))
        execute_batch(cur, """INSERT INTO smartrx.medication_catalog_items (brand_identifier, brand_name, generic_identifier,
                generic_name, substance_identifiers, dose_form, route, nlem_level, is_high_alert, moiety_identifiers,
                route_hint, name_norm)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (brand_identifier) DO NOTHING""", brands, page_size=3000)
        no_moiety = sum(1 for b in brands if not b[9])
        print(f"Brands: {len(brands):,} ({no_moiety:,} without substance mapping -> will be 'partially_checked')")

        # ---- rule-set version (content hash of everything the safety checks depend on)
        prov_snapshot = []
        for t in ("clinical_rules", "cross_reactivity", "drug_interaction", "dose_limit", "reproductive_risk", "antibiotic_policy"):
            cur.execute(f"SELECT provenance, status, source_id, source_page, source_quote FROM smartrx.{t} WHERE hospital_id IS NULL ORDER BY id"
                        if t == "antibiotic_policy" else f"SELECT provenance, status, source_id, source_page, source_quote FROM smartrx.{t} ORDER BY id")
            prov_snapshot.append(cur.fetchall())
        digest = hashlib.sha256(json.dumps([prov_snapshot, rule_defs, class_defs, xr_defs, syn_defs, ix_defs, dose_defs, repro_defs, policy_defs], sort_keys=True).encode()).hexdigest()
        version = f"{date.today():%Y.%m.%d}-{digest[:8]}"
        cur.execute("""INSERT INTO smartrx.rule_set_state (id, version, content_hash, built_at)
                       VALUES (1, %s, %s, NOW())
                       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, content_hash = EXCLUDED.content_hash, built_at = NOW()""",
                    (version, digest))
        conn.commit()
        print(f"=== Committed. rule_set_version = {version}")
        cur.execute("""SELECT 'clinical_rules', provenance, status, COUNT(*) FROM smartrx.clinical_rules GROUP BY 2,3
                       UNION ALL SELECT 'interactions', provenance, status, COUNT(*) FROM smartrx.drug_interaction GROUP BY 2,3
                       UNION ALL SELECT 'dose_limits', provenance, status, COUNT(*) FROM smartrx.dose_limit GROUP BY 2,3
                       UNION ALL SELECT 'reproductive', provenance, status, COUNT(*) FROM smartrx.reproductive_risk GROUP BY 2,3
                       UNION ALL SELECT 'cross_reactivity', provenance, status, COUNT(*) FROM smartrx.cross_reactivity GROUP BY 2,3
                       UNION ALL SELECT 'antibiotic_policy', provenance, status, COUNT(*) FROM smartrx.antibiotic_policy GROUP BY 2,3
                       ORDER BY 1,2,3""")
        print("Knowledge by provenance (table | provenance | status | rows):")
        for row in cur.fetchall():
            print("  %-18s %-10s %-9s %d" % row)
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
