"""Step 1 of guideline sourcing: no clinical advice without a citation, enforced in code, validator and database."""
import subprocess
import sys
from pathlib import Path

import pytest

from modules.smartrx import knowledge, provenance
from test_smartrx_api import authed, client, db, run  # noqa: F401  (fixtures)

BACKEND = Path(__file__).resolve().parents[1]
SOURCES = {"SRC_001", "SRC_002"}


# ------------------------------------------------------------------ pure rules -----------------------------------------

def test_unsourced_row_cannot_be_approved():
    assert provenance.check_row("dose_limits.csv", {"status": "approved"}, SOURCES)
    assert not provenance.check_row("dose_limits.csv", {"status": "draft"}, SOURCES)
    assert not provenance.check_row("dose_limits.csv", {"status": "approved", "provenance": "cited", "source": "x"}, SOURCES)


def test_verified_needs_every_citation_field_and_two_people():
    ok = {"status": "approved", "provenance": "verified", "source_id": "SRC_001", "source_page": "12",
          "source_quote": "Do not exceed 4 g in 24 hours.", "reviewed_by": "Dr A", "approved_by": "Dr B"}
    assert provenance.check_row("dose_limits.csv", ok, SOURCES) == []
    for missing in ("source_id", "source_page", "source_quote", "reviewed_by", "approved_by"):
        assert provenance.check_row("dose_limits.csv", {**ok, missing: ""}, SOURCES), missing
    assert any("different people" in p for p in provenance.check_row("dose_limits.csv", {**ok, "approved_by": "Dr A"}, SOURCES))
    assert any("not in Source_Log" in p for p in provenance.check_row("dose_limits.csv", {**ok, "source_id": "SRC_999"}, SOURCES))


def test_shipped_csvs_pass_the_validator():
    out = subprocess.run([sys.executable, "-I", str(BACKEND / "smartrx_pipeline" / "validate_knowledge.py")],
                         capture_output=True, text=True, cwd=BACKEND)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "Unsourced rows (never active)" in out.stdout


# ------------------------------------------------------------------ database ------------------------------------------

def test_database_refuses_approved_without_citation(db):
    import psycopg2
    cur, kb = db
    m = kb.moiety_for_name("ibuprofen")
    with pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute("""INSERT INTO smartrx.dose_limit (moiety_identifier, population, max_daily_mg, status, provenance, note)
                       VALUES (%s, 'adult', 1, 'approved', 'unsourced', 'TEST-FIXTURE')""", (m,))
    with pytest.raises(psycopg2.errors.CheckViolation):      # verified without a distinct approver
        cur.execute("""INSERT INTO smartrx.dose_limit (moiety_identifier, population, max_daily_mg, status, provenance, note,
                           source_id, source_page, source_quote, reviewed_by, approved_by)
                       VALUES (%s, 'adult', 1, 'approved', 'verified', 'TEST-FIXTURE', 'SRC_001', '1', 'q', 'Dr A', 'Dr A')""", (m,))


def test_unsourced_knowledge_never_loads_even_in_shadow_mode(db, monkeypatch):
    cur, _ = db
    monkeypatch.setattr(knowledge, "ACTIVE_STATUSES", ("approved", "draft"))
    monkeypatch.setattr(knowledge, "ALLOW_UNSOURCED", False)
    kb = knowledge._load(cur, "shadow")
    assert not [i for i in kb.interactions if i["evidence"] == "curated"]       # my 47 seed pairs stay dormant
    assert not kb.dose_limits and not kb.repro and not kb.policy and not kb.cross
    assert any(i["evidence"] == "label_text" for i in kb.interactions)           # regulator label mentions are 'cited'


@pytest.fixture
def verified_dose_row(db):
    cur, kb = db
    cur.execute("DELETE FROM smartrx.dose_limit WHERE note = 'TEST-FIXTURE'")
    cur.execute("""INSERT INTO smartrx.dose_limit (moiety_identifier, population, max_single_mg, status, provenance, note, source,
                       source_id, source_page, source_quote, reviewed_by, approved_by)
                   VALUES (%s, 'adult', 1, 'approved', 'verified', 'TEST-FIXTURE', 'test', 'SRC_001', '12',
                           'test fixture quote', 'Reviewer One', 'Approver Two')""", (kb.moiety_for_name("ibuprofen"),))
    yield
    cur.execute("DELETE FROM smartrx.dose_limit WHERE note = 'TEST-FIXTURE'")


def test_verified_rule_loads_by_default_and_alert_cites_its_source(db, verified_dose_row):
    cur, _ = db
    kb = knowledge._load(cur, "fixture")                                           # default statuses, no dev switch
    item = {"medicine": "Ibuprofen", "strength": "400mg", "dosage": "1 tablet", "frequency": "TDS"}
    from modules.smartrx import context as context_mod, engine
    ctx = context_mod.build(cur, kb, {"patient_age": 40}, hospital_id=1)
    r = engine.evaluate(cur, kb, ctx, [item], 1)
    a = [x for x in r["alerts"] if x["check"] == "dose"]
    assert a and a[0]["provenance"] == "verified" and a[0]["source_ref"] == "SRC_001, p.12" and a[0]["is_blocking"] is False


def test_legacy_rules_are_active_but_flagged_unverified(db):
    r = run(db, ["Metformin 500mg"], labs={"egfr": 20})
    a = [x for x in r["alerts"] if x["check"] == "renal"][0]
    assert a["provenance"] == "cited" and a["source_ref"] is None


# ------------------------------------------------------------------ API ------------------------------------------------

def test_health_reports_how_much_knowledge_is_sourced(client, db):
    body = authed(client).get("/api/smartrx/health").get_json()
    integ = body["knowledge_integrity"]
    assert integ["dose_limits"]["unsourced"]["draft"] > 0 and "approved" not in integ["dose_limits"].get("unsourced", {})
    assert integ["unverified_but_active"] >= 1 and "verified_active" in integ
    assert "active_unsourced_drug_classes" in integ


def test_hospital_policy_rows_are_marked_as_hospital_authored(monkeypatch, client, db):
    import shared.session_auth as sa
    cur, _ = db
    user = {"id": 2, "username": "pharmacist", "hospital_id": 987655, "permissions": ["patients.read", "pharmacy.inventory.write"]}
    monkeypatch.setattr(sa, "get_session_user", lambda token: user if token == "ok" else None)
    try:
        assert authed(client).put("/api/smartrx/hospital/antibiotic-policy", json={"drug": "meropenem", "tier": "reserve"}).status_code == 200
        cur.execute("SELECT provenance, status FROM smartrx.antibiotic_policy WHERE hospital_id = 987655")
        assert cur.fetchall() == [("hospital_policy", "approved")]
    finally:
        cur.execute("DELETE FROM smartrx.antibiotic_policy WHERE hospital_id = 987655")
