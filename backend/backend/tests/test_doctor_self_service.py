"""Doctor self-service availability: Active/Inactive switch, several time slots, and who may be booked.

Integration tests: they need a reachable PostgreSQL (DATABASE_URL) and skip when there is none. Point
DATABASE_URL at a throwaway database -- they create staff and doctor rows.
"""
import datetime
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from utils.database import (  # noqa: E402
        create_admin_doctor,
        create_admin_user,
        delete_admin_user,
        get_connection,
        list_admin_users,
        update_admin_user,
    )

    with get_connection() as _c:
        _c.cursor().execute("SELECT 1")
    DB_OK = True
except Exception:  # no database in this environment
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="needs a reachable PostgreSQL (DATABASE_URL)")

PASSWORD = "Zx9!kQ2#mV7pLw"
ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _hhmm(delta_minutes=0):
    return (datetime.datetime.now() + datetime.timedelta(minutes=delta_minutes)).strftime("%H:%M")


@pytest.fixture(scope="module", autouse=True)
def app_client():
    import app as app_module
    from core.auth import seed_initial_access_roles
    from utils.database import init_database

    # `app` skips its startup setup under pytest, so build the schema and role templates here (idempotent).
    init_database()
    seed_initial_access_roles()
    app_module.app.config["TESTING"] = True  # skips the CSRF check, as the other API tests do
    return app_module.app


def _login(app, username):
    client = app.test_client()
    res = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert res.status_code == 200, res.get_json()
    return client


def _make_doctor(tag):
    username = f"dr{tag}{uuid.uuid4().hex[:6]}"
    create_admin_doctor(
        {
            "staff_id": f"T-{username}",
            "name": f"Dr. {username}",
            "doctor_name": f"Dr. {username}",
            "department": "General Medicine",
            "specialty": "General Medicine",
            "qualification": "MBBS",
            "section": "Main",
            "room": "1",
            "username": username,
            "password": PASSWORD,
            "roleId": "ROLE_DOCTOR",
            "role_key": "ROLE_DOCTOR",
            "consultationFee": 100,
            "gender": "Male",
        }
    )
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM doctors WHERE username = ?", (username,))
        doctor_id = cur.fetchone()["id"]
        # every weekday, so the test does not depend on which day it runs
        cur.execute(
            "UPDATE doctors SET working_days = ?, weekly_off_days = '[]', schedule_active = TRUE WHERE id = ?",
            ('["' + '","'.join(ALL_DAYS) + '"]', doctor_id),
        )
        conn.commit()
    return username, doctor_id


@pytest.fixture
def admin_client(app_client):
    username = f"adm{uuid.uuid4().hex[:6]}"
    create_admin_user({"username": username, "password": PASSWORD, "name": "Test Admin", "roleId": "ROLE_STAFF"})
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE users SET user_type = 'admin', access_role = 'owner' WHERE username = ?", (username,))
        conn.commit()
    return _login(app_client, username)


def test_doctor_sets_status_and_multiple_slots(app_client):
    username, _ = _make_doctor("a")
    me = _login(app_client, username)

    now_slot = {"start": _hhmm(-30), "end": _hhmm(30)}
    far_slot = {"start": _hhmm(180), "end": _hhmm(240)}

    # main window is far from now, the extra slot covers now -> eligible only because of the extra slot
    res = me.put("/api/doctor-availability/me/schedule", json={"slots": [far_slot, now_slot]})
    assert res.status_code == 200, res.get_json()
    doctor = res.get_json()["doctor"]
    assert [s["start"] for s in doctor["slots"]] == [far_slot["start"], now_slot["start"]]
    assert doctor["is_eligible"] is True and doctor["schedule"]["source"] == "extra_slot"

    # Inactive -> not eligible; Active -> eligible again
    doctor = me.post("/api/doctor-availability/me/status", json={"is_active": False}).get_json()["doctor"]
    assert doctor["is_eligible"] is False and doctor["status"] == "unavailable"
    doctor = me.post("/api/doctor-availability/me/status", json={"is_active": True}).get_json()["doctor"]
    assert doctor["is_eligible"] is True

    # only slots that miss the current time -> off duty
    doctor = me.put("/api/doctor-availability/me/schedule", json={"slots": [far_slot]}).get_json()["doctor"]
    assert doctor["is_eligible"] is False and doctor["status"] == "off_duty"


@pytest.mark.parametrize(
    "slots",
    [
        [{"start": "25:00", "end": "10:00"}],
        [{"start": "10:00", "end": "10:00"}],
        [{"start": "09:00", "end": "10:00"}, {"start": "09:00", "end": "10:00"}],
        [],
    ],
)
def test_bad_slots_are_rejected(app_client, slots):
    username, _ = _make_doctor("b")
    res = _login(app_client, username).put("/api/doctor-availability/me/schedule", json={"slots": slots})
    assert res.status_code == 400


def test_a_doctor_cannot_change_another_doctor(app_client):
    mine, _ = _make_doctor("c")
    _, other_id = _make_doctor("d")
    me = _login(app_client, mine)
    assert me.post(f"/api/doctor-availability/{other_id}/status", json={"is_available": False}).status_code == 403
    assert me.put(f"/api/doctor-availability/{other_id}/schedule", json={"duty_start_time": "01:00", "duty_end_time": "02:00"}).status_code == 403


def test_non_doctor_gets_404_on_me(app_client, admin_client):
    assert admin_client.get("/api/doctor-availability/me").status_code == 404


def test_only_active_doctors_can_be_booked(app_client, admin_client):
    username, _ = _make_doctor("e")
    name = f"Dr. {username}"
    appointment = {
        "patient_name": "Test Patient",
        "visit_type": "OP",
        "appointment_date": datetime.date.today().isoformat(),
        "doctor_name": name,
        "department": "General Medicine",
        "patient_gender": "Male",
        "patient_phone": "9000000000",
        "patient_age": 30,
    }

    # never logged in -> offline -> refused
    res = admin_client.post("/api/appointments", json=appointment)
    assert res.status_code == 409 and "cannot take appointments" in res.get_json()["error"]

    me = _login(app_client, username)
    me.put("/api/doctor-availability/me/schedule", json={"slots": [{"start": _hhmm(-30), "end": _hhmm(30)}]})
    assert admin_client.post("/api/appointments", json=appointment).status_code == 200

    me.post("/api/doctor-availability/me/status", json={"is_active": False})
    assert admin_client.post("/api/appointments", json=appointment).status_code == 409

    eligible = admin_client.get("/api/doctor-availability/eligible?department=General%20Medicine").get_json()
    assert name not in [d["doctor_name"] for d in eligible["eligible_doctors"]]


def test_delete_removes_account_and_frees_username(app_client):
    username, _ = _make_doctor("f")
    uid = [u for u in list_admin_users() if u["username"] == username][0]["id"]

    assert delete_admin_user(uid) is True
    assert username not in [u["username"] for u in list_admin_users()]
    res = app_client.test_client().post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert res.status_code in (401, 403)
    assert delete_admin_user(10**9) is False  # unknown account

    # the username can be used again
    create_admin_user({"username": username, "password": PASSWORD, "name": "Again", "roleId": "ROLE_STAFF"})
    assert username in [u["username"] for u in list_admin_users()]


def test_primary_administrator_cannot_be_deleted():
    username = f"owner{uuid.uuid4().hex[:6]}"
    uid = create_admin_user({"username": username, "password": PASSWORD, "name": "Owner", "roleId": "ROLE_STAFF"})
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE users SET user_type = 'admin' WHERE id = ?", (uid,))
        conn.commit()
    with pytest.raises(PermissionError):
        delete_admin_user(uid)


def test_status_toggle_round_trip():
    username = f"stf{uuid.uuid4().hex[:6]}"
    uid = create_admin_user({"username": username, "password": PASSWORD, "name": "Staff", "roleId": "ROLE_STAFF"})
    status = lambda: [u for u in list_admin_users() if u["username"] == username][0]["status"]
    assert status() == "Active"  # active by default
    assert update_admin_user(uid, {"status": "inactive"})
    assert status() == "Inactive"
    assert update_admin_user(uid, {"status": "active"})
    assert status() == "Active"
