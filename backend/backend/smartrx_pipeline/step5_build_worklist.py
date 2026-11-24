"""Build the reviewer worklist: for each drug and topic, the guideline sentences a clinician needs to read.

    cd backend/backend
    python smartrx_pipeline/step5_build_worklist.py                       # drugs referenced by the current (unsourced) seed rules
    python smartrx_pipeline/step5_build_worklist.py --drug metformin --drug "valproic acid"
    python smartrx_pipeline/step5_build_worklist.py --file drugs.txt --topics dose renal pregnancy
    python smartrx_pipeline/step5_build_worklist.py --nlem                # every NLEM medicine (large)

Writes, into <knowledge root>/08_Reviewer_Worklists/<date>/ (or --out):
    worklist.html          read this: grouped by drug and topic, Indian sources first, drug names highlighted
    worklist.csv           the same rows for spreadsheets; blank decision columns for the reviewer
    coverage.csv           how many passages exist per drug and topic (zero rows show where the library has nothing)
    missing_sources.csv    sources registered in Source_Log.csv but never downloaded (so not searchable)

Each candidate quote is an exact sentence from the indexed page and is pre-checked against the citation verifier, so it can be copied
into an extraction sheet unchanged. Nothing here decides what a rule says: it only finds where to look.
"""
import argparse
import csv
import html
import os
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.smartrx import quotes  # noqa: E402
from modules.smartrx.config import DATA_DIR, KNOWLEDGE_ROOT, SOURCE_LOG  # noqa: E402

TOPICS = {
    "dose": ["dose", "doses", "dosage", "dosing", "mg", "mcg", "maximum", "daily", "twice", "weekly"],
    "renal": ["renal", "kidney", "creatinine", "egfr", "gfr", "dialysis", "ckd", "nephrotoxic"],
    "hepatic": ["hepatic", "liver", "cirrhosis", "hepatotoxic", "hepatotoxicity", "jaundice"],
    "pregnancy": ["pregnancy", "pregnant", "lactation", "breastfeeding", "teratogenic", "fetal", "foetal", "breast"],
    "contraindication": ["contraindicated", "contraindication", "contraindications", "avoid", "should not be used", "not recommended"],
    "interaction": ["interaction", "interactions", "interacts", "concomitant", "coadministration", "co-administration", "concurrent"],
    "stewardship": ["reserve", "restricted", "stewardship", "last-resort", "last resort", "watch", "carbapenem-resistant"],
}
JURISDICTION_ORDER = {"India": 0, "WHO": 1, "International": 2, "US": 3, "Unknown": 4}
VERIFIABLE_JURISDICTION_NOTE = {"India": "Indian source: may decide treatment content", "WHO": "WHO", "International": "International",
                                "US": "Foreign: universal pharmacology only", "Unknown": "Unclassified"}
# Sentence ends, plus bullet glyphs (PDF bullets are often private-use characters) which separate list items.
SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+(?=[A-Z0-9(\-])|\s*[-�•●▪■‣]\s*")
DOSE_LIKE = re.compile(r"\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?|%|mg/kg|ml/min)", re.I)
MAX_QUOTE = 600


# ------------------------------------------------------------------------------------------------- names

def tsquery_name(name):
    """'valproic acid' -> '(valproic <-> acid)'; None if the name has no usable token."""
    toks = re.findall(r"[a-z0-9]+", name.lower())
    return "(" + " <-> ".join(toks) + ")" if toks else None


def load_synonyms(data_dir: Path):
    """name -> set of alternative names, both directions (paracetamol <-> acetaminophen)."""
    out = {}
    path = data_dir / "drug_synonyms.csv"
    if path.exists():
        for r in csv.DictReader(open(path, encoding="utf-8")):
            comps = [c.strip().lower() for c in r["components"].split("|") if c.strip()]
            if len(comps) == 1:
                a, b = r["synonym"].strip().lower(), comps[0]
                out.setdefault(a, set()).add(b)
                out.setdefault(b, set()).add(a)
    return out


def seed_drugs(data_dir: Path):
    """Drug names referenced by the current knowledge CSVs (the worklist of what still needs a guideline citation)."""
    names = set()

    def rows(fname):
        p = data_dir / fname
        return list(csv.DictReader(open(p, encoding="utf-8"))) if p.exists() else []

    classes = {r["class_code"]: [m.strip() for m in r["members"].split("|") if m.strip()] for r in rows("drug_classes.csv")}
    for r in rows("dose_limits.csv"):
        names.add(r["drug"].strip().lower())
    for r in rows("antibiotic_policy.csv"):
        names.add(r["drug"].strip().lower())
    for r in rows("clinical_rules.csv"):
        names.add(r["drug_name"].strip().lower())
    for r in rows("drug_interactions.csv"):
        for kind, ref in ((r["a_kind"], r["a"]), (r["b_kind"], r["b"])):
            names.update([ref.strip().lower()] if kind == "substance" else [m.lower() for m in classes.get(ref, [])])
    for r in rows("reproductive_risk.csv"):
        names.update([r["target"].strip().lower()] if r["target_kind"] == "substance" else [m.lower() for m in classes.get(r["target"], [])])
    return sorted(n for n in names if n)


def nlem_drugs(data_dir: Path):
    p = data_dir / "nlem_2022_parsed.csv"
    names = set()
    if p.exists():
        for r in csv.DictReader(open(p, encoding="utf-8")):
            for part in re.split(r"\s*\+\s*", r["medicine_name"]):
                if part.strip():
                    names.add(part.strip().lower())
    return sorted(names)


# ------------------------------------------------------------------------------------------------- search

SQL = """
SELECT p.source_id, s.source_name, s.jurisdiction, p.page, p.method, d.hash_matches_log, p.text,
       ts_rank_cd(p.tsv, to_tsquery('english', %(q)s)) AS rank
FROM smartrx.guideline_passage p
JOIN smartrx.guideline_source s ON s.source_id = p.source_id
JOIN smartrx.guideline_document d ON d.source_id = p.source_id
WHERE p.tsv @@ to_tsquery('english', %(q)s)
  AND (%(sources)s::text[] IS NULL OR p.source_id = ANY(%(sources)s))
ORDER BY CASE s.jurisdiction WHEN 'India' THEN 0 WHEN 'WHO' THEN 1 WHEN 'International' THEN 2 WHEN 'US' THEN 3 ELSE 4 END,
         rank DESC, p.source_id, p.page
LIMIT %(limit)s
"""


def term_regex(terms):
    return re.compile(r"\b(?:" + "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True)) + r")", re.I)


def best_sentences(text, name_res, topic_re, method, title_hit, limit=2):
    """Sentences mentioning the drug and the topic, best first. LactMed records are about one drug, named only in the title."""
    flat = " ".join(text.split())
    scored = []
    for sent in SENTENCE_SPLIT.split(flat):
        sent = (sent or "").strip()
        if len(sent) < quotes.MIN_QUOTE_CHARS or len(sent) > MAX_QUOTE:
            continue
        mentions = any(r.search(sent) for r in name_res) or (method == "nxml" and title_hit)
        hits = len(set(m.group(0).lower() for m in topic_re.finditer(sent)))
        if mentions and hits:
            scored.append((hits + (1 if DOSE_LIKE.search(sent) else 0), sent))
    scored.sort(key=lambda t: -t[0])
    return [s for _, s in scored[:limit]]


def build(cur, drugs, synonyms, topics, per_topic=6, include_ocr=True, sources=None):
    """Return (rows, coverage). Rows are candidate quotes; every quote has been checked against its page."""
    rows, coverage = [], []
    for drug in drugs:
        names = sorted({drug} | synonyms.get(drug, set()))
        dq = " | ".join(q for q in map(tsquery_name, names) if q)
        if not dq:
            continue
        name_res = [re.compile(r"\b" + re.escape(n) + r"\b", re.I) for n in names]
        for topic in topics:
            topic_terms = TOPICS[topic]
            tq = " | ".join(q for q in map(tsquery_name, topic_terms) if q)
            cur.execute(SQL, {"q": f"({dq}) & ({tq})", "limit": per_topic * 3, "sources": sources})
            hits = cur.fetchall()
            topic_re = term_regex(topic_terms)
            kept, indian = 0, 0
            for source_id, source_name, jurisdiction, page, method, hash_ok, text, rank in hits:
                if method == "ocr" and not include_ocr:
                    continue
                title_hit = method == "nxml" and any(r.search(text[:200]) for r in name_res)
                for sentence in best_sentences(text, name_res, topic_re, method, title_hit):
                    if not quotes.quote_in_text(sentence, text):
                        continue  # cannot happen by construction; the guard keeps the promise honest
                    verifiable = method in quotes.VERIFIABLE_METHODS and hash_ok is not False
                    rows.append({"drug": drug, "topic": topic, "jurisdiction": jurisdiction, "source_id": source_id,
                                 "source_name": source_name, "page": page, "method": method, "verifiable": "yes" if verifiable else "no",
                                 "has_numbers": "yes" if DOSE_LIKE.search(sentence) else "", "candidate_quote": sentence,
                                 "decision": "", "rule_kind": "", "notes": ""})
                    kept += 1
                    indian += jurisdiction == "India"
                if kept >= per_topic:
                    break
            coverage.append({"drug": drug, "topic": topic, "candidates": kept, "indian_candidates": indian})
    return rows, coverage


def missing_sources(source_log: Path):
    out = []
    for r in csv.DictReader(open(source_log, encoding="utf-8-sig", newline="")):
        if (r.get("filename") or "").strip() in ("", "N/A"):
            out.append({"source_id": r["source_id"], "source_name": r["source_name"], "publisher": r["publisher"],
                        "url": r["url"], "why_missing": (r.get("notes") or "")[:200]})
    return out


# ------------------------------------------------------------------------------------------------- output

CSV_FIELDS = ["drug", "topic", "jurisdiction", "source_id", "source_name", "page", "method", "verifiable", "has_numbers",
              "candidate_quote", "decision", "rule_kind", "notes"]


def write_csv(path, rows, fields):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def highlight(sentence, names):
    out = html.escape(sentence)
    for n in sorted(names, key=len, reverse=True):
        out = re.sub(r"(?i)\b(" + re.escape(html.escape(n)) + r")\b", r"<mark>\1</mark>", out)
    return out


def render_html(rows, coverage, synonyms, missing):
    esc = html.escape
    by = {}
    for r in rows:
        by.setdefault(r["drug"], {}).setdefault(r["topic"], []).append(r)
    cov = {(c["drug"], c["topic"]): c for c in coverage}
    parts = ["<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
             "<title>SmartRx reviewer worklist</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1000px;padding:0 16px;color:#1b1f23}"
             "h1{font-size:22px}h2{margin-top:32px;border-bottom:2px solid #d0d7de;padding-bottom:4px}h3{margin:18px 0 6px;font-size:15px;text-transform:capitalize}"
             "table{border-collapse:collapse;width:100%}td{border-top:1px solid #e1e4e8;padding:8px;vertical-align:top}td.src{width:210px;font-size:13px}"
             ".b{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;margin-right:4px;background:#eee}.India{background:#d7f2dd}.US,.WHO,.International,.Unknown{background:#ffe9c7}"
             ".warn{background:#fbd5d5}mark{background:#fff0a8}.none{color:#8a6d00;font-style:italic}details{margin:8px 0}"
             "@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}td{border-color:#30363d}mark{background:#5a4a00;color:#fff}.India{background:#1f4d2b}.US,.WHO,.International,.Unknown{background:#5a3c10}.warn{background:#6b2020}h2{border-color:#30363d}}"
             "</style><h1>SmartRx reviewer worklist</h1><p>Candidate guideline sentences, Indian sources first. Each quote is an exact sentence from the "
             "indexed page. <b>Finding a sentence is not a rule</b>: a clinician decides what, if anything, it supports. OCR pages and files whose hash "
             "differs from the register are marked and cannot support a verified citation.</p>"]
    for drug in sorted({r["drug"] for r in rows} | {c["drug"] for c in coverage}):
        names = {drug} | synonyms.get(drug, set())
        parts.append(f"<h2>{esc(drug)}" + (f" <small>(also: {esc(', '.join(sorted(names - {drug})))})</small>" if len(names) > 1 else "") + "</h2>")
        for topic in TOPICS:
            c = cov.get((drug, topic))
            if c is None:
                continue
            items = by.get(drug, {}).get(topic, [])
            if not items:
                parts.append(f"<h3>{esc(topic)}</h3><p class=none>No passage found in the indexed library.</p>")
                continue
            parts.append(f"<h3>{esc(topic)}</h3><table>")
            for r in items:
                flags = f"<span class='b {esc(r['jurisdiction'])}'>{esc(r['jurisdiction'])}</span>"
                if r["method"] == "ocr":
                    flags += "<span class='b warn'>OCR</span>"
                elif r["verifiable"] == "no":
                    flags += "<span class='b warn'>file hash differs</span>"
                parts.append(f"<tr><td class=src>{flags}<br><b>{esc(r['source_id'])}</b>, p.{esc(r['page'])}<br>{esc(r['source_name'][:80])}</td>"
                             f"<td>{highlight(r['candidate_quote'], names)}</td></tr>")
            parts.append("</table>")
    if missing:
        parts.append("<h2>Registered but not downloaded</h2><details><summary>%d source(s) cannot be searched</summary><ul>" % len(missing))
        parts += [f"<li><b>{esc(m['source_id'])}</b> {esc(m['source_name'])}: <i>{esc(m['why_missing'])}</i></li>" for m in missing]
        parts.append("</ul></details>")
    return "".join(parts) + "</html>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drug", action="append", help="drug name (repeatable)")
    ap.add_argument("--file", help="text file, one drug per line")
    ap.add_argument("--nlem", action="store_true", help="all NLEM 2022 medicines")
    ap.add_argument("--topics", nargs="*", choices=list(TOPICS), default=list(TOPICS))
    ap.add_argument("--per-topic", type=int, default=6)
    ap.add_argument("--exclude-ocr", action="store_true")
    ap.add_argument("--source", action="append", help="restrict to this source id (repeatable)")
    ap.add_argument("--out", help="output folder (default: <knowledge root>/08_Reviewer_Worklists/<date>)")
    args = ap.parse_args()

    drugs = [d.strip().lower() for d in (args.drug or [])]
    if args.file:
        drugs += [l.strip().lower() for l in open(args.file, encoding="utf-8") if l.strip() and not l.startswith("#")]
    if args.nlem:
        drugs += nlem_drugs(DATA_DIR)
    if not drugs:
        drugs = seed_drugs(DATA_DIR)
    drugs = sorted(set(drugs))

    import psycopg2
    from utils.database import DATABASE_URL, _normalize_database_url
    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM smartrx.guideline_document")
    if not cur.fetchone()[0]:
        sys.exit("The guideline index is empty. Run smartrx_pipeline/step4_index_guidelines.py first.")
    synonyms = load_synonyms(DATA_DIR)
    rows, coverage = build(cur, drugs, synonyms, args.topics, args.per_topic, include_ocr=not args.exclude_ocr, sources=args.source)
    missing = missing_sources(SOURCE_LOG)

    out = Path(args.out) if args.out else KNOWLEDGE_ROOT / "08_Reviewer_Worklists" / date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "worklist.csv", rows, CSV_FIELDS)
    write_csv(out / "coverage.csv", coverage, ["drug", "topic", "candidates", "indian_candidates"])
    write_csv(out / "missing_sources.csv", missing, ["source_id", "source_name", "publisher", "url", "why_missing"])
    (out / "worklist.html").write_text(render_html(rows, coverage, synonyms, missing), encoding="utf-8")

    cells = len(coverage)
    empty = sum(1 for c in coverage if not c["candidates"])
    no_india = sum(1 for c in coverage if c["candidates"] and not c["indian_candidates"])
    print(f"{len(drugs)} drugs x {len(args.topics)} topics = {cells} cells; {len(rows)} candidate sentences")
    print(f"  cells with nothing in the library: {empty} ({100 * empty // max(cells, 1)}%)")
    print(f"  cells answered only by non-Indian sources: {no_india}")
    print(f"  registered sources not downloaded: {len(missing)}")
    print(f"Written to {out}")
    conn.close()


if __name__ == "__main__":
    main()
