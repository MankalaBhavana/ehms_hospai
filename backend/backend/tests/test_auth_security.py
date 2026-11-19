"""Login and password rules: no default passwords, no account created by logging in, no bypass.

These run without a database: `core.auth.get_connection` is replaced by a fake that serves the rows a test
configures and records every statement, so a test can also prove that nothing was INSERTed.
"""
import hashlib
import os
import sys

import bcrypt
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import core.auth as auth  # noqa: E402


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(4)).decode()


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self._rows = []

    def execute(self, sql, params=()):
        text = " ".join(str(sql).split())
        self.db.log.append(text)
        low = text.lower()
        if low.startswith("select u.id, u.hospital_id"):
            self._rows = list(self.db.users)
        elif low.startswith("select 1 from users"):
            self._rows = [(1,)] if self.db.users else []
        elif "from doctors" in low:
            self._rows = list(self.db.doctors)
        else:
            self._rows = []

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return FakeCursor(self.db)

    def commit(self):
        pass


class FakeDb:
    def __init__(self, users=(), doctors=()):
        self.users = list(users)
        self.doctors = list(doctors)
        self.log = []

    def inserts(self):
        return [q for q in self.log if q.lower().startswith("insert into users")]


@pytest.fixture
def make_db(monkeypatch):
    def _make(users=(), doctors=()):
        db = FakeDb(users, doctors)
        monkeypatch.setattr(auth, "get_connection", lambda: FakeConn(db))
        monkeypatch.setattr(auth, "resolve_hospital_id", lambda *a, **k: 1)
        return db

    return _make


def _user(username="dr.rao", pw_hash=None, **extra):
    row = {
        "id": 7, "hospital_id": 1, "username": username, "password_hash": pw_hash or _hash("Str0ng!Pass"),
        "role": "staff", "role_key": "ROLE_DOCTOR", "access_role": "clinician", "user_type": "normal",
        "module_access": "[]", "job_role": "Doctor", "full_name": "Dr Rao", "email": "rao@h.test", "phone": "",
        "employee_id": "DOC-1", "status": "active", "hospital_code": "H1", "hospital_status": "active",
        "assigned_role_status": "active",
    }
    row.update(extra)
    return row


DOCTOR_ROW = {"id": 3, "doctor_name": "Dr Rao", "department": "General Medicine", "specialty": "GM", "staff_id": "DOC-1",
              "username": "dr.rao", "email": "rao@h.test", "phone": "", "status": "available"}


# 1 ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("typed", ["Doctor@123", "password", "Admin@123", "12345678", "doctor", "DOC-1", "dr.rao"])
def test_doctor_without_login_cannot_sign_in_and_no_account_is_created(make_db, typed):
    db = make_db(users=[], doctors=[DOCTOR_ROW])
    for ident in ("dr.rao", "DOC-1", "Dr Rao", "rao@h.test"):
        assert auth.authenticate(ident, typed) is None
    assert db.inserts() == [], "login must never create a users row"
    assert not any("from doctors" in q.lower() for q in db.log), "login must not even consult the doctors table"


# 2 ------------------------------------------------------------------------------------------------------------
def test_stored_hash_is_not_a_password(make_db):
    stored = _hash("Str0ng!Pass")
    make_db(users=[_user(pw_hash=stored)])
    assert auth.authenticate("dr.rao", stored) is None
    assert auth.verify_password(stored, stored) is False


# 3 ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("typed", ["Doctor@123", "password", "admin", "Admin@123", "12345678", "mock_hash_doctor"])
def test_mock_hash_never_accepts_a_default_password(make_db, typed):
    make_db(users=[_user(pw_hash="mock_hash_doctor")])
    assert auth.authenticate("dr.rao", typed) is None
    assert auth.verify_password(typed, "mock_hash_doctor") is False


# 4 ------------------------------------------------------------------------------------------------------------
def test_wrong_password_never_returns_a_user_but_the_right_one_does(make_db):
    make_db(users=[_user()])
    assert auth.authenticate("dr.rao", "Wrong!Pass1") is None
    assert auth.authenticate("dr.rao", "") is None
    ok = auth.authenticate("dr.rao", "Str0ng!Pass")
    assert ok and ok["username"] == "dr.rao"


def test_wrong_password_with_several_candidates_returns_none(make_db):
    make_db(users=[_user(username="a.rao", id=1), _user(username="b.rao", id=2, pw_hash=_hash("Other!Pass99"))])
    assert auth.authenticate("rao", "Not!Either1") is None


def test_inactive_account_with_right_password_is_refused(make_db):
    make_db(users=[_user(status="inactive")])
    res = auth.authenticate("dr.rao", "Str0ng!Pass")
    assert res and res.get("error")


# 5 ------------------------------------------------------------------------------------------------------------
def test_password_is_checked_exactly_no_trimming(make_db):
    make_db(users=[_user()])
    assert auth.authenticate("dr.rao", " Str0ng!Pass") is None
    assert auth.authenticate("dr.rao", "Str0ng!Pass ") is None
    assert auth.verify_password(" Str0ng!Pass ", _hash("Str0ng!Pass")) is False
    assert auth.verify_password("Str0ng!Pass", _hash("Str0ng!Pass")) is True


def test_only_bcrypt_hashes_verify():
    assert auth.verify_password("secret12", hashlib.sha256(b"secret12").hexdigest()) is False
    assert auth.verify_password("secret12", hashlib.md5(b"secret12").hexdigest()) is False
    assert auth.verify_password("secret12", "secret12") is False
    from werkzeug.security import generate_password_hash
    assert auth.verify_password("secret12", generate_password_hash("secret12")) is False


# 6 ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("pw", ["Doctor@123", "doctor@123", "Admin@123", "12345678", "password123", "Password1"])
def test_known_default_passwords_are_rejected(pw):
    assert auth.validate_password(pw)


def test_password_equal_to_username_staff_id_or_email_is_rejected():
    assert auth.validate_password("dr.rao.rao", "dr.rao.rao")
    assert auth.validate_password("DOC-0042-X", "someone", "doc-0042-x")
    assert auth.validate_password("raodoctor", "x", None, "RaoDoctor@h.test")


def test_other_password_rules():
    assert auth.validate_password("short1!")  # < 8
    assert auth.validate_password(" leading-space1")  # spaces at the ends
    assert auth.validate_password("a" * 73)  # bcrypt only uses 72 bytes
    assert auth.validate_password("Str0ng!Pass", "dr.rao", "DOC-1", "rao@h.test") is None


def test_every_path_that_sets_a_password_uses_the_policy():
    from utils import database as dbmod

    with pytest.raises(ValueError):
        dbmod._check_new_password("Doctor@123")
    with pytest.raises(ValueError):
        dbmod._check_new_password("dr.rao.001", "dr.rao.001")
    dbmod._check_new_password("Str0ng!Pass", "dr.rao")


def test_first_administrator_password_must_not_be_a_default(make_db, monkeypatch):
    db = make_db(users=[])  # no administrator yet
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "Admin@123")
    with pytest.raises(RuntimeError):
        auth.create_default_users()
    assert db.inserts() == []


def test_existing_administrator_is_not_blocked_by_a_weak_env_password(make_db, monkeypatch):
    # the account exists already: a stale weak INITIAL_ADMIN_PASSWORD must not stop the server from starting
    make_db(users=[{"username": "admin"}])
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "Admin@123")
    monkeypatch.setattr(auth, "seed_initial_access_roles", lambda *a, **k: None)
    auth.create_default_users()


def test_no_default_password_text_is_left_in_the_login_code():
    src = open(os.path.join(os.path.dirname(__file__), "..", "core", "auth.py"), encoding="utf-8").read()
    assert src.count("Doctor@123") == 1  # only in the reject list
    assert "bootstrap user" not in src and "ordered[0]" not in src


def test_audit_trail_never_stores_a_password():
    from shared.audit import redact_secrets

    out = redact_secrets({"username": "dr.rao", "password": "Str0ng!Pass", "nested": {"new_password": "x", "token": "t", "name": "n"}, "rows": [{"password": "p"}]})
    assert out["username"] == "dr.rao" and out["nested"]["name"] == "n"
    assert out["password"] == "[redacted]" and out["nested"]["new_password"] == "[redacted]" and out["nested"]["token"] == "[redacted]"
    assert out["rows"][0]["password"] == "[redacted]"
    assert "Str0ng!Pass" not in str(out)
