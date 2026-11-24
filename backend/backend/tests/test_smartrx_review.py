"""Step 3: reviewer worklist, extraction sheet validation and two-person approval."""
import csv
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "smartrx_pipeline"))

from modules.smartrx import provenance  # noqa: E402
from test_smartrx_api import db  # noqa: E402,F401  (fixture)
from test_smartrx_index import library, run_index  # noqa: E402,F401  (fixtures/helpers)

import knowledge_review as kr  # noqa: E402
import step5_build_worklist as wl  # noqa: E402

QUOTE = "Reduce the dose to a maximum of 1000 mg daily when eGFR is 30-44."
RESERVE_QUOTE = "Reserve antibiotics need documented microbiology approval before use."
DOSE_HEADER = ["drug", "population", "max_single_mg", "max_daily_mg", "max_mg_per_kg_day", "max_doses_per_week", "note", "source", "status"]


@pytest.fixture
def env(db, library, tmp_path):
    """Indexed test library + an empty data directory with the knowledge CSV headers; TEST_A is Indian, TEST_B is US."""
    cur, kb = db
    run_index(db, library)
    cur.execute("UPDATE smartrx.guideline_source SET jurisdiction='India' WHERE source_id='TEST_A'")
    cur.execute("UPDATE smartrx.guideline_source SET jurisdiction='US' WHERE source_id='TEST_B'")
    data = tmp_path / "data"
    data.mkdir()
    (data / "dose_limits.csv").write_text(",".join(DOSE_HEADER) + "\nibuprofen,adult,800,2400,,,seed row,Seed,draft\n", encoding="utf-8")
    (data / "antibiotic_policy.csv").write_text("drug,tier,restricted_to,requires_justification,message,source,status\n", encoding="utf-8")
    (data / "clinical_rules.csv").write_bytes(b"drug_name,category,parameter,operator,threshold,unit,severity,is_blocking,message,recommendation,source\r\n"
                                              b"Metformin,RENAL_CONTRAINDICATION,eGFR,<,30,mL/min,critical,False,Existing rule,Switch,KDIGO\r\n")
    return cur, kb, data


def sheet_row(**kw):
    base = {"kind": "dose_limit", "drug": "metformin", "population": "adult", "max_daily_mg": "1000", "source_id": "TEST_A",
            "source_page": "1", "source_quote": QUOTE, "extracted_by": "Dr Priya Nair"}
    base.update(kw)
    return base


def submit(env, rows, **kw):
    cur, kb, data = env
    return kr.submit(cur, kb, rows, data, **kw)


# ------------------------------------------------------------------ submit --------------------------------------------

def test_template_lists_the_columns():
    assert kr.KINDS["dose_limit"]["fields"][0] == "drug"
    assert set(kr.CITATION) == {"source_id", "source_page", "source_quote", "extracted_by"}


def test_valid_row_is_accepted_but_dry_run_writes_nothing(env):
    results, written = submit(env, [sheet_row()])
    assert [r[2] for r in results] == [True] and written == 0
    assert "metformin" not in (env[2] / "dose_limits.csv").read_text()


def test_apply_appends_inactive_cited_row_and_keeps_existing_rows(env):
    results, written = submit(env, [sheet_row()], apply=True)
    assert written == 1
    rows, fields, _ = kr.read_csv(env[2] / "dose_limits.csv")
    assert [r["drug"] for r in rows] == ["ibuprofen", "metformin"] and rows[0]["note"] == "seed row"
    new = rows[1]
    assert (new["status"], new["provenance"], new["jurisdiction"]) == ("draft", "cited", "India")
    assert new["row_id"] and new["source_id"] == "TEST_A" and "TEST_A" in new["source"] and new["extracted_by"] == "Dr Priya Nair"
    assert {"row_id", "extracted_by", "approved_by"} <= set(fields)


@pytest.mark.parametrize("change,expected", [
    ({"source_quote": "Reduce the dose to a maximum of 2000 mg daily when eGFR is 30-44."}, "quote not found"),
    ({"drug": "zzqx"}, "not a known substance"),
    ({"population": "elderly"}, "population must be one of"),
    ({"max_daily_mg": "lots"}, "not a number"),
    ({"max_daily_mg": ""}, "give at least one limit"),
    ({"extracted_by": "Claude"}, "name of the person"),
    ({"extracted_by": ""}, "missing extracted_by"),
    ({"source_id": "NOPE_1"}, "has not been indexed"),
    ({"source_page": "9"}, "no page '9'"),
])
def test_invalid_rows_are_rejected_with_a_reason(env, change, expected):
    results, written = submit(env, [sheet_row(**change)], apply=True)
    assert results[0][2] is False and written == 0
    assert any(expected in p for p in results[0][3]), results[0][3]


def test_treatment_content_must_cite_an_indian_source(env):
    row = {"kind": "antibiotic_policy", "drug": "colistin", "tier": "reserve", "source_id": "TEST_B", "source_page": "1",
           "source_quote": RESERVE_QUOTE, "extracted_by": "Dr Priya Nair"}
    results, _ = submit(env, [row])
    assert not results[0][2] and any("must cite an Indian source" in p for p in results[0][3])
    cur = env[0]
    cur.execute("UPDATE smartrx.guideline_source SET jurisdiction='India' WHERE source_id='TEST_B'")
    assert submit(env, [row])[0][0][2] is True


def test_engine_cannot_be_given_rules_it_does_not_evaluate(env):
    row = {"kind": "clinical_rule", "drug_name": "metformin", "category": "RENAL_DOSE_REDUCTION", "parameter": "Serum Sodium", "operator": "<",
           "threshold": "130", "severity": "warning", "message": "m", "source_id": "TEST_A", "source_page": "1", "source_quote": QUOTE,
           "extracted_by": "Dr Priya Nair"}
    results, _ = submit(env, [row])
    assert any("not evaluated by the engine" in p for p in results[0][3])


def test_duplicates_are_rejected_within_a_batch_and_against_the_file(env):
    results, written = submit(env, [sheet_row(), sheet_row()], apply=True, partial=True)
    assert [r[2] for r in results] == [True, False] and written == 1
    assert any("already exists" in p for p in results[1][3])
    assert submit(env, [sheet_row()])[0][0][2] is False


def test_all_or_nothing_unless_partial(env):
    good, bad = sheet_row(), sheet_row(drug="zzqx")
    _, written = submit(env, [good, bad], apply=True)
    assert written == 0
    _, written = submit(env, [good, bad], apply=True, partial=True)
    assert written == 1


def test_crlf_files_keep_their_line_endings(env):
    row = {"kind": "clinical_rule", "drug_name": "metformin", "category": "RENAL_DOSE_REDUCTION", "parameter": "eGFR", "operator": "<",
           "threshold": "45", "severity": "warning", "message": "Reduce the dose.", "source_id": "TEST_A", "source_page": "1",
           "source_quote": QUOTE, "extracted_by": "Dr Priya Nair"}
    results, written = submit(env, [row], apply=True)
    assert written == 1, results
    raw = (env[2] / "clinical_rules.csv").read_bytes()
    assert raw.count(b"\r\n") == raw.count(b"\n") == 3                       # header + existing rule + new rule, all CRLF
    assert b"Existing rule" in raw


# ------------------------------------------------------------------ approve -------------------------------------------

def submitted(env):
    submit(env, [sheet_row()], apply=True)
    return next(r["row_id"] for r in kr.read_csv(env[2] / "dose_limits.csv")[0] if r.get("row_id"))


def test_pending_list_shows_unapproved_rows(env):
    rid = submitted(env)
    assert [(k, r["row_id"]) for k, r in kr.pending(env[2])] == [("dose_limit", rid)]


@pytest.mark.parametrize("reviewer,approver,expected", [
    ("Dr Priya Nair", "Dr Priya Nair", "different people"),
    ("Dr Anil Rao", "Dr Priya Nair", "cannot be the person who extracted"),
    ("Dr Anil Rao", "Claude", "must be the name of a person"),
])
def test_approval_refuses_same_person_extractor_or_ai(env, reviewer, approver, expected):
    rid = submitted(env)
    out = kr.approve(env[0], env[2], [rid], reviewer, approver)
    assert any(expected in p for p in out[rid])
    assert kr.read_csv(env[2] / "dose_limits.csv")[0][1]["status"] == "draft"


def test_two_person_approval_makes_the_row_verified_and_loadable(env):
    rid = submitted(env)
    out = kr.approve(env[0], env[2], [rid], "Dr Anil Rao", "Dr Meera Shah")
    assert out == {rid: []}
    row = kr.read_csv(env[2] / "dose_limits.csv")[0][1]
    assert (row["status"], row["provenance"], row["reviewed_by"], row["approved_by"]) == ("approved", "verified", "Dr Anil Rao", "Dr Meera Shah")
    assert row["approved_at"].endswith("Z")
    assert provenance.check_row("dose_limits.csv", row, {"TEST_A"}) == []
    assert kr.pending(env[2]) == []
    assert "draft + cited" in kr.approve(env[0], env[2], [rid], "Dr Anil Rao", "Dr Meera Shah")[rid][0]   # cannot approve twice


def test_approval_rechecks_the_quote_against_the_current_index(env):
    rid = submitted(env)
    cur = env[0]
    cur.execute("UPDATE smartrx.guideline_passage SET text = 'The page was replaced by a newer edition of the guideline.' "
                "WHERE source_id='TEST_A' AND page='1'")
    out = kr.approve(cur, env[2], [rid], "Dr Anil Rao", "Dr Meera Shah")
    assert any("no longer verifies" in p for p in out[rid])
    assert kr.read_csv(env[2] / "dose_limits.csv")[0][1]["status"] == "draft"


def test_unknown_row_id_is_reported(env):
    assert kr.approve(env[0], env[2], ["deadbeef"], "Dr Anil Rao", "Dr Meera Shah") == {"deadbeef": ["row_id not found"]}


# ------------------------------------------------------------------ worklist ------------------------------------------

def test_worklist_candidates_are_exact_verifiable_sentences_indian_first(db, library):
    cur, _ = db
    run_index(db, library)
    cur.execute("UPDATE smartrx.guideline_source SET jurisdiction='India' WHERE source_id='TEST_A'")
    cur.execute("INSERT INTO smartrx.guideline_passage (source_id, page, method, text, char_count, text_sha256) VALUES "
                "('TEST_B','5','html','Metformin should be stopped in renal failure according to this foreign guidance sheet.',80,'x')")
    cur.execute("UPDATE smartrx.guideline_source SET jurisdiction='US' WHERE source_id='TEST_B'")
    rows, coverage = wl.build(cur, ["metformin", "colistin"], {}, ["renal", "dose"], sources=["TEST_A", "TEST_B"])
    hits = [r for r in rows if r["drug"] == "metformin" and r["topic"] == "renal"]
    assert [h["jurisdiction"] for h in hits] == ["India", "US"]
    from modules.smartrx import quotes
    assert all(r["verifiable"] == "yes" for r in rows if r["source_id"] in ("TEST_A", "TEST_B"))
    cur.execute("SELECT text FROM smartrx.guideline_passage WHERE source_id='TEST_A' AND page='1'")
    assert quotes.quote_in_text(hits[0]["candidate_quote"], cur.fetchone()[0])
    empty = [c for c in coverage if c["drug"] == "colistin"]
    assert all(c["candidates"] == 0 for c in empty)                    # the library says nothing: that is shown, not hidden


def test_worklist_flags_ocr_pages_and_escapes_html(db, library):
    cur, _ = db
    run_index(db, library)
    cur.execute("INSERT INTO smartrx.guideline_passage (source_id, page, method, text, char_count, text_sha256) VALUES "
                "('TEST_B','8','ocr','Metformin <script>alert(1)</script> dose in renal impairment must be reduced to 500 mg.',90,'x')")
    rows, coverage = wl.build(cur, ["metformin"], {}, ["renal"], sources=["TEST_A", "TEST_B"])
    ocr = [r for r in rows if r["method"] == "ocr"]
    assert ocr and ocr[0]["verifiable"] == "no"
    page = wl.render_html(rows, coverage, {}, [])
    assert "<script>alert(1)</script>" not in page and "&lt;script&gt;" in page and "OCR" in page
    assert not [r for r in wl.build(cur, ["metformin"], {}, ["renal"], include_ocr=False, sources=["TEST_A", "TEST_B"])[0] if r["method"] == "ocr"]


def test_tsquery_names_are_safe_and_synonyms_expand(tmp_path):
    assert wl.tsquery_name("valproic acid") == "(valproic <-> acid)"
    assert wl.tsquery_name("x'; DROP TABLE y;--") == "(x <-> drop <-> table <-> y)"
    (tmp_path / "drug_synonyms.csv").write_text("synonym,components\nparacetamol,acetaminophen\n", encoding="utf-8")
    syn = wl.load_synonyms(tmp_path)
    assert syn["paracetamol"] == {"acetaminophen"} and syn["acetaminophen"] == {"paracetamol"}
