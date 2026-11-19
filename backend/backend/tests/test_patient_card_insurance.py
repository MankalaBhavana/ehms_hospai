"""The insurance summary on the patient record / card page: policies with the daily bed and ICU limits and co-pay,
cases with what the insurer approved. A card scan (no login) sees policy and member numbers masked."""
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

from modules.patients import routes  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self._rows = rows
        self.sql = ""
        self.params = None

    def execute(self, sql, params=None):
        self.sql, self.params = sql, params

    def fetchall(self):
        return self._rows


class _Conn:
    def __init__(self, cursor):
        self._c = cursor

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self):
        return self._c


def _patch(monkeypatch, rows):
    cur = _Cursor(rows)
    monkeypatch.setattr(routes, "get_connection", lambda: _Conn(cur))
    return cur


POLICY = {"insurerName": "Star Health", "tpaName": "Medi Assist", "policyNumber": "STR-77881", "memberId": "MEM-5501", "relationship": "Self", "validUntil": "2027-12-31", "sumInsured": 500000, "balanceAvailable": 420000, "roomRentPerDay": 5000, "icuRentPerDay": 10000, "copayPercentage": 10, "status": "Active"}
CASE = {"id": "CLM-1", "status": "PREAUTH_APPROVED", "encounterType": "IP", "department": "Inpatient", "policy": {**POLICY}, "preAuth": {"approvalCode": "AUTH-9"}, "approvedPreAuthAmount": 360000, "finalClaimAmount": 0, "approvedClaimAmount": 0, "updatedAt": "2026-11-17T00:00:00Z"}


def test_numbers_are_masked_except_the_last_four():
    assert routes._mask_tail("STR-77881") == "•" * 5 + "7881"
    assert routes._mask_tail("123") == "123"
    assert routes._mask_tail("") == ""


def test_card_scan_gets_limits_copay_and_approval_with_numbers_masked(monkeypatch):
    _patch(monkeypatch, [{"collection": "patient_policies", "doc": POLICY}, {"collection": "cases", "doc": CASE}])
    out = routes._patient_insurance("PAT-1", 1, mask=True)
    assert len(out["policies"]) == 1  # the case's policy is the same policy: listed once
    p = out["policies"][0]
    assert p["room_rent_per_day"] == 5000 and p["icu_rent_per_day"] == 10000 and p["copay_percentage"] == 10
    assert p["sum_insured"] == 500000 and p["balance_available"] == 420000
    assert p["policy_number"].endswith("7881") and p["policy_number"] != "STR-77881"
    assert p["member_id"].endswith("5501") and p["member_id"] != "MEM-5501"
    c = out["cases"][0]
    assert c["case_id"] == "CLM-1" and c["approved_pre_auth"] == 360000 and c["approval_code"] == "AUTH-9"


def test_staff_lookup_sees_full_numbers(monkeypatch):
    _patch(monkeypatch, [{"collection": "patient_policies", "doc": POLICY}])
    assert routes._patient_insurance("PAT-1", 1, mask=False)["policies"][0]["policy_number"] == "STR-77881"


def test_a_policy_known_only_from_a_case_is_still_listed(monkeypatch):
    _patch(monkeypatch, [{"collection": "cases", "doc": CASE}])
    assert [x["insurer"] for x in routes._patient_insurance("PAT-1", 1)["policies"]] == ["Star Health"]


def test_no_insurance_is_empty_not_invented(monkeypatch):
    _patch(monkeypatch, [])
    assert routes._patient_insurance("PAT-1", 1) == {"policies": [], "cases": []}


def test_it_is_scoped_to_the_patient_and_hospital(monkeypatch):
    cur = _patch(monkeypatch, [])
    routes._patient_insurance("PAT-42", 7)
    assert cur.params == (7, "PAT-42") and "deleted_at IS NULL" in cur.sql


def test_a_database_error_never_breaks_the_record(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(routes, "get_connection", boom)
    assert routes._patient_insurance("PAT-1", 1) == {"policies": [], "cases": []}
