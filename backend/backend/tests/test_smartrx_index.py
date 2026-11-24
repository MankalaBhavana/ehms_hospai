"""Step 2: guideline page index, quote verification, OCR handling and integrity checks."""
import csv
import hashlib
import io
import sys
import tarfile
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "smartrx_pipeline"))

from modules.smartrx import quotes  # noqa: E402
from test_smartrx_api import db  # noqa: E402,F401  (fixture)

import step4_index_guidelines as indexer  # noqa: E402
import search_guidelines  # noqa: E402

PAGE1 = ("Metformin is contraindicated when the eGFR is below 30 mL/min/1.73 m2. "
         "Reduce the dose to a maximum of 1000 mg daily when eGFR is 30-44.")
HYPHENATED = ["Use anti-", "biotic prophylaxis only when indicated by the national guideline."]


# ------------------------------------------------------------------ pure: quote matching ------------------------------

def test_quote_matching_ignores_typography_but_not_digits():
    page = "Do not exceed 0.5 mg/kg/day.\nSerum creatinine\nshould be \u201cchecked\u201d every 5\u201310 days \u2013 see Table 2."
    assert quotes.quote_in_text("DO NOT EXCEED 0.5 mg/kg/day.", page)
    assert quotes.quote_in_text('Serum creatinine should be "checked" every 5-10 days', page)
    assert not quotes.quote_in_text("Do not exceed 05 mg/kg/day for adults", page)       # a changed number never matches
    assert not quotes.quote_in_text("checked every 510 days - see Table 2.", page)
    assert not quotes.quote_in_text("too short", "too short here")                       # under the minimum length


def test_hyphen_at_line_break_is_joined():
    page = "\n".join(HYPHENATED)
    assert quotes.quote_in_text("Use antibiotic prophylaxis only when indicated", page)
    assert quotes.quote_in_text("Use anti-biotic prophylaxis only when indicated", "Use anti-biotic prophylaxis only when indicated by x")


# ------------------------------------------------------------------ fixtures ------------------------------------------

def make_pdf(path, pages):
    doc = fitz.open()
    for lines in pages:
        page = doc.new_page()
        for i, line in enumerate(lines):
            page.insert_text((72, 72 + 18 * i), line, fontsize=11)
    doc.save(path)
    doc.close()


@pytest.fixture
def library(tmp_path, db):
    """A tiny registered library: a PDF (text page + blank page), an HTML page, and a PDF whose hash is wrong."""
    cur, _ = db
    root = tmp_path / "lib"
    root.mkdir()
    make_pdf(root / "TEST_A.pdf", [[PAGE1[:70], PAGE1[70:]], []])
    make_pdf(root / "TEST_C.pdf", [HYPHENATED])
    (root / "TEST_B.html").write_text("<html><body><script>var x=1</script><h1>Antibiotic stewardship</h1>"
                                      "<p>Reserve antibiotics need documented microbiology approval before use.</p></body></html>", encoding="utf-8")
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
    log = tmp_path / "Source_Log.csv"
    with open(log, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source_id", "filename", "sha256"])
        w.writerow(["TEST_A", "TEST_A.pdf", sha(root / "TEST_A.pdf")])
        w.writerow(["TEST_B", "TEST_B.html", sha(root / "TEST_B.html")])
        w.writerow(["TEST_C", "TEST_C.pdf", "0" * 64])            # registered hash does not match the file
    cur.execute("INSERT INTO smartrx.guideline_source (source_id, source_name) VALUES ('TEST_A','Test guideline A'),('TEST_B','Test html'),('TEST_C','Test C') "
                "ON CONFLICT DO NOTHING")
    yield root, log
    for t in ("guideline_passage", "guideline_document", "guideline_source"):
        cur.execute(f"DELETE FROM smartrx.{t} WHERE source_id LIKE 'TEST\\_%'")
    cur.execute("DELETE FROM smartrx.dose_limit WHERE note = 'TEST-FIXTURE'")


def run_index(db, library, **kw):
    cur, _ = db
    return indexer.index_documents(cur.connection, library[0], library[1], log=lambda *_: None, **kw)


# ------------------------------------------------------------------ indexing ------------------------------------------

def test_indexing_pdf_html_and_integrity(db, library):
    cur, _ = db
    s = run_index(db, library)
    assert s["indexed"] == 3 and s["hash_mismatch"] == ["TEST_C"] and not s["errors"]
    cur.execute("SELECT pages, text_pages, ocr_pages, empty_pages, status, hash_matches_log FROM smartrx.guideline_document WHERE source_id='TEST_A'")
    assert cur.fetchone() == (2, 1, 0, 1, "partial", True)
    cur.execute("SELECT page, method FROM smartrx.guideline_passage WHERE source_id='TEST_A' ORDER BY page")
    assert cur.fetchall() == [("1", "text"), ("2", "none")]
    cur.execute("SELECT method, text FROM smartrx.guideline_passage WHERE source_id='TEST_B'")
    method, text = cur.fetchone()
    assert method == "html" and "Reserve antibiotics" in text and "var x" not in text
    cur.execute("SELECT hash_matches_log FROM smartrx.guideline_document WHERE source_id='TEST_C'")
    assert cur.fetchone()[0] is False


def test_indexing_is_incremental(db, library):
    run_index(db, library)
    again = run_index(db, library)
    assert again["indexed"] == 0 and again["skipped"] == 3
    assert run_index(db, library, force=True)["indexed"] == 3


def test_ocr_fills_empty_pages_but_is_never_verifiable(db, library):
    cur, _ = db
    run_index(db, library)
    calls = []

    def fake_ocr(page):
        calls.append(page.number)
        return "Metformin 500 mg twice daily with meals, OCR recovered text of this page.", 0.93

    s = run_index(db, library, ocr=True, ocr_engine=fake_ocr)
    assert calls == [1] and s["indexed"] >= 1                      # only the blank page was OCR'd; text pages untouched
    cur.execute("SELECT method, ocr_confidence FROM smartrx.guideline_passage WHERE source_id='TEST_A' AND page='2'")
    assert cur.fetchone() == ("ocr", pytest.approx(0.93, abs=0.001))
    ok, reason = quotes.verify_quote(cur, "TEST_A", "2", "Metformin 500 mg twice daily with meals")
    assert not ok and "OCR" in reason


# ------------------------------------------------------------------ quote verification ---------------------------------

def test_verify_quote_outcomes(db, library):
    cur, _ = db
    run_index(db, library)
    assert quotes.verify_quote(cur, "TEST_A", "1", "Metformin is contraindicated when the eGFR is below 30 mL/min/1.73 m2.") == (True, "ok")
    ok, reason = quotes.verify_quote(cur, "TEST_A", "2", "Metformin is contraindicated when the eGFR is below 30")
    assert not ok                                                      # page 2 has no text -> not verifiable
    ok, reason = quotes.verify_quote(cur, "TEST_B", "1", "Metformin is contraindicated when the eGFR is below 30")
    assert not ok and "not found" in reason
    assert not quotes.verify_quote(cur, "TEST_A", "1", "Metformin is contraindicated when the eGFR is below 40 mL/min")[0]   # altered number
    assert "has not been indexed" in quotes.verify_quote(cur, "NOPE_1", "1", "x" * 40)[1]
    assert "no page '9'" in quotes.verify_quote(cur, "TEST_A", "9", "x" * 40)[1]
    assert "too short" in quotes.verify_quote(cur, "TEST_A", "1", "short")[1]


def test_quote_on_the_wrong_page_points_to_the_right_one(db, library):
    cur, _ = db
    run_index(db, library)
    ok, reason = quotes.verify_quote(cur, "TEST_B", "1", "Use antibiotic prophylaxis only when indicated")
    assert not ok
    cur.execute("INSERT INTO smartrx.guideline_passage (source_id, page, method, text, char_count, text_sha256) "
                "VALUES ('TEST_B','7','text','Reserve antibiotics need documented microbiology approval, see annex.',70,'x')")
    ok, reason = quotes.verify_quote(cur, "TEST_B", "9", "Reserve antibiotics need documented microbiology approval")
    assert not ok and "no page" in reason
    cur.execute("UPDATE smartrx.guideline_passage SET page='3' WHERE source_id='TEST_B' AND page='1'")
    ok, reason = quotes.verify_quote(cur, "TEST_B", "7", "Reserve antibiotics need documented microbiology approval before use")
    assert not ok and "page(s) 3" in reason


def test_document_with_wrong_hash_cannot_support_verification(db, library):
    cur, _ = db
    run_index(db, library)
    ok, reason = quotes.verify_quote(cur, "TEST_C", "1", "Use antibiotic prophylaxis only when indicated by the national guideline.")
    assert not ok and "differs from the hash registered" in reason


def test_ingest_rejects_a_verified_row_whose_quote_is_not_on_the_page(db, library):
    cur, kb = db
    import step2_ingest_db as ingest
    run_index(db, library)
    cur.execute("""INSERT INTO smartrx.dose_limit (moiety_identifier, population, max_daily_mg, status, note)
                   VALUES (%s, 'adult', 1000, 'draft', 'TEST-FIXTURE') RETURNING id""", (kb.moiety_for_name("metformin"),))
    rid = cur.fetchone()[0]
    base = {"status": "approved", "provenance": "verified", "source_id": "TEST_A", "source_page": "1", "reviewed_by": "Dr A",
            "approved_by": "Dr B", "drug": "metformin"}
    good, bad = [], []
    ingest.stamp(cur, "dose_limit", "id = %s", (rid,), "dose_limits.csv",
                 {**base, "source_quote": "Reduce the dose to a maximum of 1000 mg daily when eGFR is 30-44."}, {"TEST_A"}, good)
    assert good == []
    ingest.stamp(cur, "dose_limit", "id = %s", (rid,), "dose_limits.csv",
                 {**base, "source_quote": "Reduce the dose to a maximum of 2000 mg daily when eGFR is 30-44."}, {"TEST_A"}, bad)
    assert len(bad) == 1 and "citation not verified" in bad[0]


# ------------------------------------------------------------------ search --------------------------------------------

def test_search_finds_pages_and_can_exclude_ocr(db, library):
    cur, _ = db
    run_index(db, library)
    hits = search_guidelines.search(cur, "metformin eGFR", sources=["TEST_A"])
    assert hits and hits[0][0] == "TEST_A" and hits[0][2] == "1" and "Metformin" in hits[0][4]
    assert not search_guidelines.search(cur, "metformin", sources=["TEST_B"])
    run_index(db, library, ocr=True, ocr_engine=lambda page: ("Ciprofloxacin interaction recovered by optical recognition text.", 0.8))
    assert search_guidelines.search(cur, "ciprofloxacin", sources=["TEST_A"])
    assert not search_guidelines.search(cur, "ciprofloxacin", sources=["TEST_A"], exclude_ocr=True)


# ------------------------------------------------------------------ LactMed archive -----------------------------------

def test_lactmed_archive_is_parsed_in_memory_without_resolving_entities(tmp_path):
    def nxml(title, body, extra=""):
        return (f'<?xml version="1.0"?>{extra}<article><front><article-meta><title-group><article-title>{title}</article-title>'
                f"</title-group></article-meta></front><body><sec><p>{body}</p></sec></body></article>").encode()

    evil = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///C:/Windows/win.ini">]>'
    tar_path = tmp_path / "lm.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for name, data in (("lm/LM1.nxml", nxml("Codeine", "Avoid in breastfeeding; infant opioid toxicity reported.")),
                           ("lm/LM2.nxml", nxml("Evil", "&x; text", evil)), ("lm/LM3.pdf", b"%PDF-1.4")):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    passages = indexer.extract_lactmed(tar_path)
    assert [p[0] for p in passages] == ["LM1", "LM2"] and all(p[2] == "nxml" for p in passages)
    assert passages[0][1].startswith("Codeine.") and "infant opioid toxicity" in passages[0][1]
    assert "[fonts]" not in passages[1][1] and "extensions" not in passages[1][1].lower()


# ------------------------------------------------------------------ the real library (when it has been indexed) -----

def test_real_library_index_sanity(db):
    cur, _ = db
    cur.execute("SELECT COUNT(*) FROM smartrx.guideline_document WHERE source_id LIKE 'SRC\\_%'")
    if cur.fetchone()[0] < 100:
        pytest.skip("guideline library not indexed in this database")
    cur.execute("SELECT pages, status FROM smartrx.guideline_document WHERE source_id = 'SRC_151'")
    pages, status = cur.fetchone()
    assert pages > 100 and status in ("ok", "partial")
    assert search_guidelines.search(cur, "tuberculosis treatment regimen", limit=3)
    cur.execute("SELECT COUNT(*) FROM smartrx.guideline_passage WHERE source_id = 'SRC_215' AND method = 'nxml'")
    assert cur.fetchone()[0] > 1500                                   # LactMed drug records
