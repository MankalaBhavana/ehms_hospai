"""SmartRx HTTP API. Thin by design: authentication, validation, serialization.

All safety logic lives in engine.py / allergy.py / resolver.py and is deterministic.
"""
import hashlib
import json
import logging
import re

import psycopg2
from flask import Blueprint, g, jsonify, request

from core.limiter import limiter
from shared.hospital import current_hospital_id
from shared.session_auth import require_permissions
from utils.database import get_connection

from . import allergy as allergy_mod
from . import context as context_mod
from . import engine
from .config import ENGINE_VERSION
from .knowledge import KnowledgeUnavailable, get_knowledge
from .schemas import ValidationError, validate_allergy, validate_evaluate, validate_override

logger = logging.getLogger(__name__)
smartrx_bp = Blueprint("smartrx", __name__)


def _unavailable(exc):
    logger.error("SmartRx knowledge unavailable: %s", exc)
    # Never a silent pass: callers must show that safety checks did not run.
    return jsonify({"status": "engine_unavailable", "check_status": "not_run",
                    "error": "SmartRx safety checks are unavailable right now. Verify the prescription manually.",
                    "alerts": []}), 503


def _bad_request(exc):
    return jsonify({"status": "invalid_request", "error": str(exc), "field": getattr(exc, "field", None)}), 400


def _knowledge_integrity(cur):
    """How much of the loaded clinical knowledge is actually sourced. `active_*` is what prescribers can see."""
    tables = {"clinical_rules": "clinical_rules", "interactions": "drug_interaction", "dose_limits": "dose_limit",
              "reproductive_risk": "reproductive_risk", "cross_reactivity": "cross_reactivity", "antibiotic_policy": "antibiotic_policy"}
    out = {}
    for label, table in tables.items():
        cur.execute(f"SELECT provenance, status, COUNT(*) FROM smartrx.{table} GROUP BY 1, 2")
        counts = {}
        for prov, status, n in cur.fetchall():
            counts.setdefault(prov, {})[status] = n
        out[label] = counts
    cur.execute("SELECT COUNT(*) FROM smartrx.drug_class WHERE status = 'approved' AND provenance = 'unsourced'")
    out["active_unsourced_drug_classes"] = cur.fetchone()[0]
    out["unverified_but_active"] = sum(n for t, c in out.items() if isinstance(c, dict)
                                       for prov, st in c.items() if prov == "cited" for status, n in st.items() if status == "approved")
    out["verified_active"] = sum(n for t, c in out.items() if isinstance(c, dict)
                                 for prov, st in c.items() if prov == "verified" for status, n in st.items() if status == "approved")
    return out


@smartrx_bp.route("/api/smartrx/health", methods=["GET"])
@require_permissions("patients.read")
def smartrx_health():
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        try:
            kb = get_knowledge(cur)
            cur.execute("SELECT version FROM smartrx.schema_migrations ORDER BY version DESC LIMIT 1")
            schema = (cur.fetchone() or [None])[0]
            cur.execute("SELECT COUNT(*) FROM smartrx.medication_catalog_items")
            brands = cur.fetchone()[0]
            integrity = _knowledge_integrity(cur)
        except (KnowledgeUnavailable, psycopg2.Error) as exc:
            return _unavailable(exc)
    return jsonify({"status": "ok", "engine_version": ENGINE_VERSION, "rule_set_version": kb.version,
                    "schema_version": schema, "brands": brands, "rules": len(kb.rules), "classes": len(kb.classes),
                    "knowledge_integrity": integrity})


@smartrx_bp.route("/api/smartrx/catalog/search", methods=["GET"])
@require_permissions("patients.read")
@limiter.limit("240 per minute")
def catalog_search():
    """Typeahead over the brand catalogue (full-text prefix search on a GIN index)."""
    query = (request.args.get("q") or "").strip()[:80]
    try:
        limit = max(1, min(int(request.args.get("limit", 15)), 50))
    except ValueError:
        return _bad_request(ValidationError("limit must be a number", "limit"))
    clean = re.sub(r"[^\w\s]", " ", query).strip()
    if len(clean) < 2:
        return jsonify({"items": [], "count": 0})

    words = clean.split()
    ts_query = " & ".join(w + ":*" for w in words)
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT id, brand_name, generic_name, moiety_identifiers, dose_form, route, nlem_level, is_high_alert, route_hint
                FROM smartrx.medication_catalog_items
                WHERE to_tsvector('simple', brand_name || ' ' || COALESCE(generic_name, '')) @@ to_tsquery('simple', %s)
                ORDER BY (LOWER(brand_name) LIKE LOWER(%s)) DESC, LENGTH(brand_name), id
                LIMIT %s""", (ts_query, clean + "%", limit))
            rows = cur.fetchall()
        except psycopg2.errors.UndefinedTable as exc:
            return _unavailable(exc)
    items = [{"id": str(r[0]), "brand_name": r[1], "generic_name": r[2] or "", "substance_identifiers": r[3] or "",
              "dose_form": r[4] or "", "route": r[5] or "", "nlem_level": r[6], "is_high_alert": bool(r[7]),
              "route_hint": r[8]} for r in rows]
    return jsonify({"items": items, "count": len(items)})


@smartrx_bp.route("/api/smartrx/evaluate", methods=["POST"])
@require_permissions("patients.read")
@limiter.limit("120 per minute")
def evaluate_prescription():
    """Deterministic safety evaluation of a prescription (see engine.py). Never blocks signing."""
    try:
        payload = validate_evaluate(request.get_json(silent=True))
    except ValidationError as exc:
        return _bad_request(exc)

    hospital_id = current_hospital_id()
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        try:
            kb = get_knowledge(cur)
            ctx = context_mod.build(cur, kb, payload, hospital_id)
            result = engine.evaluate(cur, kb, ctx, payload["items"], hospital_id)
        except (KnowledgeUnavailable, psycopg2.errors.UndefinedTable) as exc:
            return _unavailable(exc)
        except psycopg2.Error as exc:
            logger.exception("SmartRx evaluation failed")
            return _unavailable(exc)
    result["status"] = "ok"
    result["patient_id"] = payload["patient_id"]
    _log_evaluation(hospital_id, payload, result)
    return jsonify(result)


def _log_evaluation(hospital_id, payload, result):
    """Audit trail of what was shown. Best effort: a logging failure must never hide the safety result."""
    try:
        user = getattr(g, "current_user", None) or {}
        digest = hashlib.sha256(json.dumps({"p": payload.get("patient_id"), "i": payload.get("items")}, sort_keys=True).encode()).hexdigest()
        alerts = [{"id": a["id"], "check": a["check"], "severity": a["severity"], "drug_name": a.get("drug_name"),
                   "provenance": a.get("provenance"), "source_ref": a.get("source_ref")} for a in result.get("alerts", [])]
        with get_connection(autocommit=True) as conn:
            conn.cursor().execute(
                """INSERT INTO smartrx.evaluation_log (hospital_id, user_id, patient_id, encounter_id, rule_set_version, engine_version,
                       check_status, item_count, alert_count, critical_count, warning_count, alerts, input_sha256)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)""",
                (hospital_id, str(user.get("username") or user.get("id") or ""), payload.get("patient_id"), payload.get("encounter_id"),
                 result.get("rule_set_version"), result.get("engine_version"), result.get("check_status"), result.get("evaluated_count", 0),
                 len(alerts), sum(a["severity"] == "critical" for a in alerts), sum(a["severity"] == "warning" for a in alerts),
                 json.dumps(alerts), digest))
    except Exception:  # noqa: BLE001
        logger.warning("SmartRx evaluation log write failed", exc_info=True)


@smartrx_bp.route("/api/smartrx/overrides", methods=["POST"])
@require_permissions("patients.read")
def record_override():
    """A prescriber acknowledges a critical alert with a reason. Audit only: it never changes what the engine reports."""
    try:
        data = validate_override(request.get_json(silent=True))
    except ValidationError as exc:
        return _bad_request(exc)
    hospital_id = current_hospital_id()
    user = g.current_user
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO smartrx.alert_override (hospital_id, user_id, user_name, patient_id, encounter_id, alert_id, check_name,
                           severity, drug_name, rule_set_version, reason_code, reason_text)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id, created_at""",
                    (hospital_id, str(user.get("id") or ""), str(user.get("username") or user.get("name") or ""), data["patient_id"],
                     data["encounter_id"], data["alert_id"], data["check"], data["severity"], data["drug_name"], data["rule_set_version"],
                     data["reason_code"], data["reason_text"]))
        row_id, created = cur.fetchone()
        conn.commit()
    return jsonify({"id": row_id, "created_at": created.isoformat(), **{k: data[k] for k in ("alert_id", "reason_code")}}), 201


@smartrx_bp.route("/api/smartrx/overrides", methods=["GET"])
@require_permissions("patients.read")
def list_overrides():
    """Acknowledgements already given for a patient (and optionally one encounter), so the screen can restore them after a reload."""
    patient_id = (request.args.get("patient_id") or "").strip()[:60]
    if not patient_id:
        return _bad_request(ValidationError("patient_id is required", "patient_id"))
    encounter_id = (request.args.get("encounter_id") or "").strip()[:60] or None
    hospital_id = current_hospital_id()
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("""SELECT id, created_at, alert_id, severity, drug_name, reason_code, reason_text, user_name
                       FROM smartrx.alert_override
                       WHERE COALESCE(hospital_id,0) = COALESCE(%s,0) AND patient_id = %s AND (%s::text IS NULL OR encounter_id = %s)
                       ORDER BY id DESC LIMIT 200""", (hospital_id, patient_id, encounter_id, encounter_id))
        items = [{"id": r[0], "created_at": r[1].isoformat(), "alert_id": r[2], "severity": r[3], "drug_name": r[4],
                  "reason_code": r[5], "reason_text": r[6], "by": r[7]} for r in cur.fetchall()]
    return jsonify({"items": items})


# ---- structured allergies -------------------------------------------------------------------------------

def _patient_in_hospital(cur, patient_id, hospital_id):
    cur.execute("SELECT 1 FROM patients WHERE patient_id = %s AND hospital_id = %s", (str(patient_id), hospital_id))
    return cur.fetchone() is not None


def _entry_json(row):
    return {"id": row[0], "kind": row[1], "code": row[2], "text": row[3], "reaction": row[4],
            "severity": row[5], "source": row[6]}


@smartrx_bp.route("/api/smartrx/patients/<patient_id>/allergies", methods=["GET"])
@require_permissions("patients.read")
def list_allergies(patient_id):
    hospital_id = current_hospital_id()
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        if not _patient_in_hospital(cur, patient_id, hospital_id):
            return jsonify({"error": "Patient not found"}), 404
        cur.execute("""SELECT id, allergen_kind, allergen_code, allergen_text, reaction, severity, source
                       FROM smartrx.patient_allergy
                       WHERE COALESCE(hospital_id,0)=COALESCE(%s,0) AND patient_id=%s AND status='active' ORDER BY id""",
                    (hospital_id, patient_id))
        return jsonify({"items": [_entry_json(r) for r in cur.fetchall()]})


@smartrx_bp.route("/api/smartrx/patients/<patient_id>/allergies", methods=["POST"])
@require_permissions("patients.clinical.write")
def add_allergy(patient_id):
    """Add one allergen. Free text is resolved to a drug or class; unresolved text is stored as 'unmapped'."""
    try:
        data = validate_allergy(request.get_json(silent=True))
    except ValidationError as exc:
        return _bad_request(exc)
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        if not _patient_in_hospital(cur, patient_id, hospital_id):
            return jsonify({"error": "Patient not found"}), 404
        try:
            kb = get_knowledge(cur)
        except KnowledgeUnavailable as exc:
            return _unavailable(exc)
        entry = allergy_mod.resolve_allergen(data["text"], kb)
        entry.text, entry.reaction, entry.severity, entry.source = data["text"], data["reaction"], data["severity"], "manual"
        row_id = allergy_mod.save_entry(cur, hospital_id, patient_id, entry, recorded_by=str(g.current_user.get("username") or g.current_user.get("id")))
        conn.commit()
    return jsonify({"id": row_id, **entry.as_dict(), "matched": entry.kind != "unmapped"}), 201


@smartrx_bp.route("/api/smartrx/patients/<patient_id>/allergies/<int:allergy_id>", methods=["DELETE"])
@require_permissions("patients.clinical.write")
def remove_allergy(patient_id, allergy_id):
    """Soft-remove (kept for audit): marks the row entered_in_error."""
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE smartrx.patient_allergy SET status='entered_in_error', updated_at=NOW()
                       WHERE id=%s AND patient_id=%s AND COALESCE(hospital_id,0)=COALESCE(%s,0) AND status='active'""",
                    (allergy_id, patient_id, hospital_id))
        changed = cur.rowcount
        conn.commit()
    return (jsonify({"removed": True}), 200) if changed else (jsonify({"error": "Allergy not found"}), 404)


@smartrx_bp.route("/api/smartrx/patients/<patient_id>/allergies/import-legacy", methods=["POST"])
@require_permissions("patients.clinical.write")
def import_legacy_allergies(patient_id):
    """Convert the patient's free-text allergy fields into structured rows. Unrecognised text is kept as 'unmapped'
    so a clinician can review it; nothing is dropped."""
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT allergies FROM patients WHERE patient_id=%s AND hospital_id=%s", (patient_id, hospital_id))
        row = cur.fetchone()
        if row is None:
            return jsonify({"error": "Patient not found"}), 404
        texts = [row[0]] if row[0] else []
        try:
            cur.execute("SELECT allergies FROM medical_history WHERE patient_id=%s ORDER BY id DESC LIMIT 1", (patient_id,))
            mh = cur.fetchone()
            if mh and mh[0]:
                texts.append(mh[0])
        except psycopg2.Error:
            conn.rollback()
        try:
            kb = get_knowledge(cur)
        except KnowledgeUnavailable as exc:
            return _unavailable(exc)
        saved, none_known = [], False
        for t in texts:
            entries, nk = allergy_mod.parse_free_text(t, kb)
            none_known = none_known or nk
            for e in entries:
                e.source = "legacy_import"
                saved.append({"id": allergy_mod.save_entry(cur, hospital_id, patient_id, e, recorded_by="legacy_import"), **e.as_dict()})
        conn.commit()
    return jsonify({"imported": saved, "no_known_allergy": none_known,
                    "needs_review": [s["text"] for s in saved if s["kind"] == "unmapped"]})


# ---- hospital formulary and antibiotic policy (runtime data, per hospital) ------------------------------------

def _resolve_drug(cur, drug):
    kb = get_knowledge(cur)
    moiety = kb.moiety_for_name(str(drug or "").strip().lower())
    return kb, moiety


@smartrx_bp.route("/api/smartrx/hospital/formulary", methods=["GET"])
@require_permissions("patients.read")
def list_formulary():
    hospital_id = current_hospital_id()
    with get_connection(autocommit=True) as conn:
        cur = conn.cursor()
        try:
            kb = get_knowledge(cur)
        except KnowledgeUnavailable as exc:
            return _unavailable(exc)
        cur.execute("""SELECT id, moiety_identifier, status, note, alternative FROM smartrx.hospital_formulary
                       WHERE hospital_id = %s ORDER BY id""", (hospital_id,))
        return jsonify({"items": [{"id": r[0], "drug": kb.moiety_label(r[1]), "status": r[2], "note": r[3], "alternative": r[4]}
                                  for r in cur.fetchall()]})


@smartrx_bp.route("/api/smartrx/hospital/formulary", methods=["PUT"])
@require_permissions("pharmacy.inventory.write")
def set_formulary():
    """Set a drug's formulary status for the caller's hospital: formulary | restricted | non_formulary."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get("status") not in ("formulary", "restricted", "non_formulary"):
        return _bad_request(ValidationError("status must be formulary, restricted or non_formulary", "status"))
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        try:
            kb, moiety = _resolve_drug(cur, data.get("drug"))
        except KnowledgeUnavailable as exc:
            return _unavailable(exc)
        if not moiety:
            return _bad_request(ValidationError("drug not recognised; use the generic (active ingredient) name", "drug"))
        cur.execute("""INSERT INTO smartrx.hospital_formulary (hospital_id, moiety_identifier, status, note, alternative, updated_by)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (hospital_id, moiety_identifier) DO UPDATE
                         SET status = EXCLUDED.status, note = EXCLUDED.note, alternative = EXCLUDED.alternative,
                             updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING id""",
                    (hospital_id, moiety, data["status"], (data.get("note") or "")[:500] or None,
                     (data.get("alternative") or "")[:300] or None, str(g.current_user.get("username") or "")))
        row_id = cur.fetchone()[0]
        conn.commit()
    return jsonify({"id": row_id, "drug": kb.moiety_label(moiety), "status": data["status"]})


@smartrx_bp.route("/api/smartrx/hospital/formulary/<int:row_id>", methods=["DELETE"])
@require_permissions("pharmacy.inventory.write")
def delete_formulary(row_id):
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM smartrx.hospital_formulary WHERE id = %s AND hospital_id = %s", (row_id, hospital_id))
        changed = cur.rowcount
        conn.commit()
    return (jsonify({"removed": True}), 200) if changed else (jsonify({"error": "Not found"}), 404)


@smartrx_bp.route("/api/smartrx/hospital/antibiotic-policy", methods=["PUT"])
@require_permissions("pharmacy.inventory.write")
def set_antibiotic_policy():
    """Override an antibiotic's stewardship tier for the caller's hospital (tier: access | watch | reserve | unrestricted)."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get("tier") not in ("access", "watch", "reserve", "unrestricted"):
        return _bad_request(ValidationError("tier must be access, watch, reserve or unrestricted", "tier"))
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cur = conn.cursor()
        try:
            kb, moiety = _resolve_drug(cur, data.get("drug"))
        except KnowledgeUnavailable as exc:
            return _unavailable(exc)
        if not moiety:
            return _bad_request(ValidationError("drug not recognised; use the generic (active ingredient) name", "drug"))
        cur.execute("""INSERT INTO smartrx.antibiotic_policy (hospital_id, moiety_identifier, tier, restricted_to,
                           requires_justification, message, source, status, provenance, updated_by)
                       VALUES (%s,%s,%s,%s,%s,%s,'Hospital antibiotic policy','approved','hospital_policy',%s)
                       ON CONFLICT (COALESCE(hospital_id, 0), moiety_identifier) DO UPDATE
                         SET tier = EXCLUDED.tier, restricted_to = EXCLUDED.restricted_to,
                             requires_justification = EXCLUDED.requires_justification, message = EXCLUDED.message,
                             status = 'approved', updated_by = EXCLUDED.updated_by, updated_at = NOW()""",
                    (hospital_id, moiety, data["tier"], (data.get("restricted_to") or "")[:300] or None,
                     bool(data.get("requires_justification", True)), (data.get("message") or "")[:500] or None,
                     str(g.current_user.get("username") or "")))
        conn.commit()
    return jsonify({"drug": kb.moiety_label(moiety), "tier": data["tier"]})
