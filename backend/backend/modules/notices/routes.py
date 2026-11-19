"""Transfer notices: when a patient is moved to another department, that department is told, on its
own screen, with a link to the patient. Shared through the server so the receiving desk (a different
computer) sees it. Every notice records who raised it, who has seen it and who has handled (processed) it: a department
clears a notice with "Done" once the patient has been processed there, and everyone sees it cleared."""
import json

from flask import Blueprint, g, jsonify, request

from shared.audit import log_audit_event
from shared.hospital import current_hospital_id
from shared.session_auth import require_session
from utils.database import get_connection

notices_bp = Blueprint("notices", __name__)
_ready = False
RETENTION_DAYS = 3  # handled notices
PENDING_RETENTION_DAYS = 14  # a patient still waiting is not forgotten after three days


def _ensure_table():
    global _ready
    if _ready:
        return
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS transfer_notices (
                id BIGSERIAL PRIMARY KEY,
                hospital_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                patient_id TEXT,
                patient_name TEXT NOT NULL,
                from_dept TEXT,
                to_dept TEXT NOT NULL,
                to_module TEXT NOT NULL,
                note TEXT,
                ref TEXT,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                seen_by JSONB NOT NULL DEFAULT '[]'::jsonb
            )
            """
        )
        cur.execute("ALTER TABLE transfer_notices ADD COLUMN IF NOT EXISTS audience TEXT")
        cur.execute("ALTER TABLE transfer_notices ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Normal'")
        cur.execute("ALTER TABLE transfer_notices ADD COLUMN IF NOT EXISTS handled_by TEXT")
        cur.execute("ALTER TABLE transfer_notices ADD COLUMN IF NOT EXISTS handled_at TIMESTAMP")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_transfer_notices_recent ON transfer_notices (hospital_id, created_at DESC)")
        conn.commit()
    _ready = True


def _user():
    return (getattr(g, "current_user", None) or {}).get("username") or ""


def _out(r, me):
    d = dict(r)
    seen = d["seen_by"] if isinstance(d["seen_by"], list) else json.loads(d["seen_by"] or "[]")
    return {
        "id": d["id"],
        "kind": d["kind"],
        "patientId": d["patient_id"],
        "patientName": d["patient_name"],
        "from": d["from_dept"],
        "to": d["to_dept"],
        "toModule": d["to_module"],
        "note": d["note"],
        "ref": d["ref"],
        "by": d["created_by"],
        "priority": d.get("priority") or "Normal",
        "audience": d.get("audience"),
        "handled": bool(d.get("handled_at")),
        "handledBy": d.get("handled_by"),
        "handledAt": d["handled_at"].isoformat() if d.get("handled_at") else None,
        "at": d["created_at"].isoformat() if d.get("created_at") else None,
        "seen": me in seen,
    }


@notices_bp.get("/api/notices/transfers")
@require_session
def transfers_list():
    _ensure_table()
    me = _user()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM transfer_notices
               WHERE hospital_id = ?
                 AND ((handled_at IS NULL AND created_at >= NOW() - INTERVAL '%d days')
                      OR created_at >= NOW() - INTERVAL '%d days')
               ORDER BY created_at DESC LIMIT 300""" % (PENDING_RETENTION_DAYS, RETENTION_DAYS),
            (current_hospital_id(),),
        )
        rows = cur.fetchall()
    return jsonify({"notices": [_out(r, me) for r in rows]})


@notices_bp.post("/api/notices/transfers")
@require_session
def transfers_create():
    _ensure_table()
    body = request.get_json(force=True, silent=True) or {}
    name = str(body.get("patientName") or "").strip()
    to_dept = str(body.get("to") or "").strip()
    to_module = str(body.get("toModule") or "").strip()
    if not name or not to_dept or not to_module:
        return jsonify({"error": "patientName, to and toModule are required"}), 400
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        # The same move raised twice (double click, two screens) is one notice; so is the same piece of work
        # (a lab order, an encounter ...) announced twice to the same department while it is still waiting.
        ref = str(body.get("ref") or "").strip()
        if ref:
            cur.execute(
                """SELECT id FROM transfer_notices
                   WHERE hospital_id = ? AND ref = ? AND to_module = ? AND kind = ? AND handled_at IS NULL LIMIT 1""",
                (hospital_id, ref, to_module, str(body.get("kind") or "Transfer")),
            )
        else:
            cur.execute(
                """SELECT id FROM transfer_notices
                   WHERE hospital_id = ? AND patient_name = ? AND to_dept = ? AND COALESCE(from_dept, '') = ?
                     AND created_at >= NOW() - INTERVAL '2 minutes' LIMIT 1""",
                (hospital_id, name, to_dept, str(body.get("from") or "")),
            )
        dup = cur.fetchone()
        if dup:
            return jsonify({"id": dup[0], "duplicate": True})
        cur.execute(
            """INSERT INTO transfer_notices (hospital_id, kind, patient_id, patient_name, from_dept, to_dept, to_module, note, ref, created_by, priority, audience)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            (hospital_id, str(body.get("kind") or "Transfer")[:60], body.get("patientId"), name[:200], body.get("from"), to_dept[:200],
             to_module[:60], str(body.get("note") or "")[:500] or None, ref or None, _user(),
             "Urgent" if str(body.get("priority") or "").lower() in ("urgent", "stat", "emergency") else "Normal",
             (str(body.get("audience") or "").strip()[:120] or None)),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
    log_audit_event("create", "transfer_notices", str(new_id), {"patient": name, "to": to_dept})
    return jsonify({"id": new_id}), 201


@notices_bp.post("/api/notices/transfers/<int:notice_id>/seen")
@require_session
def transfers_seen(notice_id):
    _ensure_table()
    me = _user()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE transfer_notices SET seen_by = seen_by || ?::jsonb
               WHERE id = ? AND hospital_id = ? AND NOT (seen_by @> ?::jsonb)""",
            (json.dumps([me]), notice_id, current_hospital_id(), json.dumps([me])),
        )
        conn.commit()
    return jsonify({"ok": True})


@notices_bp.post("/api/notices/transfers/<int:notice_id>/handled")
@require_session
def transfers_handled(notice_id):
    """The receiving department has processed the patient: the notice is cleared for everyone."""
    _ensure_table()
    me = _user()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE transfer_notices SET handled_by = ?, handled_at = NOW()
               WHERE id = ? AND hospital_id = ? AND handled_at IS NULL""",
            (me, notice_id, current_hospital_id()),
        )
        conn.commit()
    log_audit_event("update", "transfer_notices", str(notice_id), {"handled_by": me})
    return jsonify({"ok": True})
