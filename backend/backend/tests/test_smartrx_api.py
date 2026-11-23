"""SmartRx: clinical maths, name matching, allergy handling, safety checks and the HTTP surface.

Pure tests run anywhere. Engine/route tests need a database where
`python smartrx_pipeline/step2_ingest_db.py` has been run (DATABASE_URL); they skip otherwise.
Patient-table tests use an isolated schema (smartrx_fixture) so no real table is touched.
"""
import pytest

from modules.smartrx import allergy as allergy_mod
from modules.smartrx import context as context_mod
from modules.smartrx import engine, knowledge, resolver
from modules.smartrx.clinical import (ckd_epi_2021, creatinine_to_mg_dl, estimate_egfr, normalize_sex,
                                      parse_duration_days, parse_number)
from modules.smartrx.textnorm import build_moiety_map, name_key, split_name_strength


# ---------------------------------------------------------------- pure -----------------------------------------

def test_ckd_epi_2021_reference_values():
    assert ckd_epi_2021(1.0, 50, "male") == pytest.approx(91.7, abs=0.5)
    assert ckd_epi_2021(1.0, 50, "female") == pytest.approx(68.6, abs=0.5)
    assert ckd_epi_2021(3.0, 70, "male") == pytest.approx(21.7, abs=0.5)


def test_egfr_never_guesses_missing_inputs():
    assert estimate_egfr(1.2, 60, None)[2] == "sex_missing"
    assert estimate_egfr(1.2, None, "male")[2] == "age_missing"
    assert estimate_egfr(1.0, 8, "male")[2] == "height_missing_for_child"
    value, method, reason = estimate_egfr(0.8, 8, "male", height_cm=130)
    assert method == "Bedside Schwartz" and value == pytest.approx(67.1, abs=0.2) and reason is None
    assert estimate_egfr(0.4, 0.5, "male")[2] == "age_under_1_year_not_supported"


def test_unit_and_text_parsing():
    assert creatinine_to_mg_dl(88.4, "umol/L") == pytest.approx(1.0)
    assert creatinine_to_mg_dl(1.2, "mg/dL") == 1.2
    assert parse_number(">60 mL/min") == 60 and parse_number("n/a") is None
    assert normalize_sex("F") == "female" and normalize_sex("unknown") is None
    assert parse_duration_days("2 weeks") == 14 and parse_duration_days("10d") == 10
    assert parse_duration_days("7") == 7 and parse_duration_days("as needed") is None


def test_name_matching_folds_salts_but_not_different_drugs():
    assert name_key("Amoxicillin trihydrate") == name_key("amoxicillin")
    assert name_key("Sodium valproate") == name_key("Valproate sodium")
    assert name_key("Insulin glargine") != name_key("Insulin lispro")
    assert name_key("Potassium chloride") != name_key("Calcium chloride")
    ids, rep = build_moiety_map([("1", "Amoxicillin"), ("2", "Amoxicillin trihydrate"), ("3", "Insulin glargine")])
    assert ids["2"] == "1" and ids["3"] == "3"


def test_strength_extraction():
    assert split_name_strength("Augmentin 625 mg tab") == ("augmentin", ["625mg"])
    assert split_name_strength("Dolo 650") == ("dolo", ["650"])
    assert split_name_strength("metformin 500mg tablets")[1] == ["500mg"]


def test_duration_and_operators_in_engine_helpers():
    assert engine._compare("<", 25, "30") is True
    assert engine._compare("IN", "iv", "IV, SC") is True
    assert engine._compare("==", "Pregnant", "pregnant") is True


# ---------------------------------------------------------------- database-backed ------------------------------

@pytest.fixture(scope="module")
def db():
    psycopg2 = pytest.importorskip("psycopg2")
    from utils.database import DATABASE_URL, _normalize_database_url
    try:
        conn = psycopg2.connect(_normalize_database_url(DATABASE_URL), connect_timeout=3)
    except Exception as exc:
        pytest.skip(f"database not reachable: {exc}")
    conn.autocommit = True
    cur = conn.cursor()
    knowledge.reset_cache()
    try:
        kb = knowledge.get_knowledge(cur)
    except knowledge.KnowledgeUnavailable as exc:
        conn.close()
        pytest.skip(f"smartrx knowledge not loaded: {exc}")
    yield cur, kb
    conn.close()


def run(db, items, hospital_id=1, kb=None, **payload):
    cur, db_kb = db
    kb = kb or db_kb
    payload.setdefault("patient_id", None)
    ctx = context_mod.build(cur, kb, payload, hospital_id=hospital_id)
    return engine.evaluate(cur, kb, ctx, [{"medicine": m} if isinstance(m, str) else m for m in items], hospital_id)


def titles(result):
    return [a["title"] for a in result["alerts"]]


def test_resolver_brand_substance_and_prefix_boundaries(db):
    cur, kb = db
    aug = resolver.resolve(cur, kb, "Augmentin 625 Duo")
    assert aug.matched and aug.moieties and not aug.ambiguous
    names = {kb.moiety_label(m).lower() for m in aug.moieties}
    assert {"amoxicillin", "clavulanic acid"} <= names

    met = resolver.resolve(cur, kb, "metformin 500 mg")
    assert met.method == "substance_name" and kb.moiety_label(met.moieties[0]).lower() == "metformin"

    combo = resolver.resolve(cur, kb, "amoxicillin + clavulanic acid")
    assert len(combo.moieties) == 2

    assert not resolver.resolve(cur, kb, "zzqxv nonsense 5mg").matched
    assert not resolver.resolve(cur, kb, "").matched


def test_resolver_fuzzy_is_flagged_not_silent(db):
    cur, kb = db
    r = resolver.resolve(cur, kb, "metformim 500")
    if r.matched:  # typo tolerance is best-effort; if it resolves it must say so and carry lower confidence
        assert r.method == "fuzzy" and r.confidence < 0.9 and r.interpreted_as


def test_free_text_allergy_parsing(db):
    _, kb = db
    entries, nk = allergy_mod.parse_free_text("Severe Penicillin allergy, Hives", kb)
    assert not nk and len(entries) == 1
    e = entries[0]
    assert (e.kind, e.code, e.severity) == ("class", "PENICILLIN", "severe") and "hives" in (e.reaction or "")

    for text in ("NKDA", "No known drug allergies", "nil", "None"):
        assert allergy_mod.parse_free_text(text, kb) == ([], True), text

    entries, _ = allergy_mod.parse_free_text("sulfa; peanuts and amoxicillin", kb)
    kinds = {(e.kind, e.code or e.text) for e in entries}
    assert ("class", "SULFONAMIDE_ANTIBIOTIC") in kinds
    assert any(e.kind == "substance" for e in entries)
    assert any(e.kind == "unmapped" and "peanut" in e.text.lower() for e in entries)
    assert allergy_mod.parse_free_text(None, kb) == ([], False)


def test_allergy_class_conflict_uses_ingredients_not_brand_text(db):
    r = run(db, ["Augmentin 625mg"], patient_allergies="Severe Penicillin allergy, Hives")
    assert r["has_critical"]
    a = [x for x in r["alerts"] if x["check"] == "allergy"][0]
    assert a["severity"] == "critical" and a["is_blocking"] is False and "Penicillins" in a["title"]
    assert a["matched_on"] == "catalogue"


def test_allergy_substance_matches_salt_forms_and_other_brands(db):
    r = run(db, ["Amoxicillin 500mg"], patient_allergies="allergic to amoxicillin")
    assert any(a["check"] == "allergy" and a["severity"] == "critical" for a in r["alerts"])
    r = run(db, ["Diclofenac sodium 50"], patient_allergies="NSAIDs")
    assert any(a["check"] == "allergy" for a in r["alerts"])


def test_no_false_allergy_alert_for_unrelated_drug(db):
    r = run(db, ["Paracetamol 500mg"], patient_allergies="penicillin, sulfa")
    assert not [a for a in r["alerts"] if a["check"] == "allergy" and a["severity"] != "info"]


def test_uninterpretable_allergy_is_reported_not_ignored(db):
    r = run(db, ["Paracetamol 500mg"], patient_allergies="peanuts")
    assert any(a["title"] == "Allergy Not Interpreted" for a in r["alerts"])
    assert r["check_status"] == "partial" and any(p.startswith("allergy_not_interpreted") for p in r["partial_reasons"])


def test_cross_reactivity_only_from_active_knowledge(db, monkeypatch):
    cur, _ = db
    r = run(db, ["Ceftriaxone 1g"], patient_allergies="penicillin")
    assert not [a for a in r["alerts"] if a["title"].startswith("Possible Cross")]  # draft rows are off by default
    monkeypatch.setattr(knowledge, "ACTIVE_STATUSES", ("approved", "draft"))
    monkeypatch.setattr(knowledge, "ALLOW_UNSOURCED", True)  # the cross-reactivity seed is unsourced (dev switch)
    draft_kb = knowledge._load(cur, "test-draft")
    ctx = context_mod.build(cur, draft_kb, {"patient_allergies": "penicillin"}, hospital_id=1)
    res = engine.evaluate(cur, draft_kb, ctx, [{"medicine": "Ceftriaxone 1g"}])
    xr = [a for a in res["alerts"] if a["title"].startswith("Possible Cross")]
    assert xr and xr[0]["knowledge_status"] == "draft" and xr[0]["is_blocking"] is False


def test_duplicate_therapy_by_shared_ingredient(db):
    r = run(db, ["Augmentin 625", "Amoxicillin 500"])
    assert any(a["check"] == "duplicate" and "amoxicillin" in a["message"].lower() for a in r["alerts"])
    r = run(db, ["Insulin glargine", "Insulin lispro"])
    assert not [a for a in r["alerts"] if a["check"] == "duplicate"]
    r = run(db, ["Augmentin DUO 500 mg + 125 mg", "Augmentin DUO 875 mg + 125 mg"])
    assert any(a["check"] == "duplicate" for a in r["alerts"])


@pytest.mark.parametrize("egfr,expected", [(25, "critical"), (40, "warning"), (75, None)])
def test_metformin_renal_thresholds(db, egfr, expected):
    r = run(db, ["Metformin 500mg"], labs={"egfr": egfr})
    sev = [a["severity"] for a in r["alerts"] if a["check"] == "renal" and a["severity"] != "info"]
    assert (expected in sev) if expected else not sev


def test_stricter_renal_rule_supersedes_milder_one(db):
    r = run(db, ["Metformin 500mg"], labs={"egfr": 25})
    renal = [a for a in r["alerts"] if a["check"] == "renal"]
    assert len(renal) == 1 and renal[0]["severity"] == "critical"


def test_renal_rule_applies_to_combination_products(db):
    r = run(db, ["metformin + glimepiride"], labs={"egfr": 20})
    assert any(a["check"] == "renal" and a["severity"] == "critical" for a in r["alerts"])


def test_egfr_computed_from_creatinine_with_age_and_sex(db):
    r = run(db, ["Metformin 500mg"], patient_age=70, patient_sex="male", labs={"creatinine": 3.0})
    assert r["context"]["egfr"] == pytest.approx(21.7, abs=0.5)
    assert r["context"]["egfr_method"] == "CKD-EPI 2021"
    assert any(a["check"] == "renal" and a["severity"] == "critical" for a in r["alerts"])


def test_missing_sex_means_not_checked_and_says_so(db):
    r = run(db, ["Metformin 500mg"], patient_age=70, labs={"creatinine": 3.0})
    assert r["context"]["egfr"] is None
    assert any(a["title"].startswith("Renal Function Not On Record") for a in r["alerts"])
    assert r["check_status"] == "partial"
    assert any("sex_missing" in p for p in r["partial_reasons"])


def test_stale_renal_result_is_labelled(db):
    r = run(db, ["Metformin 500mg"], labs={"egfr": 20, "measured_at": "2020-01-01T00:00:00Z"})
    a = [x for x in r["alerts"] if x["check"] == "renal" and x["severity"] == "critical"][0]
    assert "older than" in a["message"] and r["context"]["egfr_stale"] is True


def test_pregnancy_rule(db):
    r = run(db, ["Telmisartan 40mg"], pregnant=True)
    assert any(a["check"] == "pregnancy" and a["severity"] == "critical" for a in r["alerts"])
    assert not [a for a in run(db, ["Telmisartan 40mg"], pregnant=False)["alerts"] if a["check"] == "pregnancy"]


def test_high_alert_respects_route_and_form(db):
    assert any(a["check"] == "high_alert" for a in run(db, ["Insulin glargine"])["alerts"])
    assert any(a["check"] == "high_alert" for a in run(db, ["Morphine"])["alerts"])
    oral = run(db, [{"medicine": "Potassium chloride", "route": "oral"}])
    assert not [a for a in oral["alerts"] if a["check"] == "high_alert"]
    conc = run(db, [{"medicine": "Potassium chloride", "dosage_form": "concentrated injection"}])
    assert any(a["check"] == "high_alert" and a["severity"] == "critical" for a in conc["alerts"])


def test_stewardship_rules(db):
    assert any(a["check"] == "stewardship" for a in run(db, ["Colistin"])["alerts"])
    assert any(a["check"] == "stewardship" for a in run(db, [{"medicine": "Meropenem", "duration": "10 days"}])["alerts"])
    assert not [a for a in run(db, [{"medicine": "Meropenem", "duration": "5 days"}])["alerts"] if a["check"] == "stewardship"]
    r = run(db, [{"medicine": "Meropenem"}])
    assert any("duration not stated" in s for s in r["coverage"]["rules_not_evaluated"])


def test_unrecognised_drug_is_partial_never_clean(db):
    r = run(db, ["Qwertyzol 10mg"])
    assert r["check_status"] == "partial"
    assert any(a["check"] == "coverage" and a["severity"] == "info" for a in r["alerts"])


def test_every_alert_is_non_blocking_and_sorted(db):
    r = run(db, ["Augmentin 625", "Amoxicillin 500", "Metformin 500", "Insulin glargine"],
            patient_allergies="penicillin", labs={"egfr": 20})
    assert r["alerts"] and all(a["is_blocking"] is False for a in r["alerts"])
    ranks = [{"critical": 0, "warning": 1, "info": 2}[a["severity"]] for a in r["alerts"]]
    assert ranks == sorted(ranks)
    assert r["rule_set_version"] and r["engine_version"]


def test_empty_prescription(db):
    r = run(db, [])
    assert r["evaluated_count"] == 0 and r["alerts"] == [] and r["check_status"] in ("complete", "partial")


# ---------------------------------------------------------------- patient record path (fixture schema) ---------

@pytest.fixture
def fixture_schema(db):
    cur, _ = db
    cur.execute("DROP SCHEMA IF EXISTS smartrx_fixture CASCADE")
    cur.execute("CREATE SCHEMA smartrx_fixture")
    cur.execute("SET search_path TO smartrx_fixture, public")
    cur.execute("""CREATE TABLE patients (patient_id TEXT, hospital_id INT, age INT, dob DATE, gender TEXT,
                   weight REAL, height REAL, pregnant INT DEFAULT 0, allergies TEXT)""")
    cur.execute("CREATE TABLE medical_history (id SERIAL, patient_id TEXT, allergies TEXT)")
    cur.execute("""CREATE TABLE icu_lab_results (id SERIAL, patient_id TEXT, test_name TEXT, value TEXT, unit TEXT,
                   created_at TIMESTAMP DEFAULT NOW())""")
    yield cur
    cur.execute("SET search_path TO public")
    cur.execute("DROP SCHEMA smartrx_fixture CASCADE")
    cur.execute("DELETE FROM smartrx.patient_allergy WHERE patient_id LIKE 'FIXTURE-%'")


def test_patient_record_supplies_demographics_labs_and_legacy_allergies(db, fixture_schema):
    cur = fixture_schema
    cur.execute("INSERT INTO patients VALUES ('FIXTURE-1', 1, 70, NULL, 'Male', 70, 170, 0, 'Penicillin allergy')")
    cur.execute("INSERT INTO icu_lab_results (patient_id, test_name, value, unit) VALUES ('FIXTURE-1','Serum Creatinine','3.0','mg/dL')")
    r = run(db, ["Metformin 500mg", "Augmentin 625"], patient_id="FIXTURE-1")
    assert r["context"]["patient_found"] and r["context"]["egfr_source"] == "icu_lab_creatinine"
    assert r["context"]["egfr"] == pytest.approx(21.7, abs=0.5)
    assert any(a["check"] == "allergy" and a["severity"] == "critical" for a in r["alerts"])
    assert any(a["check"] == "renal" and a["severity"] == "critical" for a in r["alerts"])


def test_patient_from_another_hospital_is_not_read(db, fixture_schema):
    cur = fixture_schema
    cur.execute("INSERT INTO patients VALUES ('FIXTURE-2', 99, 70, NULL, 'Male', 70, 170, 0, 'Penicillin allergy')")
    cur.execute("INSERT INTO icu_lab_results (patient_id, test_name, value, unit) VALUES ('FIXTURE-2','eGFR','10','')")
    r = run(db, ["Augmentin 625", "Metformin 500mg"], patient_id="FIXTURE-2")  # evaluated as hospital 1
    assert r["context"]["patient_found"] is False and r["context"]["egfr"] is None
    assert not [a for a in r["alerts"] if a["severity"] == "critical"]


def test_structured_allergy_round_trip_and_upsert(db, fixture_schema):
    cur, kb = db
    cur.execute("INSERT INTO patients VALUES ('FIXTURE-3', 1, 40, NULL, 'F', 60, 160, 0, NULL)")
    e = allergy_mod.resolve_allergen("sulfa", kb)
    e.severity = "severe"
    first = allergy_mod.save_entry(cur, 1, "FIXTURE-3", e)
    again = allergy_mod.save_entry(cur, 1, "FIXTURE-3", allergy_mod.resolve_allergen("sulphonamide", kb))
    assert first == again  # same allergen -> one active row
    assert len(allergy_mod.load_structured(cur, 1, "FIXTURE-3")) == 1
    r = run(db, ["Cotrimoxazole 480"], patient_id="FIXTURE-3")
    assert any(a["check"] == "allergy" and a["severity"] == "critical" for a in r["alerts"])


# ---------------------------------------------------------------- HTTP surface ---------------------------------

@pytest.fixture
def client(monkeypatch):
    from app import app
    import shared.session_auth as sa
    app.config["TESTING"] = True
    user = {"id": 1, "username": "tester", "hospital_id": 1, "permissions": ["patients.read", "patients.clinical.write"]}
    monkeypatch.setattr(sa, "get_session_user", lambda token: user if token == "ok" else None)
    with app.test_client() as c:
        yield c


def authed(client):
    from core.auth import SESSION_COOKIE_NAME
    client.set_cookie(SESSION_COOKIE_NAME, "ok")
    return client


def test_routes_require_authentication(client):
    assert client.get("/api/smartrx/catalog/search?q=aug").status_code == 401
    assert client.post("/api/smartrx/evaluate", json={}).status_code == 401
    assert client.get("/api/smartrx/health").status_code == 401


def test_evaluate_validates_input(client, db):
    c = authed(client)
    assert c.post("/api/smartrx/evaluate", data="not json", content_type="application/json").status_code == 400
    assert c.post("/api/smartrx/evaluate", json={"items": "x"}).status_code == 400
    assert c.post("/api/smartrx/evaluate", json={"items": [{"medicine": "x" * 400}]}).status_code == 400
    assert c.post("/api/smartrx/evaluate", json={"items": [{"medicine": "a"}] * 500}).status_code == 400
    assert c.post("/api/smartrx/evaluate", json={"items": [{"strength": "5mg"}]}).status_code == 400


def test_evaluate_end_to_end(client, db):
    c = authed(client)
    res = c.post("/api/smartrx/evaluate", json={
        "patient_allergies": "Severe Penicillin allergy, Hives",
        "items": [{"medicine": "Augmentin 625mg", "strength": "625mg", "dosage": "1 tab", "frequency": "BD"}]})
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] == "ok" and body["has_critical"] is True and body["rule_set_version"]
    assert all(a["is_blocking"] is False for a in body["alerts"])


def test_catalog_search_and_health(client, db):
    c = authed(client)
    body = c.get("/api/smartrx/catalog/search?q=Augmentin&limit=5").get_json()
    assert body["count"] > 0 and "brand_name" in body["items"][0]
    assert c.get("/api/smartrx/catalog/search?q=a").get_json()["items"] == []
    assert c.get("/api/smartrx/catalog/search?q=aug&limit=abc").status_code == 400
    health = c.get("/api/smartrx/health").get_json()
    assert health["status"] == "ok" and health["brands"] > 90000 and health["schema_version"]
