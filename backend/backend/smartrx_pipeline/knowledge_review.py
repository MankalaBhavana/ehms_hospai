"""Turn a reviewer's extraction sheet into knowledge rows, and take them through two-person approval.

    cd backend/backend
    python smartrx_pipeline/knowledge_review.py template --kind dose_limit        # header + example for the sheet
    python smartrx_pipeline/knowledge_review.py submit extractions.csv            # validate only (nothing is written)
    python smartrx_pipeline/knowledge_review.py submit extractions.csv --apply    # append accepted rows as draft/cited
    python smartrx_pipeline/knowledge_review.py list                              # rows waiting for approval
    python smartrx_pipeline/knowledge_review.py approve --row-id ab12cd34 --reviewer "Dr A" --approver "Dr B"

The life of a rule
  1. EXTRACT   a person copies a guideline passage into a sheet row (kind, subject, severity, message, source_id, page, exact quote, their name).
               `submit` checks: names resolve to real substances/classes, values are valid, the quote really is on that page of an indexed,
               untampered, non-OCR document, the source is Indian for treatment content, and it is not a duplicate.
               Accepted rows are appended to the knowledge CSV as  status=draft, provenance=cited  (inactive).
  2. APPROVE   a second named person re-reads the page and runs `approve`. It re-verifies the quote and enforces: reviewer != approver,
               approver != extractor. The row becomes  status=approved, provenance=verified  and is picked up by the next ingest.
Names must be real people: AI/system names are refused. The CSV files are the source of truth, so every change is a reviewable git diff.
"""
import argparse
import csv
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.smartrx import quotes  # noqa: E402
from modules.smartrx.config import DATA_DIR  # noqa: E402

SEVERITIES = ("critical", "warning", "info")
NOT_A_PERSON = re.compile(r"\b(claude|chatgpt|gpt|copilot|assistant|ai|bot|auto|automated|system|script)\b", re.I)
INDIA_ONLY_KINDS = ("clinical_rule", "antibiotic_policy")      # treatment content: foreign sources never decide it
RULE_CATEGORIES = ("RENAL_CONTRAINDICATION", "RENAL_DOSE_REDUCTION", "LAB_CONTRAINDICATION", "PREGNANCY_CONTRAINDICATION",
                   "HIGH_ALERT_MEDICATION", "ANTIMICROBIAL_STEWARDSHIP")
ENGINE_PARAMETERS = ("egfr", "pregnancy status", "serum potassium", "classification", "duration", "route", "dosage form")
CITATION = ["source_id", "source_page", "source_quote", "extracted_by"]

KINDS = {
    "dose_limit": {"file": "dose_limits.csv", "required": ["drug", "population"],
                   "fields": ["drug", "population", "max_single_mg", "max_daily_mg", "max_mg_per_kg_day", "max_doses_per_week", "note"]},
    "interaction": {"file": "drug_interactions.csv", "required": ["a_kind", "a", "b_kind", "b", "severity", "message"],
                    "fields": ["a_kind", "a", "b_kind", "b", "severity", "mechanism", "message", "recommendation"]},
    "reproductive_risk": {"file": "reproductive_risk.csv", "required": ["target_kind", "target", "context", "severity", "message"],
                          "fields": ["target_kind", "target", "context", "severity", "message", "recommendation"]},
    "antibiotic_policy": {"file": "antibiotic_policy.csv", "required": ["drug", "tier"],
                          "fields": ["drug", "tier", "restricted_to", "requires_justification", "message"]},
    "clinical_rule": {"file": "clinical_rules.csv", "required": ["drug_name", "category", "parameter", "operator", "threshold", "severity", "message"],
                      "fields": ["drug_name", "category", "parameter", "operator", "threshold", "unit", "severity", "is_blocking", "message", "recommendation"]},
}
ENUMS = {"population": ("adult", "child"), "severity": SEVERITIES, "context": ("pregnancy", "lactation"),
         "tier": ("access", "watch", "reserve", "unrestricted"), "a_kind": ("substance", "class"), "b_kind": ("substance", "class"),
         "target_kind": ("substance", "class"), "operator": ("<", "<=", ">", ">=", "==", "!=", "IN"), "category": RULE_CATEGORIES}
NUMERIC = ("max_single_mg", "max_daily_mg", "max_mg_per_kg_day", "max_doses_per_week")
TRACKING = ["status", "provenance", "row_id", "jurisdiction", "source_id", "source_page", "source_section", "source_quote",
            "extracted_by", "reviewed_by", "reviewed_at", "approved_by", "approved_at"]


# ------------------------------------------------------------------------------------------------- csv io

def read_csv(path: Path):
    raw = path.read_bytes().decode("utf-8-sig")
    nl = "\r\n" if "\r\n" in raw else "\n"
    reader = csv.DictReader(raw.splitlines())
    return list(reader), list(reader.fieldnames or []), nl


def write_csv(path: Path, rows, fieldnames, nl):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator=nl, extrasaction="ignore", restval="")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def is_person(name):
    n = (name or "").strip()
    return len(n) >= 3 and not NOT_A_PERSON.search(n)


# ------------------------------------------------------------------------------------------------- validation

def resolve_subject(cur, kb, kind, ref, class_codes):
    """True if `ref` is a known substance (by name) or class code."""
    if kind == "class":
        return ref in class_codes
    return kb.moiety_for_name(ref.strip().lower()) is not None


def row_key(kind, r):
    g = lambda k: (r.get(k) or "").strip().lower()  # noqa: E731
    if kind == "dose_limit":
        return (g("drug"), g("population"))
    if kind == "interaction":
        return tuple(sorted([(g("a_kind"), g("a")), (g("b_kind"), g("b"))]))
    if kind == "reproductive_risk":
        return (g("target_kind"), g("target"), g("context"))
    if kind == "antibiotic_policy":
        return (g("drug"),)
    return (g("drug_name"), g("category"), g("parameter"), g("operator"), g("threshold"))


def validate_row(cur, kb, kind, r, class_codes, existing_keys):
    """Return a list of problems (empty = acceptable)."""
    spec = KINDS[kind]
    g = lambda k: (r.get(k) or "").strip()  # noqa: E731
    problems = []
    for k in spec["required"] + CITATION:
        if not g(k):
            problems.append(f"missing {k}")
    if problems:
        return problems
    for k, allowed in ENUMS.items():
        if k in spec["fields"] and g(k) and g(k) not in allowed:
            problems.append(f"{k} must be one of {', '.join(allowed)}")
    for k in NUMERIC:
        if k in spec["fields"] and g(k):
            try:
                if float(g(k)) <= 0:
                    problems.append(f"{k} must be positive")
            except ValueError:
                problems.append(f"{k} is not a number")
    if kind == "dose_limit" and not any(g(k) for k in NUMERIC):
        problems.append("give at least one limit (max_single_mg, max_daily_mg, max_mg_per_kg_day or max_doses_per_week)")
    if kind == "clinical_rule" and g("parameter").lower() not in ENGINE_PARAMETERS:
        problems.append(f"parameter '{g('parameter')}' is not evaluated by the engine (supported: {', '.join(ENGINE_PARAMETERS)})")
    if kind == "interaction" and (g("a_kind"), g("a").lower()) == (g("b_kind"), g("b").lower()):
        problems.append("an interaction needs two different subjects")
    subjects = {"dose_limit": [("substance", "drug")], "antibiotic_policy": [("substance", "drug")], "clinical_rule": [("substance", "drug_name")],
                "reproductive_risk": [(g("target_kind"), "target")], "interaction": [(g("a_kind"), "a"), (g("b_kind"), "b")]}[kind]
    for sk, field in subjects:
        if g(field) and sk in ("substance", "class") and not resolve_subject(cur, kb, sk, g(field), class_codes):
            problems.append(f"{field} '{g(field)}' is not a known {sk}" + (" (use the generic/INN name)" if sk == "substance" else " (see drug_classes.csv)"))
    if not is_person(g("extracted_by")):
        problems.append("extracted_by must be the name of the person who read the guideline (AI/system names are not accepted)")
    # the citation
    ok, reason = quotes.verify_quote(cur, g("source_id"), g("source_page"), g("source_quote"))
    if not ok:
        problems.append(f"citation: {reason}")
    cur.execute("SELECT jurisdiction FROM smartrx.guideline_source WHERE source_id = %s", (g("source_id"),))
    jur = cur.fetchone()
    jurisdiction = jur[0] if jur else "Unknown"
    if kind in INDIA_ONLY_KINDS and jurisdiction != "India":
        problems.append(f"{kind} is treatment content and must cite an Indian source ({g('source_id')} is {jurisdiction})")
    if row_key(kind, r) in existing_keys:
        problems.append("a row for this subject already exists (retire or edit it instead)")
    return problems


def build_row(cur, kind, r):
    spec = KINDS[kind]
    g = lambda k: (r.get(k) or "").strip()  # noqa: E731
    cur.execute("SELECT source_name, jurisdiction FROM smartrx.guideline_source WHERE source_id = %s", (g("source_id"),))
    name, jurisdiction = cur.fetchone() or ("", "Unknown")
    row = {k: g(k) for k in spec["fields"]}
    row.update({"source": f"{name}, p.{g('source_page')} ({g('source_id')})", "status": "draft", "provenance": "cited",
                "row_id": uuid.uuid4().hex[:8], "jurisdiction": jurisdiction, "source_id": g("source_id"), "source_page": g("source_page"),
                "source_section": g("source_section"), "source_quote": g("source_quote"), "extracted_by": g("extracted_by")})
    if kind == "antibiotic_policy" and not row.get("requires_justification"):
        row["requires_justification"] = "True"
    if kind == "clinical_rule":
        row["is_blocking"] = "False"
    return row


# ------------------------------------------------------------------------------------------------- operations

def submit(cur, kb, sheet_rows, data_dir: Path, apply=False, partial=False):
    """Validate sheet rows. Returns (results, written). results: [(line, kind, accepted, problems)]."""
    cur.execute("SELECT class_code FROM smartrx.drug_class")
    class_codes = {c for (c,) in cur.fetchall()}
    existing = {}
    for kind, spec in KINDS.items():
        path = data_dir / spec["file"]
        existing[kind] = {row_key(kind, r) for r in read_csv(path)[0] if (r.get("provenance") or ("cited" if kind == "clinical_rule" else "")) in ("cited", "verified")} if path.exists() else set()
    results, accepted = [], []
    batch_keys = {k: set() for k in KINDS}
    for line, r in enumerate(sheet_rows, start=2):
        if not any((v or "").strip() for v in r.values()):
            continue
        kind = (r.get("kind") or "").strip()
        if kind not in KINDS:
            results.append((line, kind or "?", False, [f"kind must be one of {', '.join(KINDS)}"]))
            continue
        problems = validate_row(cur, kb, kind, r, class_codes, existing[kind] | batch_keys[kind])
        results.append((line, kind, not problems, problems))
        if not problems:
            batch_keys[kind].add(row_key(kind, r))
            accepted.append((kind, build_row(cur, kind, r)))
    written = 0
    if apply and accepted and (partial or all(ok for _, _, ok, _ in results)):
        for kind in {k for k, _ in accepted}:
            path = data_dir / KINDS[kind]["file"]
            rows, fields, nl = read_csv(path) if path.exists() else ([], KINDS[kind]["fields"] + ["source"], "\n")
            new = [row for k, row in accepted if k == kind]
            for col in TRACKING + [f for f in KINDS[kind]["fields"] + ["source"]]:
                if col not in fields:
                    fields.append(col)
            write_csv(path, rows + new, fields, nl)
            written += len(new)
    return results, written


def pending(data_dir: Path):
    out = []
    for kind, spec in KINDS.items():
        path = data_dir / spec["file"]
        if not path.exists():
            continue
        for r in read_csv(path)[0]:
            if r.get("row_id") and r.get("provenance") == "cited" and (r.get("status") or "draft") == "draft":
                out.append((kind, r))
    return out


def approve(cur, data_dir: Path, row_ids, reviewer, approver, now=None):
    """Approve rows. Returns {row_id: problems or []}; only rows with no problems are changed."""
    outcome = {}
    for name, label in ((reviewer, "reviewer"), (approver, "approver")):
        if not is_person(name):
            return {rid: [f"{label} must be the name of a person"] for rid in row_ids}
    if reviewer.strip().lower() == approver.strip().lower():
        return {rid: ["reviewer and approver must be different people"] for rid in row_ids}
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    remaining = set(row_ids)
    for kind, spec in KINDS.items():
        path = data_dir / spec["file"]
        if not path.exists():
            continue
        rows, fields, nl = read_csv(path)
        changed = False
        for r in rows:
            rid = r.get("row_id")
            if rid not in remaining:
                continue
            remaining.discard(rid)
            problems = []
            if r.get("provenance") != "cited" or (r.get("status") or "draft") != "draft":
                problems.append("only rows that are draft + cited can be approved")
            if r.get("extracted_by", "").strip().lower() == approver.strip().lower():
                problems.append("the approver cannot be the person who extracted the rule")
            ok, reason = quotes.verify_quote(cur, r.get("source_id"), r.get("source_page"), r.get("source_quote"))
            if not ok:
                problems.append(f"citation no longer verifies: {reason}")
            outcome[rid] = problems
            if not problems:
                r.update({"status": "approved", "provenance": "verified", "reviewed_by": reviewer.strip(), "reviewed_at": stamp,
                          "approved_by": approver.strip(), "approved_at": stamp})
                changed = True
        if changed:
            write_csv(path, rows, fields, nl)
    for rid in remaining:
        outcome[rid] = ["row_id not found"]
    return outcome


# ------------------------------------------------------------------------------------------------- cli

def _connect():
    import psycopg2
    from utils.database import DATABASE_URL, _normalize_database_url
    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    conn.autocommit = True
    return conn


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("template"); t.add_argument("--kind", choices=list(KINDS), required=True)
    s = sub.add_parser("submit"); s.add_argument("sheet"); s.add_argument("--apply", action="store_true")
    s.add_argument("--partial", action="store_true", help="write the accepted rows even if others are rejected")
    sub.add_parser("list")
    a = sub.add_parser("approve"); a.add_argument("--row-id", nargs="+", required=True)
    a.add_argument("--reviewer", required=True); a.add_argument("--approver", required=True)
    args = ap.parse_args()

    if args.cmd == "template":
        print(",".join(["kind"] + KINDS[args.kind]["fields"] + ["source_id", "source_page", "source_section", "source_quote", "extracted_by"]))
        return
    if args.cmd == "list":
        rows = pending(DATA_DIR)
        for kind, r in rows:
            subject = r.get("drug") or r.get("drug_name") or r.get("a") or r.get("target")
            print(f"{r['row_id']}  {kind:18} {subject:24} {r['source_id']} p.{r['source_page']}  extracted by {r['extracted_by']}")
        print(f"{len(rows)} row(s) waiting for approval")
        return
    conn = _connect()
    cur = conn.cursor()
    if args.cmd == "submit":
        from modules.smartrx.knowledge import get_knowledge
        sheet = list(csv.DictReader(open(args.sheet, encoding="utf-8-sig", newline="")))
        results, written = submit(cur, get_knowledge(cur), sheet, DATA_DIR, apply=args.apply, partial=args.partial)
        for line, kind, ok, problems in results:
            print(f"line {line:>3} {kind:18} {'ACCEPT' if ok else 'REJECT'}" + ("" if ok else "\n      - " + "\n      - ".join(problems)))
        bad = sum(1 for r in results if not r[2])
        print(f"\n{len(results) - bad} accepted, {bad} rejected." + (f" {written} row(s) written." if args.apply else " (dry run: nothing written; add --apply)"))
        sys.exit(1 if bad else 0)
    if args.cmd == "approve":
        outcome = approve(cur, DATA_DIR, args.row_id, args.reviewer, args.approver)
        for rid, problems in outcome.items():
            print(f"{rid}: " + ("APPROVED" if not problems else "REFUSED: " + "; ".join(problems)))
        sys.exit(1 if any(outcome.values()) else 0)


if __name__ == "__main__":
    main()
