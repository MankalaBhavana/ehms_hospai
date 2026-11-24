"""Find guideline passages for a reviewer: which document, which page, what it says.

    cd backend/backend
    python smartrx_pipeline/search_guidelines.py "metformin eGFR" --limit 10
    python smartrx_pipeline/search_guidelines.py "dose adjustment renal" --source SRC_103 SRC_104
    python smartrx_pipeline/search_guidelines.py "pregnan*" --exclude-ocr

Uses PostgreSQL full-text search (websearch syntax: quotes for phrases, `or`, `-word`). Results show the exact page so a rule can
cite it, plus the page's extraction method: 'ocr' pages are findable but cannot support a verified citation.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import psycopg2  # noqa: E402

SQL = """
SELECT p.source_id, s.source_name, p.page, p.method,
       ts_headline('english', p.text, q, 'MaxFragments=2, MaxWords=35, MinWords=12, FragmentDelimiter= ... '),
       ts_rank_cd(p.tsv, q) AS rank
FROM smartrx.guideline_passage p
JOIN smartrx.guideline_source s ON s.source_id = p.source_id,
     websearch_to_tsquery('english', %s) q
WHERE p.tsv @@ q
  AND (%s::text[] IS NULL OR p.source_id = ANY(%s))
  AND (NOT %s OR p.method <> 'ocr')
ORDER BY rank DESC, p.source_id, p.page
LIMIT %s
"""


def search(cur, query, sources=None, exclude_ocr=False, limit=10):
    cur.execute(SQL, (query, sources, sources, exclude_ocr, limit))
    return cur.fetchall()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--source", nargs="*", help="restrict to these source ids")
    ap.add_argument("--exclude-ocr", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()
    from utils.database import DATABASE_URL, _normalize_database_url

    conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
    rows = search(conn.cursor(), args.query, args.source, args.exclude_ocr, args.limit)
    if not rows:
        print("No passages found. (Has step4_index_guidelines.py been run?)")
    for sid, name, page, method, snippet, rank in rows:
        flag = "  [OCR: cannot support a verified citation]" if method == "ocr" else ""
        print(f"\n{sid}  p.{page}  ({method}){flag}\n  {name[:90]}\n  {' '.join(snippet.split())}")
    conn.close()


if __name__ == "__main__":
    main()
