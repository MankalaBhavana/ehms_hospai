"""Search latency benchmark against the loaded catalogue. Uses DATABASE_URL (no hard-coded connection)."""
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import psycopg2  # noqa: E402

from utils.database import DATABASE_URL, _normalize_database_url  # noqa: E402

QUERIES = ["dolo", "augmentin", "telmisartan", "metformin", "pantocid", "azithromycin"]

conn = psycopg2.connect(_normalize_database_url(DATABASE_URL))
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM smartrx.medication_catalog_items")
print(f"=== SEARCH BENCHMARK: {cur.fetchone()[0]:,} brands ===")
worst = 0.0
for q in QUERIES:
    t0 = time.perf_counter()
    cur.execute("""SELECT brand_name FROM smartrx.medication_catalog_items
                   WHERE to_tsvector('simple', brand_name || ' ' || COALESCE(generic_name, '')) @@ to_tsquery('simple', %s)
                   LIMIT 5""", (f"{q}:*",))
    rows = cur.fetchall()
    ms = (time.perf_counter() - t0) * 1000
    worst = max(worst, ms)
    print(f"{q:<14} {len(rows)} hits in {ms:6.2f} ms")
conn.close()
sys.exit(1 if worst > 50 else 0)  # target: p95 <= 50 ms
