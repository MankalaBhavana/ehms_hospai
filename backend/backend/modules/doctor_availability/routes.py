"""Doctor Availability & Assignment API Endpoints.

Provides administrative visibility, real-time status monitoring, manual availability controls,
duty schedule updates, unassigned queue processing, and notification handling.
"""

from __future__ import annotations

import json
from flask import Blueprint, g, jsonify, request

from shared.session_auth import require_session, require_permissions
from shared.hospital import current_hospital_id
from shared.audit import log_audit_event
from shared.responses import validate_required_fields

from services.doctor_availability_service import (
    get_all_doctor_availabilities,
    get_doctor_availability,
    get_eligible_doctors_for_department,
    is_doctor_eligible_for_assignment,
    set_doctor_manual_availability,
    update_doctor_schedule_config,
    get_departments_availability_summary,
    get_unassigned_queue,
    assign_patient_to_doctor_atomic,
    create_availability_notification,
)
from utils.database import get_connection, _to_sql_params

doctor_availability_bp = Blueprint("doctor_availability", __name__)


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
