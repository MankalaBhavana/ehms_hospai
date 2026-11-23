"""Provenance rules shared by the ingest pipeline and the standalone validator (no database access here)."""
import csv
from pathlib import Path

PROVENANCE_VALUES = ("unsourced", "cited", "verified")

# What a row counts as when the CSV has no `provenance` column. Only clinical_rules.csv shipped with
# section-level citations from the original data; everything authored during development is unsourced.
DEFAULT_PROVENANCE = {
    "clinical_rules.csv": "cited",
    "drug_classes.csv": "unsourced",
    "cross_reactivity.csv": "unsourced",
    "drug_interactions.csv": "unsourced",
    "interaction_label_candidates.csv": "cited",   # the quote is the regulator label sentence itself
    "dose_limits.csv": "unsourced",
    "reproductive_risk.csv": "unsourced",
    "antibiotic_policy.csv": "unsourced",
}
# clinical_rules.csv predates the status column: its rows are loaded as approved.
DEFAULT_STATUS = {"clinical_rules.csv": "approved"}

# Taxonomy files are reported when active and unsourced, but not blocked (class membership is not clinical advice).
TAXONOMY_FILES = {"drug_classes.csv"}

PROV_FIELDS = ("source_id", "source_page", "source_section", "source_quote", "extracted_by", "reviewed_by", "approved_by", "approved_at")


def load_source_ids(path) -> set:
    path = Path(path)
    if not path.exists():
        return set()
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {r["source_id"].strip() for r in csv.DictReader(f) if r.get("source_id")}


def effective(filename, row):
    """(provenance, fields dict) for a CSV row, applying file defaults."""
    prov = (row.get("provenance") or DEFAULT_PROVENANCE.get(filename, "unsourced")).strip().lower()
    fields = {k: ((row.get(k) or "").strip() or None) for k in PROV_FIELDS}
    if filename == "interaction_label_candidates.csv":
        fields["source_quote"] = fields["source_quote"] or ((row.get("excerpt") or "").strip() or None)
        fields["source_section"] = fields["source_section"] or "Product label text (GenericMaster, CDSCO/DISB)"
    return prov, fields


def check_row(filename, row, source_ids):
    """Return a list of problems with this row's provenance (empty list = acceptable)."""
    prov, f = effective(filename, row)
    status = (row.get("status") or DEFAULT_STATUS.get(filename, "draft")).strip().lower()
    problems = []
    if prov not in PROVENANCE_VALUES:
        return [f"unknown provenance '{prov}'"]
    if status == "approved" and prov == "unsourced" and filename not in TAXONOMY_FILES:
        problems.append("approved but unsourced: a citation is required before approval")
    if prov == "verified":
        for k in ("source_id", "source_page", "source_quote", "reviewed_by", "approved_by"):
            if not f[k]:
                problems.append(f"verified requires {k}")
        if f["reviewed_by"] and f["reviewed_by"] == f["approved_by"]:
            problems.append("reviewer and approver must be different people")
        if f["source_id"] and source_ids and f["source_id"] not in source_ids:
            problems.append(f"source_id {f['source_id']} is not in Source_Log.csv")
        if f["source_id"] and not source_ids:
            problems.append("Source_Log.csv not found; cannot verify source_id")
    if prov == "cited" and filename != "interaction_label_candidates.csv" and not (row.get("source") or f["source_id"]):
        problems.append("cited requires a source description or source_id")
    return problems
