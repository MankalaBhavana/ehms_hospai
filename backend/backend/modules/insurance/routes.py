"""Insurance service: cases, policies, insurers/TPAs, packages and document rules.

Every record is tenant-scoped (hospital_id), versioned (optimistic concurrency, so two
desks editing one claim cannot silently overwrite each other) and every write appends to
insurance_audit_logs. Submitted claims are never edited silently: each change is a new
version with who/when/what recorded.
"""
import json

from flask import Blueprint, g, jsonify, request

from shared.audit import log_audit_event
from shared.hospital import current_hospital_id
from shared.session_auth import require_permissions
from utils.database import get_connection

insurance_bp = Blueprint("insurance", __name__)

# collection -> what it holds. Anything else is rejected, so a URL can never name a table.
COLLECTIONS = {
    "cases": "Insurance cases (claims, pre-auths, settlements)",
    "insurers": "Insurance companies",
    "tpas": "TPAs",
    "networks": "Network hospital configuration",
    "policies": "Policy master",
    "patient_policies": "Patient policy mapping",
    "packages": "Packages and insurer tariffs",
    "document_rules": "Claim document requirements",
    "pricing_rules": "Pricing rule sets",
    "fixed_package_bills": "Fixed package bills",
}

_ready = False


def ensure_tables():
    global _ready
    if _ready:
        return
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS insurance_records (
                id BIGSERIAL PRIMARY KEY,
                hospital_id INTEGER NOT NULL,
                collection TEXT NOT NULL,
                rec_id TEXT NOT NULL,
                doc JSONB NOT NULL,
                patient_id TEXT,
                encounter_id TEXT,
                status TEXT,
                claim_type TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT,
                deleted_at TIMESTAMP,
                UNIQUE (hospital_id, collection, rec_id)
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ins_rec_lookup ON insurance_records (hospital_id, collection, deleted_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ins_rec_patient ON insurance_records (hospital_id, patient_id)")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS insurance_audit_logs (
                id BIGSERIAL PRIMARY KEY,
                hospital_id INTEGER NOT NULL,
                collection TEXT NOT NULL,
                rec_id TEXT NOT NULL,
                version INTEGER,
                action TEXT NOT NULL,
                actor TEXT,
                detail JSONB,
                at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ins_audit_rec ON insurance_audit_logs (hospital_id, collection, rec_id)")
        conn.commit()
    _ready = True


def _known(name):
    return name in COLLECTIONS


def _actor():
    return (getattr(g, "current_user", None) or {}).get("username")


def _row(r):
    d = dict(r)
    doc = d["doc"] if isinstance(d["doc"], dict) else json.loads(d["doc"])
    doc["_version"] = d["version"]
    return doc


@insurance_bp.get("/api/insurance/snapshot")
@require_permissions("billing.read")
def ins_snapshot():
    """Everything the desk needs in ONE request. The client sends the etag it last received;
    if nothing was created, changed or deleted since, the reply is a few bytes (unchanged)."""
    ensure_tables()
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT COUNT(*), COALESCE(SUM(version), 0), COALESCE(MAX(updated_at)::text, ''),
                      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)
               FROM insurance_records WHERE hospital_id = ?""",
            (hospital_id,),
        )
        total, versions, last, deleted = cur.fetchone()
        etag = "%s:%s:%s:%s" % (total, versions, last, deleted)
        if request.args.get("etag") == etag:
            return jsonify({"unchanged": True, "etag": etag})
        cur.execute(
            "SELECT collection, rec_id, doc, version FROM insurance_records WHERE hospital_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
            (hospital_id,),
        )
        rows = cur.fetchall()
    out = {name: [] for name in COLLECTIONS}
    for r in rows:
        d = dict(r)
        if d["collection"] in out:
            doc = d["doc"] if isinstance(d["doc"], dict) else json.loads(d["doc"])
            doc["_version"] = d["version"]
            out[d["collection"]].append(doc)
    return jsonify({"unchanged": False, "etag": etag, "collections": out})


@insurance_bp.get("/api/insurance/<collection>")
@require_permissions("billing.read")
def ins_list(collection):
    if not _known(collection):
        return jsonify({"error": "unknown collection"}), 404
    ensure_tables()
    since = request.args.get("since")
    clauses = ["hospital_id = ?", "collection = ?", "deleted_at IS NULL"]
    params = [current_hospital_id(), collection]
    if since:
        clauses.append("updated_at > ?")
        params.append(since)
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT rec_id, doc, version, updated_at FROM insurance_records WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC",
            tuple(params),
        )
        rows = cur.fetchall()
    return jsonify({"records": [_row(r) for r in rows], "count": len(rows)})


@insurance_bp.get("/api/insurance/<collection>/<rec_id>")
@require_permissions("billing.read")
def ins_get(collection, rec_id):
    if not _known(collection):
        return jsonify({"error": "unknown collection"}), 404
    ensure_tables()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT rec_id, doc, version FROM insurance_records WHERE hospital_id = ? AND collection = ? AND rec_id = ? AND deleted_at IS NULL",
            (current_hospital_id(), collection, rec_id),
        )
        r = cur.fetchone()
    if not r:
        return jsonify({"error": "not found"}), 404
    return jsonify(_row(r))


@insurance_bp.put("/api/insurance/<collection>/<rec_id>")
@require_permissions("billing.claims.write")
def ins_put(collection, rec_id):
    """Create or update. The caller sends the version it last saw as _version; if the
    stored record has moved on, the answer is 409 with the current copy (no silent overwrite)."""
    if not _known(collection):
        return jsonify({"error": "unknown collection"}), 404
    ensure_tables()
    doc = request.get_json(force=True, silent=True) or {}
    if not isinstance(doc, dict):
        return jsonify({"error": "body must be a JSON object"}), 400
    base_version = doc.pop("_version", None)
    doc["id"] = rec_id
    hospital_id = current_hospital_id()
    actor = _actor()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT version, doc FROM insurance_records WHERE hospital_id = ? AND collection = ? AND rec_id = ? FOR UPDATE",
            (hospital_id, collection, rec_id),
        )
        existing = cur.fetchone()
        if existing:
            current_version = existing[0]
            if base_version is not None and int(base_version) != int(current_version):
                stored = existing[1] if isinstance(existing[1], dict) else json.loads(existing[1])
                stored["_version"] = current_version
                return jsonify({"error": "version conflict", "current": stored}), 409
            new_version = current_version + 1
            cur.execute(
                """UPDATE insurance_records
                   SET doc = ?::jsonb, version = ?, status = ?, patient_id = ?, encounter_id = ?, claim_type = ?,
                       updated_at = CURRENT_TIMESTAMP, updated_by = ?, deleted_at = NULL
                   WHERE hospital_id = ? AND collection = ? AND rec_id = ?""",
                (json.dumps(doc), new_version, doc.get("status"), doc.get("patientId"), doc.get("encounterId"),
                 doc.get("claimType"), actor, hospital_id, collection, rec_id),
            )
            action = "update"
        else:
            new_version = 1
            cur.execute(
                """INSERT INTO insurance_records
                   (hospital_id, collection, rec_id, doc, patient_id, encounter_id, status, claim_type, version, updated_by)
                   VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?, 1, ?)""",
                (hospital_id, collection, rec_id, json.dumps(doc), doc.get("patientId"), doc.get("encounterId"),
                 doc.get("status"), doc.get("claimType"), actor),
            )
            action = "create"
        cur.execute(
            "INSERT INTO insurance_audit_logs (hospital_id, collection, rec_id, version, action, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)",
            (hospital_id, collection, rec_id, new_version, action, actor,
             json.dumps({"status": doc.get("status"), "claimType": doc.get("claimType")})),
        )
        conn.commit()
    log_audit_event(action, f"insurance_{collection}", rec_id, {"version": new_version})
    doc["_version"] = new_version
    return jsonify(doc), (201 if action == "create" else 200)


@insurance_bp.delete("/api/insurance/<collection>/<rec_id>")
@require_permissions("billing.claims.write")
def ins_delete(collection, rec_id):
    """Soft delete. Cases are never deleted (they close); only master data can be removed."""
    if not _known(collection):
        return jsonify({"error": "unknown collection"}), 404
    if collection == "cases":
        return jsonify({"error": "insurance cases cannot be deleted; close the claim instead"}), 409
    ensure_tables()
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE insurance_records SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE hospital_id = ? AND collection = ? AND rec_id = ? AND deleted_at IS NULL",
            (_actor(), hospital_id, collection, rec_id),
        )
        if not cur.rowcount:
            return jsonify({"error": "not found"}), 404
        cur.execute(
            "INSERT INTO insurance_audit_logs (hospital_id, collection, rec_id, action, actor) VALUES (?, ?, ?, 'delete', ?)",
            (hospital_id, collection, rec_id, _actor()),
        )
        conn.commit()
    log_audit_event("delete", f"insurance_{collection}", rec_id, {})
    return jsonify({"ok": True})


@insurance_bp.get("/api/insurance/audit/<collection>/<rec_id>")
@require_permissions("billing.read")
def ins_audit(collection, rec_id):
    if not _known(collection):
        return jsonify({"error": "unknown collection"}), 404
    ensure_tables()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT version, action, actor, detail, at FROM insurance_audit_logs WHERE hospital_id = ? AND collection = ? AND rec_id = ? ORDER BY id DESC LIMIT 500",
            (current_hospital_id(), collection, rec_id),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["at"] = r["at"].isoformat() if r.get("at") else None
    return jsonify({"audit": rows})


from modules.insurance.mail import register_mail_routes  # noqa: E402

register_mail_routes(insurance_bp)
