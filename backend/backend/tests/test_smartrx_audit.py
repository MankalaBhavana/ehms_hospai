"""Audit trail: every evaluation is logged, and acknowledgements of critical alerts are recorded with a reason."""
import pytest

from test_smartrx_api import authed, client, db  # noqa: F401  (fixtures)

PATIENT = "AUDIT-TEST-1"


@pytest.fixture
def clean(db):
    cur, _ = db
    for t in ("evaluation_log", "alert_override"):
        cur.execute(f"DELETE FROM smartrx.{t} WHERE patient_id LIKE 'AUDIT-TEST-%'")
    yield cur
    for t in ("evaluation_log", "alert_override"):
        cur.execute(f"DELETE FROM smartrx.{t} WHERE patient_id LIKE 'AUDIT-TEST-%'")


def override(**kw):
    base = {"patient_id": PATIENT, "encounter_id": "ENC-1", "alert_id": "allergy-0-PENICILLIN", "check": "allergy", "severity": "critical",
            "drug_name": "Augmentin 625", "rule_set_version": "2026.11.24-abc", "reason_code": "benefit_outweighs_risk"}
    base.update(kw)
    return base


def test_every_evaluation_is_logged_with_alert_metadata_only(client, clean):
    cur = clean
    body = authed(client).post("/api/smartrx/evaluate", json={
        "patient_id": PATIENT, "encounter_id": "ENC-1", "patient_allergies": "penicillin",
        "items": [{"medicine": "Augmentin 625"}]}).get_json()
    assert body["has_critical"] is True
    cur.execute("""SELECT hospital_id, user_id, encounter_id, check_status, item_count, critical_count, alerts, input_sha256, rule_set_version
                   FROM smartrx.evaluation_log WHERE patient_id = %s""", (PATIENT,))
    hospital, user, enc, status, items, criticals, alerts, digest, version = cur.fetchone()
    assert (hospital, user, enc, items) == (1, "tester", "ENC-1", 1) and criticals >= 1 and len(digest) == 64
    assert version == body["rule_set_version"] and status == body["check_status"]
    assert all(set(a) == {"id", "check", "severity", "drug_name", "provenance", "source_ref"} for a in alerts)   # nothing clinical beyond the alert
    cur.execute("SELECT alerts::text FROM smartrx.evaluation_log WHERE patient_id = %s", (PATIENT,))
    assert "penicillin allergy" not in cur.fetchone()[0].lower()                                               # free-text allergy never stored


def test_a_failing_log_write_never_hides_the_safety_result(client, clean, monkeypatch):
    import modules.smartrx.routes as routes

    def boom(*a, **k):
        raise RuntimeError("log table unavailable")
    monkeypatch.setattr(routes, "get_connection", routes.get_connection)   # evaluate itself must still work
    monkeypatch.setattr(routes.hashlib, "sha256", boom)                    # break only the logging step
    res = authed(client).post("/api/smartrx/evaluate", json={"patient_id": PATIENT, "items": [{"medicine": "Paracetamol 500mg"}]})
    assert res.status_code == 200 and res.get_json()["status"] == "ok"


def test_override_is_recorded_listed_and_hospital_scoped(client, clean):
    c = authed(client)
    assert c.get(f"/api/smartrx/overrides?patient_id={PATIENT}").get_json()["items"] == []
    res = c.post("/api/smartrx/overrides", json=override())
    assert res.status_code == 201 and res.get_json()["alert_id"] == "allergy-0-PENICILLIN"
    c.post("/api/smartrx/overrides", json=override(encounter_id="ENC-2", alert_id="renal-1-0", reason_code="other", reason_text="Dialysis patient, nephrology agrees"))
    both = c.get(f"/api/smartrx/overrides?patient_id={PATIENT}").get_json()["items"]
    assert len(both) == 2 and both[0]["by"] == "tester"
    one = c.get(f"/api/smartrx/overrides?patient_id={PATIENT}&encounter_id=ENC-1").get_json()["items"]
    assert [o["alert_id"] for o in one] == ["allergy-0-PENICILLIN"]
    clean.execute("UPDATE smartrx.alert_override SET hospital_id = 99 WHERE patient_id = %s", (PATIENT,))
    assert c.get(f"/api/smartrx/overrides?patient_id={PATIENT}").get_json()["items"] == []     # another hospital's rows are invisible


@pytest.mark.parametrize("change,field", [
    ({"reason_code": "because"}, "reason_code"),
    ({"reason_code": "other", "reason_text": "no"}, "reason_text"),
    ({"patient_id": ""}, "patient_id"),
    ({"alert_id": ""}, "alert_id"),
    ({"reason_text": "x" * 600}, "reason_text"),
])
def test_override_validation(client, clean, change, field):
    res = authed(client).post("/api/smartrx/overrides", json=override(**change))
    assert res.status_code == 400 and res.get_json()["field"] == field


def test_override_endpoints_need_authentication(client):
    assert client.post("/api/smartrx/overrides", json=override()).status_code == 401
    assert client.get(f"/api/smartrx/overrides?patient_id={PATIENT}").status_code == 401


def test_evaluate_response_has_every_field_the_alert_panel_reads(client, clean):
    """The doctor-portal panel (frontend/src/components/doctor/SmartRxPanel.tsx) depends on these exact fields."""
    body = authed(client).post("/api/smartrx/evaluate", json={
        "patient_id": PATIENT, "patient_allergies": "penicillin", "patient_age": 50, "patient_sex": "male",
        "items": [{"medicine": "Augmentin 625"}, {"medicine": "Metformin 500mg"}, {"medicine": "Qwertyzol 10mg"}]}).get_json()
    for key in ("status", "check_status", "partial_reasons", "alerts", "rule_set_version", "engine_version", "coverage", "items", "context"):
        assert key in body, key
    assert body["status"] == "ok" and body["check_status"] in ("complete", "partial") and "rules_not_evaluated" in body["coverage"]
    assert body["check_status"] == "partial" and any(r.startswith("unrecognised_drug:") for r in body["partial_reasons"])
    for a in body["alerts"]:
        for key in ("id", "check", "drug_name", "severity", "title", "message", "recommendation", "source", "is_blocking"):
            assert key in a, (key, a["id"])
        assert a["severity"] in ("critical", "warning", "info") and a["is_blocking"] is False
    unavailable = authed(client).post("/api/smartrx/evaluate", json={"items": "bad"})
    assert unavailable.status_code == 400 and unavailable.get_json()["status"] == "invalid_request"
