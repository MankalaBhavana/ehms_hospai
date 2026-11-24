"""Doctor Availability & Assignment API Endpoints.

Provides administrative visibility, real-time status monitoring, manual availability controls,
duty schedule updates, unassigned queue processing, and notification handling.
"""

from __future__ import annotations

import json
import re
from flask import Blueprint, g, jsonify, request

from shared.session_auth import require_session, require_permissions
from shared.hospital import current_hospital_id
from shared.audit import log_audit_event
from shared.responses import validate_required_fields

from services.doctor_availability_service import (
    EXTRA_SLOTS_KEY,
    get_all_doctor_availabilities,
    get_doctor_availability,
    get_eligible_doctors_for_department,
    is_doctor_eligible_for_assignment,
    set_doctor_manual_availability,
    update_doctor_schedule_config,
    get_doctor_record,
    get_departments_availability_summary,
    get_unassigned_queue,
    assign_patient_to_doctor_atomic,
    create_availability_notification,
)
from utils.database import get_connection, _to_sql_params

doctor_availability_bp = Blueprint("doctor_availability", __name__)


_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _is_admin_user() -> bool:
    user = getattr(g, "current_user", None) or {}
    return (
        str(user.get("user_type") or "").lower() == "admin"
        or str(user.get("access_role") or "").lower() == "owner"
        or "ADMIN" in str(user.get("role_key") or "").upper()
    )


def _my_doctor_record():
    """The doctors-table row that belongs to the signed-in user (matched by username)."""
    user = getattr(g, "current_user", None) or {}
    username = str(user.get("username") or "").strip()
    if not username:
        return None
    return get_doctor_record(username, hospital_id=current_hospital_id())


def _may_manage_doctor(doctor_id: int) -> bool:
    """Administrators manage any doctor; a doctor manages only their own record."""
    if _is_admin_user():
        return True
    mine = _my_doctor_record()
    return bool(mine and int(mine["id"]) == int(doctor_id))


def _slots_of(record) -> list:
    """All daily time slots of a doctor: the main window first, then any extra slots."""
    slots = [{"start": record.get("duty_start_time") or "09:00", "end": record.get("duty_end_time") or "17:00"}]
    for extra in (record.get("weekly_schedules") or {}).get(EXTRA_SLOTS_KEY) or []:
        if isinstance(extra, dict) and extra.get("start") and extra.get("end"):
            slots.append({"start": extra["start"], "end": extra["end"]})
    return slots


def _with_slots(availability, record_ident):
    if availability:
        record = get_doctor_record(record_ident, hospital_id=current_hospital_id())
        availability["slots"] = _slots_of(record) if record else []
    return availability


@doctor_availability_bp.get("/api/doctor-availability/me")
@require_session
def my_availability():
    """Availability, status and time slot of the signed-in doctor (404 when the user is not a doctor)."""
    mine = _my_doctor_record()
    if not mine:
        return jsonify({"error": "No doctor profile is linked to this account"}), 404
    return jsonify({"doctor": _with_slots(get_doctor_availability(mine["id"], hospital_id=current_hospital_id()), mine["id"])})


@doctor_availability_bp.post("/api/doctor-availability/me/status")
@require_session
def set_my_status():
    """Doctor marks themself Active (accepting patients) or Inactive."""
    mine = _my_doctor_record()
    if not mine:
        return jsonify({"error": "No doctor profile is linked to this account"}), 404
    payload = request.get_json(silent=True) or {}
    is_active = bool(payload.get("is_active", True))
    ok = set_doctor_manual_availability(
        doctor_id=mine["id"],
        is_available=is_active,
        reason=None if is_active else (payload.get("reason") or "Set inactive by doctor"),
        actor=g.current_user.get("username"),
        hospital_id=current_hospital_id(),
    )
    if not ok:
        return jsonify({"error": "Failed to update status"}), 400
    return jsonify({
        "status": "ok",
        "message": "You are now Active" if is_active else "You are now Inactive",
        "doctor": _with_slots(get_doctor_availability(mine["id"], hospital_id=current_hospital_id()), mine["id"]),
    })


@doctor_availability_bp.put("/api/doctor-availability/me/schedule")
@require_session
def set_my_time_slot():
    """Doctor sets their daily time slot. Other schedule settings (days, capacity) are preserved."""
    mine = _my_doctor_record()
    if not mine:
        return jsonify({"error": "No doctor profile is linked to this account"}), 404
    payload = request.get_json(silent=True) or {}
    raw_slots = payload.get("slots")
    if not isinstance(raw_slots, list):  # older single-window form
        raw_slots = [{"start": payload.get("duty_start_time"), "end": payload.get("duty_end_time")}]
    if not 1 <= len(raw_slots) <= 6:
        return jsonify({"error": "Add between 1 and 6 time slots"}), 400
    slots = []
    for raw in raw_slots:
        start = str((raw or {}).get("start") or "").strip()
        end = str((raw or {}).get("end") or "").strip()
        if not _HHMM.match(start) or not _HHMM.match(end):
            return jsonify({"error": "Start and end time must be in HH:MM (24-hour) format"}), 400
        if start == end:
            return jsonify({"error": "Start and end time cannot be the same"}), 400
        if any(s_["start"] == start and s_["end"] == end for s_ in slots):
            return jsonify({"error": f"The slot {start} - {end} is listed twice"}), 400
        slots.append({"start": start, "end": end})
    start, end = slots[0]["start"], slots[0]["end"]

    # Keep admin-defined days off; drop per-day start/end overrides, which would hide the new slots.
    kept_days = {
        day: {"is_off": True}
        for day, cfg in (mine.get("weekly_schedules") or {}).items()
        if day != EXTRA_SLOTS_KEY and isinstance(cfg, dict) and cfg.get("is_off")
    }
    if len(slots) > 1:
        kept_days[EXTRA_SLOTS_KEY] = slots[1:]
    schedule = {
        "duty_start_time": start,
        "duty_end_time": end,
        "shift_name": str(payload.get("shift_name") or mine.get("shift_name") or "Custom")[:40],
        "working_days": mine.get("working_days"),
        "weekly_off_days": mine.get("weekly_off_days"),
        "weekly_schedules": kept_days,
        "max_workload": mine.get("max_workload"),
        "schedule_active": True,
    }
    ok = update_doctor_schedule_config(
        doctor_id=mine["id"],
        schedule_data=schedule,
        actor=g.current_user.get("username"),
        hospital_id=current_hospital_id(),
    )
    if not ok:
        return jsonify({"error": "Failed to save time slot"}), 400
    return jsonify({
        "status": "ok",
        "message": "Time slot saved: " + ", ".join(f"{x['start']} - {x['end']}" for x in slots),
        "doctor": _with_slots(get_doctor_availability(mine["id"], hospital_id=current_hospital_id()), mine["id"]),
    })


@doctor_availability_bp.get("/api/doctor-availability")
@require_session
def list_doctor_availabilities():
    """List real-time availability of all doctors with optional department and status filters."""
    department = request.args.get("department")
    status_filter = request.args.get("status")
    hospital_id = current_hospital_id()

    doctors = get_all_doctor_availabilities(
        department=department,
        status_filter=status_filter,
        hospital_id=hospital_id,
    )
    return jsonify({
        "doctors": doctors,
        "total": len(doctors),
    })


@doctor_availability_bp.get("/api/doctor-availability/<int:doctor_id>")
@require_session
def get_single_doctor_availability(doctor_id: int):
    """Retrieve detailed availability breakdown for a single doctor."""
    hospital_id = current_hospital_id()
    doc_avail = get_doctor_availability(doctor_id, hospital_id=hospital_id)
    if not doc_avail:
        return jsonify({"error": "Doctor not found"}), 404
    return jsonify(doc_avail)


@doctor_availability_bp.get("/api/doctor-availability/eligible")
@require_session
def get_eligible_doctors():
    """Retrieve ONLY eligible doctors for a department, sorted by workload balancing."""
    department = request.args.get("department")
    patient_gender = request.args.get("patient_gender")
    doctor_gender_preference = request.args.get("doctor_gender_preference")
    hospital_id = current_hospital_id()

    eligible = get_eligible_doctors_for_department(
        department=department,
        hospital_id=hospital_id,
        patient_gender=patient_gender,
        doctor_gender_preference=doctor_gender_preference,
    )
    return jsonify({
        "department": department or "All",
        "eligible_doctors": eligible,
        "count": len(eligible),
        "recommended_doctor": eligible[0] if eligible else None,
    })


@doctor_availability_bp.post("/api/doctor-availability/<int:doctor_id>/status")
@require_session
def update_doctor_manual_status(doctor_id: int):
    """Manually mark doctor as available or unavailable (Administrator override)."""
    if not _may_manage_doctor(doctor_id):
        return jsonify({"error": "You can only change your own availability"}), 403
    payload = request.get_json(silent=True) or {}
    is_available = bool(payload.get("is_available", True))
    reason = payload.get("reason")
    actor = g.current_user.get("username") if hasattr(g, "current_user") else "admin"
    hospital_id = current_hospital_id()

    success = set_doctor_manual_availability(
        doctor_id=doctor_id,
        is_available=is_available,
        reason=reason,
        actor=actor,
        hospital_id=hospital_id,
    )
    if not success:
        return jsonify({"error": "Failed to update doctor availability"}), 404

    # Fetch updated profile
    updated = get_doctor_availability(doctor_id, hospital_id=hospital_id)
    return jsonify({
        "status": "ok",
        "message": f"Doctor marked as {'available' if is_available else 'unavailable'}",
        "doctor": updated,
    })


@doctor_availability_bp.put("/api/doctor-availability/<int:doctor_id>/schedule")
@require_session
def update_doctor_schedule(doctor_id: int):
    """Update doctor shift schedule, working days, weekly off days, and max workload capacity."""
    if not _may_manage_doctor(doctor_id):
        return jsonify({"error": "You can only change your own schedule"}), 403
    payload = request.get_json(silent=True) or {}
    actor = g.current_user.get("username") if hasattr(g, "current_user") else "admin"
    hospital_id = current_hospital_id()

    success = update_doctor_schedule_config(
        doctor_id=doctor_id,
        schedule_data=payload,
        actor=actor,
        hospital_id=hospital_id,
    )
    if not success:
        return jsonify({"error": "Failed to update schedule config"}), 404

    updated = get_doctor_availability(doctor_id, hospital_id=hospital_id)
    return jsonify({
        "status": "ok",
        "message": "Doctor schedule updated successfully",
        "doctor": updated,
    })


@doctor_availability_bp.get("/api/doctor-availability/departments-summary")
@require_session
def get_departments_summary():
    """Aggregated department-level overview of available doctors, capacities, and bottlenecks."""
    hospital_id = current_hospital_id()
    summary = get_departments_availability_summary(hospital_id=hospital_id)
    return jsonify({"departments": summary})


@doctor_availability_bp.get("/api/doctor-availability/unassigned-queue")
@require_session
def get_queue():
    """Return all patients currently waiting in unassigned queue."""
    hospital_id = current_hospital_id()
    queue = get_unassigned_queue(hospital_id=hospital_id)
    return jsonify({
        "queue": queue,
        "count": len(queue),
    })


@doctor_availability_bp.post("/api/doctor-availability/auto-assign-queue")
@require_session
def process_unassigned_queue():
    """Iterate through unassigned queue and assign patients to newly available doctors."""
    hospital_id = current_hospital_id()
    queue = get_unassigned_queue(hospital_id=hospital_id)
    actor = g.current_user.get("username") if hasattr(g, "current_user") else "admin"

    assigned_count = 0
    still_waiting = 0
    results = []

    for item in queue:
        appt_id = item["id"]
        dept = item.get("department")
        res = assign_patient_to_doctor_atomic(
            appointment_id=appt_id,
            department=dept,
            hospital_id=hospital_id,
            actor=actor,
        )
        if res.get("assigned"):
            assigned_count += 1
            results.append({
                "appointment_id": appt_id,
                "patient_name": item.get("patient_name"),
                "doctor_name": res.get("doctor_name"),
                "status": "assigned",
            })
        else:
            still_waiting += 1
            results.append({
                "appointment_id": appt_id,
                "patient_name": item.get("patient_name"),
                "status": "queued",
                "reason": res.get("error"),
            })

    return jsonify({
        "status": "ok",
        "processed": len(queue),
        "assigned": assigned_count,
        "still_waiting": still_waiting,
        "results": results,
    })


@doctor_availability_bp.get("/api/doctor-availability/notifications")
@require_session
def list_availability_notifications():
    """Return active doctor availability alerts and notifications."""
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT id, hospital_id, doctor_id, doctor_name, department,
                       event_type, message, details, severity, is_resolved,
                       resolved_at, created_at
                FROM doctor_availability_notifications
                WHERE hospital_id = ?
                ORDER BY created_at DESC LIMIT 100
            """),
            (hospital_id,),
        )
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("details") and isinstance(d["details"], str):
                try:
                    d["details"] = json.loads(d["details"])
                except Exception:
                    pass
            for k in ("created_at", "resolved_at"):
                if d.get(k) and hasattr(d[k], "isoformat"):
                    d[k] = d[k].isoformat()
            result.append(d)
        return jsonify({"notifications": result})


@doctor_availability_bp.post("/api/doctor-availability/notifications/<int:notif_id>/resolve")
@require_session
def resolve_availability_notification(notif_id: int):
    """Mark an availability notification as resolved."""
    hospital_id = current_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                UPDATE doctor_availability_notifications
                SET is_resolved = TRUE, resolved_at = CURRENT_TIMESTAMP
                WHERE id = ? AND hospital_id = ?
            """),
            (notif_id, hospital_id),
        )
        conn.commit()
    return jsonify({"status": "ok", "message": "Notification resolved"})
