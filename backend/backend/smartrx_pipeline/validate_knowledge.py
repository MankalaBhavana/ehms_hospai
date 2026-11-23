"""Check the knowledge CSVs for provenance problems WITHOUT touching a database. Suitable for CI / pre-commit.

    cd backend/backend
    python smartrx_pipeline/validate_knowledge.py            # exit 1 when any row breaks the rules
    python smartrx_pipeline/validate_knowledge.py --worklist # also write unsourced_worklist.csv (what still needs a guideline citation)

Rules enforced (see modules/smartrx/provenance.py):
  * a clinical-advice row cannot be `approved` while `unsourced`
  * `verified` needs source_id (in Source_Log.csv), source_page, source_quote, reviewed_by and a DIFFERENT approved_by
"""
import argparse
import csv
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.smartrx import provenance  # noqa: E402
from modules.smartrx.config import DATA_DIR, SOURCE_LOG  # noqa: E402

FILES = list(provenance.DEFAULT_PROVENANCE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worklist", action="store_true")
    args = ap.parse_args()
    source_ids = provenance.load_source_ids(SOURCE_LOG)
    print(f"Source register: {len(source_ids)} documents ({SOURCE_LOG})")

    problems, summary, work = [], Counter(), []
    for fname in FILES:
        path = DATA_DIR / fname
        if not path.exists():
            continue
        with open(path, encoding="utf-8", newline="") as f:
            for n, row in enumerate(csv.DictReader(f), start=2):
                prov, _ = provenance.effective(fname, row)
                status = (row.get("status") or provenance.DEFAULT_STATUS.get(fname, "draft")).strip().lower()
                summary[(fname, prov, status)] += 1
                for p in provenance.check_row(fname, row, source_ids):
                    problems.append(f"{fname}:{n}: {p}")
                if prov == "unsourced":
                    label = row.get("drug") or row.get("a") or row.get("target") or row.get("class_code") or row.get("drug_name") or row.get("from_class")
                    other = row.get("b") or row.get("to_class") or row.get("population") or ""
                    work.append([fname, n, label, other])

    print("\n%-36s %-10s %-9s %s" % ("file", "provenance", "status", "rows"))
    for (fname, prov, status), n in sorted(summary.items()):
        print("%-36s %-10s %-9s %d" % (fname, prov, status, n))
    total = sum(n for (_, prov, _), n in summary.items() if prov == "unsourced")
    print(f"\nUnsourced rows (never active): {total}")

    if args.worklist:
        out = DATA_DIR / "unsourced_worklist.csv"
        with open(out, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["file", "line", "subject", "detail", "guideline_source_id", "page", "verbatim_quote"])
            w.writerows([r + ["", "", ""] for r in work])
        print(f"Worklist written: {out}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:80]:
            print("  " + p)
        sys.exit(1)
    print("\nOK: no row is approved without a citation.")


if __name__ == "__main__":
    main()
