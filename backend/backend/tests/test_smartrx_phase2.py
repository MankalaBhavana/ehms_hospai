"""SmartRx Phase 2: interactions, dose limits, pregnancy/lactation, antibiotic policy, hospital formulary.

Reuses the database/HTTP fixtures of test_smartrx_api. Most Phase 2 knowledge ships as `draft` (clinical sign-off
pending), so these tests evaluate against a knowledge snapshot that includes drafts; one test proves that the
default (approved-only) snapshot stays silent.
"""
import pytest

from modules.smartrx import dosing, knowledge
from test_smartrx_api import authed, client, db, run  # noqa: F401  (fixtures)


def test_dose_parsing():
    e = dosing.estimate("500mg", "1 tab", "BD")
    assert (e.single_mg, e.daily_mg, e.doses_per_week) == (500, 1000, 14)
    e = dosing.estimate("500mg", "2 tablets", "TDS")
    assert (e.single_mg, e.daily_mg) == (1000, 3000)
    assert dosing.estimate("250mg", "1-0-1", "").daily_mg == 500
    e = dosing.estimate("0.5g", "", "q6h")
    assert e.single_mg == 500 and e.daily_mg == 2000 and "one unit per dose assumed" in e.assumptions
    assert dosing.estimate("25mg", "1 tab", "weekly").doses_per_week == 1
    sos = dosing.estimate("10mg", "1", "SOS")
    assert sos.daily_mg is None and sos.as_needed
    assert dosing.estimate("5mg/5ml", "5 ml", "BD").single_mg is None     # concentrations are not mass strengths
    assert dosing.estimate("500", "1 tab", "BD").single_mg is None         # a bare number is not guessed to be mg


@pytest.fixture(scope="module")
def draft_db(db):
    """Same database, with draft AND unsourced knowledge loaded (test-only view; production never loads unsourced rows)."""
    cur, _ = db
    mp = pytest.MonkeyPatch()
    mp.setattr(knowledge, "ACTIVE_STATUSES", ("approved", "draft"))
    mp.setattr(knowledge, "ALLOW_UNSOURCED", True)   # the development seeds are unsourced; the dev switch loads them for tests
    kb = knowledge._load(cur, "test-draft")
    mp.undo()
    return cur, kb


def drun(draft_db, items, **payload):
    return run(draft_db, items, **payload)


def checks_of(result, name):
    return [a for a in result["alerts"] if a["check"] == name]


def test_phase2_is_inactive_until_clinically_approved(db):
    r = run(db, ["Sildenafil 50mg", "Isosorbide mononitrate 20mg"])
    assert not checks_of(r, "interaction")


def test_nitrate_pde5_is_critical_and_non_blocking(draft_db):
    r = drun(draft_db, ["Sildenafil 50mg", "Isosorbide mononitrate 20mg"])
    ix = checks_of(r, "interaction")
    assert ix and ix[0]["severity"] == "critical" and ix[0]["is_blocking"] is False and ix[0]["knowledge_status"] == "draft"


def test_interaction_via_class_membership(draft_db):
    assert any(a["severity"] == "warning" for a in checks_of(drun(draft_db, ["Warfarin 5mg", "Ibuprofen 400mg"]), "interaction"))
    assert any("Dual" in a["message"] for a in checks_of(drun(draft_db, ["Enalapril 5mg", "Telmisartan 40mg"]), "interaction"))


def test_no_interaction_for_unrelated_or_identical_drugs(draft_db):
    r = drun(draft_db, ["Paracetamol 500mg", "Pantoprazole 40mg"])
    assert not [a for a in checks_of(r, "interaction") if a["severity"] != "info"]
    assert not checks_of(drun(draft_db, ["Warfarin 5mg", "Warfarin 2mg"]), "interaction")


def test_interaction_with_current_medication(draft_db):
    r = drun(draft_db, ["Ciprofloxacin 500mg"], current_medications=["Warfarin 5mg"])
    a = [x for x in checks_of(r, "interaction") if x["severity"] == "warning"]
    assert a and "current medication" in a[0]["message"]
    assert r["context"]["current_medications_considered"] == 1


def test_unrecognised_current_medication_is_reported(draft_db):
    r = drun(draft_db, ["Ciprofloxacin 500mg"], current_medications=["Zzqq Nonsense"])
    assert any("current medication" in n for n in r["coverage"]["rules_not_evaluated"])


def test_label_text_interactions_are_info_only_and_quote_the_label(draft_db):
    _, kb = draft_db
    label = next(i for i in kb.interactions if i["evidence"] == "label_text" and i["a_kind"] == "substance" and i["b_kind"] == "substance")
    r = drun(draft_db, [kb.moiety_label(label["a_ref"]), kb.moiety_label(label["b_ref"])])
    found = checks_of(r, "interaction")
    assert found and all(a["is_blocking"] is False for a in found)
    # either the label mention surfaces (info, with the quoted sentence) or a curated pair for the same two drugs outranks it
    assert any(a.get("evidence") == "label_text" and a["severity"] == "info" and "Label text" in a["message"] for a in found) \
        or any(a["severity"] in ("warning", "critical") for a in found)


@pytest.mark.parametrize("item,expect", [
    ({"medicine": "Paracetamol", "strength": "500mg", "dosage": "3 tablets", "frequency": "QID"}, True),
    ({"medicine": "Paracetamol", "strength": "500mg", "dosage": "1 tablet", "frequency": "TDS"}, False),
])
def test_adult_dose_limits(draft_db, item, expect):
    assert bool(checks_of(drun(draft_db, [item], patient_age=30), "dose")) is expect


def test_dose_not_checked_is_reported_not_silent(draft_db):
    item = {"medicine": "Paracetamol", "strength": "500mg", "dosage": "3 tablets", "frequency": "QID"}
    r = drun(draft_db, [item])
    assert not checks_of(r, "dose") and any("age unknown" in n for n in r["coverage"]["rules_not_evaluated"])
    r = drun(draft_db, [{"medicine": "Paracetamol", "dosage": "1 tablet", "frequency": "TDS"}], patient_age=30)
    assert any("no usable strength" in n for n in r["coverage"]["rules_not_evaluated"])


def test_child_weight_based_dose(draft_db):
    item = {"medicine": "Paracetamol", "strength": "500mg", "dosage": "1 tablet", "frequency": "QID"}
    assert any("mg/kg" in a["message"] for a in checks_of(drun(draft_db, [item], patient_age=5, patient_weight_kg=15), "dose"))
    r = drun(draft_db, [item], patient_age=5)
    assert any("weight missing" in n for n in r["coverage"]["rules_not_evaluated"])
    assert not checks_of(drun(draft_db, [item], patient_age=5, patient_weight_kg=60), "dose")


def test_methotrexate_daily_dosing_is_flagged(draft_db):
    base = {"medicine": "Methotrexate", "strength": "2.5mg", "dosage": "1 tablet"}
    daily = drun(draft_db, [{**base, "frequency": "OD"}], patient_age=45)
    assert any(a["severity"] == "critical" and "per week" in a["message"] for a in checks_of(daily, "dose"))
    assert not checks_of(drun(draft_db, [{**base, "frequency": "weekly"}], patient_age=45), "dose")


def test_combination_products_are_not_dose_checked_against_one_ingredient(draft_db):
    item = {"medicine": "Augmentin 625", "strength": "625mg", "dosage": "5 tablets", "frequency": "QID"}
    assert not checks_of(drun(draft_db, [item], patient_age=30), "dose")


def test_pregnancy_and_lactation_knowledge(draft_db):
    assert any(a["severity"] == "critical" for a in checks_of(drun(draft_db, ["Enalapril 5mg"], pregnant=True), "pregnancy"))
    assert not [a for a in checks_of(drun(draft_db, ["Enalapril 5mg"], pregnant=False), "pregnancy") if a["severity"] != "info"]
    assert any(a["severity"] == "critical" for a in checks_of(drun(draft_db, ["Codeine 30mg"], lactating=True), "lactation"))


def test_specific_pregnancy_rule_is_not_duplicated_by_class_rule(draft_db):
    r = drun(draft_db, ["Telmisartan 40mg"], pregnant=True)
    assert len([a for a in checks_of(r, "pregnancy") if a["severity"] == "critical"]) == 1


def test_unknown_pregnancy_status_in_childbearing_age_is_asked_for(draft_db):
    r = drun(draft_db, ["Enalapril 5mg"], patient_age=28, patient_sex="female")
    assert any(a["title"] == "Pregnancy Status Not Recorded" for a in r["alerts"])
    assert not checks_of(drun(draft_db, ["Enalapril 5mg"], patient_age=70, patient_sex="female"), "pregnancy")
    assert not checks_of(drun(draft_db, ["Enalapril 5mg"], patient_age=28, patient_sex="male"), "pregnancy")


def test_reserve_antibiotic_policy_without_duplicating_rule_alert(draft_db):
    r = drun(draft_db, ["Linezolid 600mg"])
    assert any(a["title"].startswith("Reserve Antibiotic") for a in checks_of(r, "stewardship"))
    assert len(checks_of(drun(draft_db, ["Colistin"]), "stewardship")) == 1


SENTINEL_HOSPITAL = 987654


@pytest.fixture
def hospital_rows(db):
    cur, _ = db
    yield SENTINEL_HOSPITAL
    cur.execute("DELETE FROM smartrx.antibiotic_policy WHERE hospital_id = %s", (SENTINEL_HOSPITAL,))
    cur.execute("DELETE FROM smartrx.hospital_formulary WHERE hospital_id = %s", (SENTINEL_HOSPITAL,))


def test_hospital_overrides_are_scoped_to_that_hospital(db, hospital_rows):
    cur, kb = db
    cur.execute("""INSERT INTO smartrx.antibiotic_policy (hospital_id, moiety_identifier, tier, restricted_to, status, provenance)
                   VALUES (%s, %s, 'reserve', 'ID consultant', 'approved', 'hospital_policy')""", (SENTINEL_HOSPITAL, kb.moiety_for_name("meropenem")))
    cur.execute("""INSERT INTO smartrx.hospital_formulary (hospital_id, moiety_identifier, status, alternative)
                   VALUES (%s, %s, 'non_formulary', 'Omeprazole')""", (SENTINEL_HOSPITAL, kb.moiety_for_name("pantoprazole")))
    mine = run(db, ["Meropenem 1g", "Pantoprazole 40mg"], hospital_id=SENTINEL_HOSPITAL)
    assert any("ID consultant" in a["message"] for a in checks_of(mine, "stewardship"))
    form = checks_of(mine, "formulary")
    assert form and "Omeprazole" in form[0]["recommendation"] and form[0]["is_blocking"] is False
    other = run(db, ["Meropenem 1g", "Pantoprazole 40mg"], hospital_id=1)
    assert not checks_of(other, "formulary") and not [a for a in other["alerts"] if a["title"].startswith("Reserve Antibiotic")]


def test_phase2_input_validation_and_permissions(client, db):
    c = authed(client)
    assert c.post("/api/smartrx/evaluate", json={"items": [{"medicine": "x"}], "current_medications": ["a"] * 50}).status_code == 400
    ok = c.post("/api/smartrx/evaluate", json={"items": [{"medicine": "Paracetamol", "strength": "500mg"}], "lactating": True,
                                                 "current_medications": ["Warfarin"]})
    assert ok.status_code == 200 and ok.get_json()["context"]["lactating"] is True
    # the default test user holds only patients.* permissions, so changing hospital policy is refused
    assert c.put("/api/smartrx/hospital/formulary", json={"drug": "pantoprazole", "status": "restricted"}).status_code == 403
    assert c.put("/api/smartrx/hospital/antibiotic-policy", json={"drug": "meropenem", "tier": "reserve"}).status_code == 403


def test_formulary_and_policy_admin_round_trip(monkeypatch, client, db, hospital_rows):
    import shared.session_auth as sa
    user = {"id": 2, "username": "pharmacist", "hospital_id": SENTINEL_HOSPITAL,
            "permissions": ["patients.read", "pharmacy.inventory.write"]}
    monkeypatch.setattr(sa, "get_session_user", lambda token: user if token == "ok" else None)
    c = authed(client)
    assert c.put("/api/smartrx/hospital/formulary", json={"drug": "pantoprazole", "status": "bogus"}).status_code == 400
    assert c.put("/api/smartrx/hospital/formulary", json={"drug": "zzqx", "status": "restricted"}).status_code == 400
    put = c.put("/api/smartrx/hospital/formulary", json={"drug": "pantoprazole", "status": "restricted", "note": "GI team only"})
    assert put.status_code == 200 and put.get_json()["status"] == "restricted"
    again = c.put("/api/smartrx/hospital/formulary", json={"drug": "Pantoprazole", "status": "non_formulary"})
    assert again.get_json()["id"] == put.get_json()["id"]                      # upsert, not a duplicate row
    items = c.get("/api/smartrx/hospital/formulary").get_json()["items"]
    assert len(items) == 1 and items[0]["status"] == "non_formulary"
    assert c.put("/api/smartrx/hospital/antibiotic-policy", json={"drug": "meropenem", "tier": "reserve", "restricted_to": "ID team"}).status_code == 200
    body = c.post("/api/smartrx/evaluate", json={"items": [{"medicine": "Meropenem 1g"}, {"medicine": "Pantoprazole 40mg"}]}).get_json()
    assert any("ID team" in a["message"] for a in checks_of(body, "stewardship"))
    assert checks_of(body, "formulary")
    assert c.delete(f"/api/smartrx/hospital/formulary/{items[0]['id']}").status_code == 200
    assert c.get("/api/smartrx/hospital/formulary").get_json()["items"] == []
