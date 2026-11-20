"""Centralized Doctor Availability & Assignment Engine.

Provides real-time dynamic doctor eligibility checking, daily duty schedule evaluation,
leave management integration, live session verification, workload capacity enforcement,
automatic patient assignment, and administrator notifications across all HMS modules.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date, time, timedelta
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:
    # Python < 3.9 fallback
    from backports.zoneinfo import ZoneInfo  # type: ignore

from utils.database import (
    get_connection,
    resolve_hospital_id,
    current_ist_datetime,
    _to_sql_params,
    add_audit_log,
)

logger = logging.getLogger(__name__)

HOSPITAL_TIMEZONE = ZoneInfo("Asia/Kolkata")
DEFAULT_MAX_WORKLOAD = 15


def log_audit_event(action, module_name, entity_id, actor="system", details=None):
    """Record an administrative or assignment event in the audit trail."""
    try:
        import json
        payload_str = json.dumps(details) if isinstance(details, dict) else str(details) if details else None
        add_audit_log({
            "actor_username": str(actor or "system"),
            "action": action,
            "module_name": module_name,
            "entity_key": str(entity_id),
            "payload": payload_str,
            "ip_address": "127.0.0.1",
            "hospital_id": 1,
        })
    except Exception as e:
        logger.warning(f"Failed to record audit log: {e}")


# ── Timezone & Datetime Utilities ─────────────────────────────────────────────

def get_hospital_now(hospital_id: Optional[int] = None) -> datetime:
    """Return the current time in the hospital's timezone (Asia/Kolkata - IST)."""
    return datetime.now(HOSPITAL_TIMEZONE)


def normalize_time_str(time_val: Any) -> str:
    """Convert time object or string to HH:MM (24-hour)."""
    if isinstance(time_val, time):
        return time_val.strftime("%H:%M")
    if isinstance(time_val, datetime):
        return time_val.strftime("%H:%M")
    s = str(time_val or "").strip()
    if not s:
        return "00:00"
    parts = s.split(":")
    if len(parts) >= 2:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    return s


def is_time_within_shift(
    current_time_str: str,
    start_time_str: str,
    end_time_str: str,
    is_overnight: bool = False,
) -> bool:
    """Determine if current_time_str is within [start_time_str, end_time_str].

    Handles:
    - Same-day shift: e.g. 09:00 to 17:00 (start <= current <= end)
    - Overnight shift: e.g. 20:00 to 04:00 (current >= 20:00 OR current <= 04:00)
    """
    cur = normalize_time_str(current_time_str)
    start = normalize_time_str(start_time_str)
    end = normalize_time_str(end_time_str)

    # Check if shift crosses midnight
    crosses_midnight = is_overnight or (start > end)

    if not crosses_midnight:
        return start <= cur <= end
    else:
        # Crosses midnight: either in the evening of day 1, or early morning of day 2
        return cur >= start or cur <= end


# ── Doctor & User Resolvers ───────────────────────────────────────────────────

def get_doctor_record(
    doctor_ident: Any, hospital_id: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """Resolve a unified doctor record by ID, staff_id, username, or doctor_name."""
    if not doctor_ident:
        return None

    scoped_id = hospital_id or resolve_hospital_id()
    ident_str = str(doctor_ident).strip()

    with get_connection() as conn:
        cursor = conn.cursor()

        # Try doctors table first
        doc_row = None
        if ident_str.isdigit():
            cursor.execute(
                _to_sql_params(
                    "SELECT * FROM doctors WHERE id = ? AND (hospital_id = ? OR hospital_id IS NULL) LIMIT 1"
                ),
                (int(ident_str), scoped_id),
            )
            doc_row = cursor.fetchone()

        if not doc_row:
            cursor.execute(
                _to_sql_params("""
                    SELECT * FROM doctors
                    WHERE (staff_id = ? OR username = ? OR LOWER(doctor_name) = LOWER(?))
                      AND (hospital_id = ? OR hospital_id IS NULL)
                    ORDER BY id ASC LIMIT 1
                """),
                (ident_str, ident_str, ident_str, scoped_id),
            )
            doc_row = cursor.fetchone()

        # If not found in doctors, check users table for job_role = 'Doctor'
        user_row = None
        if doc_row and doc_row.get("user_id"):
            cursor.execute(
                _to_sql_params("SELECT * FROM users WHERE id = ? LIMIT 1"),
                (doc_row["user_id"],),
            )
            user_row = cursor.fetchone()
        elif doc_row:
            cursor.execute(
                _to_sql_params("""
                    SELECT * FROM users
                    WHERE (employee_id = ? OR username = ? OR LOWER(full_name) = LOWER(?))
                      AND (hospital_id = ? OR hospital_id IS NULL)
                    ORDER BY id ASC LIMIT 1
                """),
                (doc_row.get("staff_id"), doc_row.get("username"), doc_row.get("doctor_name"), scoped_id),
            )
            user_row = cursor.fetchone()
        else:
            # Doctor not in doctors table: check users table
            cursor.execute(
                _to_sql_params("""
                    SELECT * FROM users
                    WHERE (employee_id = ? OR username = ? OR LOWER(full_name) = LOWER(?))
                      AND job_role ILIKE '%doctor%'
                      AND (hospital_id = ? OR hospital_id IS NULL)
                    ORDER BY id ASC LIMIT 1
                """),
                (ident_str, ident_str, ident_str, scoped_id),
            )
            user_row = cursor.fetchone()

        if not doc_row and not user_row:
            return None

        # Build combined doctor profile
        doc_dict = dict(doc_row) if doc_row else {}
        user_dict = dict(user_row) if user_row else {}

        doctor_id = doc_dict.get("id") or user_dict.get("id")
        user_id = user_dict.get("id") or doc_dict.get("user_id")
        doctor_name = doc_dict.get("doctor_name") or user_dict.get("full_name") or ident_str
        department = doc_dict.get("department") or user_dict.get("department") or "General Medicine"
        staff_id = doc_dict.get("staff_id") or user_dict.get("employee_id") or f"DOC-{doctor_id}"
        username = doc_dict.get("username") or user_dict.get("username") or ""

        # Schedule defaults
        working_days_raw = doc_dict.get("working_days")
        if isinstance(working_days_raw, str):
            try:
                working_days = json.loads(working_days_raw)
            except Exception:
                if "," in working_days_raw:
                    working_days = [d.strip() for d in working_days_raw.split(",") if d.strip()]
                elif working_days_raw.strip():
                    working_days = [working_days_raw.strip()]
                else:
                    working_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        elif isinstance(working_days_raw, (list, tuple, set)):
            working_days = list(working_days_raw)
        else:
            working_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

        weekly_off_raw = doc_dict.get("weekly_off_days")
        if isinstance(weekly_off_raw, str):
            try:
                weekly_off_days = json.loads(weekly_off_raw)
            except Exception:
                if "," in weekly_off_raw:
                    weekly_off_days = [d.strip() for d in weekly_off_raw.split(",") if d.strip()]
                elif weekly_off_raw.strip():
                    weekly_off_days = [weekly_off_raw.strip()]
                else:
                    weekly_off_days = ["Sunday"]
        elif isinstance(weekly_off_raw, (list, tuple, set)):
            weekly_off_days = list(weekly_off_raw)
        else:
            weekly_off_days = ["Sunday"]

        weekly_schedules_raw = doc_dict.get("weekly_schedules") or '{}'
        if isinstance(weekly_schedules_raw, str):
            try:
                weekly_schedules = json.loads(weekly_schedules_raw)
            except Exception:
                weekly_schedules = {}
        else:
            weekly_schedules = dict(weekly_schedules_raw or {})

        max_workload = int(doc_dict.get("max_workload") or DEFAULT_MAX_WORKLOAD)
        is_manually_unavailable = bool(doc_dict.get("is_manually_unavailable", False))
        manual_unavailable_reason = doc_dict.get("manual_unavailable_reason") or ""
        duty_start = doc_dict.get("duty_start_time") or "09:00"
        duty_end = doc_dict.get("duty_end_time") or "17:00"
        shift_name = doc_dict.get("shift_name") or "Morning"
        schedule_active = bool(doc_dict.get("schedule_active", True))

        # Overall active status
        user_status = (user_dict.get("status") or "active").lower()
        doc_status = (doc_dict.get("status") or "available").lower()
        doc_active = doc_dict.get("active", True)
        is_account_active = (user_status == "active") and (doc_active is not False) and (doc_status != "inactive")

        return {
            "id": doctor_id,
            "user_id": user_id,
            "doctor_name": doctor_name,
            "department": department,
            "specialty": doc_dict.get("specialty") or department,
            "staff_id": staff_id,
            "username": username,
            "room": doc_dict.get("room") or "OPD-101",
            "gender": doc_dict.get("gender") or "Male",
            "consultation_fee": float(doc_dict.get("consultation_fee") or 0),
            "review_fee": float(doc_dict.get("review_fee") or 0),
            "max_workload": max_workload,
            "is_manually_unavailable": is_manually_unavailable,
            "manual_unavailable_reason": manual_unavailable_reason,
            "duty_start_time": duty_start,
            "duty_end_time": duty_end,
            "shift_name": shift_name,
            "working_days": working_days,
            "weekly_off_days": weekly_off_days,
            "weekly_schedules": weekly_schedules,
            "schedule_active": schedule_active,
            "is_account_active": is_account_active,
            "raw_status": doc_status,
            "hospital_id": scoped_id,
        }


# ── Eligibility Checks ────────────────────────────────────────────────────────

def check_doctor_session(
    doctor_record: Dict[str, Any], hospital_id: Optional[int] = None
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Check if doctor has an active, unexpired login session in the sessions table."""
    user_id = doctor_record.get("user_id")
    scoped_id = hospital_id or doctor_record.get("hospital_id") or resolve_hospital_id()

    with get_connection() as conn:
        cursor = conn.cursor()

        # If user_id is missing, try to find user by staff_id or username
        if not user_id:
            cursor.execute(
                _to_sql_params("""
                    SELECT id FROM users
                    WHERE (employee_id = ? OR username = ? OR LOWER(full_name) = LOWER(?))
                      AND (hospital_id = ? OR hospital_id IS NULL)
                    LIMIT 1
                """),
                (doctor_record.get("staff_id"), doctor_record.get("username"), doctor_record.get("doctor_name"), scoped_id),
            )
            row = cursor.fetchone()
            if row:
                user_id = row["id"] if isinstance(row, dict) else row[0]

        if not user_id:
            return False, None

        cursor.execute(
            _to_sql_params("""
                SELECT id, user_id, token_hash, created_at, last_seen, expires_at, ip_address, user_agent
                FROM sessions
                WHERE user_id = ?
                  AND expires_at > CURRENT_TIMESTAMP
                ORDER BY last_seen DESC LIMIT 1
            """),
            (user_id,),
        )
        session = cursor.fetchone()
        if session:
            sess_dict = dict(session)
            # Normalize timestamps
            for k in ("created_at", "last_seen", "expires_at"):
                if sess_dict.get(k) and hasattr(sess_dict[k], "isoformat"):
                    sess_dict[k] = sess_dict[k].isoformat()
            return True, sess_dict

    return False, None


def check_doctor_leave(
    doctor_record: Dict[str, Any],
    check_dt: datetime,
    hospital_id: Optional[int] = None,
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Check if doctor is on approved leave for check_dt.

    Handles:
    - Single-day leave
    - Multiple-day date ranges
    - Half-day leave (first_half / second_half)
    - Ignores pending, rejected, and cancelled requests
    """
    staff_id = str(doctor_record.get("staff_id") or "")
    username = str(doctor_record.get("username") or "")
    user_id_str = str(doctor_record.get("user_id") or "")
    doc_id = doctor_record.get("id")
    scoped_id = hospital_id or doctor_record.get("hospital_id") or resolve_hospital_id()

    check_date = check_dt.date()
    check_time_str = check_dt.strftime("%H:%M")

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT id, employee_id, leave_type, start_date, end_date, reason,
                       status, decided_by, half_day, half_day_period
                FROM leave_requests
                WHERE (employee_id = ? OR employee_id = ? OR employee_id = ? OR doctor_id = ?)
                  AND LOWER(status) = 'approved'
                  AND DATE(start_date) <= DATE(?)
                  AND DATE(end_date) >= DATE(?)
                  AND (hospital_id = ? OR hospital_id IS NULL)
                  AND (deleted_at IS NULL)
                ORDER BY id DESC LIMIT 1
            """),
            (staff_id, username, user_id_str, doc_id, check_date, check_date, scoped_id),
        )
        row = cursor.fetchone()
        if not row:
            return False, None

        leave_dict = dict(row)
        for k in ("start_date", "end_date"):
            if leave_dict.get(k) and hasattr(leave_dict[k], "isoformat"):
                leave_dict[k] = leave_dict[k].isoformat()

        # Check half-day logic
        if leave_dict.get("half_day"):
            period = str(leave_dict.get("half_day_period") or "full_day").lower()
            if period == "first_half":
                # First half: Morning leave (08:00 - 13:00)
                if check_time_str < "13:00":
                    return True, leave_dict
                else:
                    return False, None
            elif period == "second_half":
                # Second half: Afternoon leave (13:00 - 18:00)
                if check_time_str >= "13:00":
                    return True, leave_dict
                else:
                    return False, None

        return True, leave_dict


def check_doctor_duty_schedule(
    doctor_record: Dict[str, Any],
    check_dt: datetime,
    hospital_id: Optional[int] = None,
) -> Tuple[bool, Dict[str, Any]]:
    """Evaluate whether the doctor is officially scheduled on duty right now.

    Priority:
    1. Specific date schedule in doctor_schedules table (takes precedence over weekly defaults).
    2. Yesterday's overnight shift in doctor_schedules table spilling into today.
    3. Doctor's recurring weekly schedule (working_days, weekly_off_days, shifts).
    4. Yesterday's overnight recurring shift spilling into today.
    """
    scoped_id = hospital_id or doctor_record.get("hospital_id") or resolve_hospital_id()
    doc_id = doctor_record.get("id")
    doc_name = doctor_record.get("doctor_name")

    check_date = check_dt.date()
    yesterday_date = check_date - timedelta(days=1)
    time_str = check_dt.strftime("%H:%M")
    weekday_str = check_dt.strftime("%A")  # "Monday", "Tuesday", etc.
    yesterday_weekday_str = yesterday_date.strftime("%A")

    with get_connection() as conn:
        cursor = conn.cursor()

        # Step 1: Check today's specific date schedule
        cursor.execute(
            _to_sql_params("""
                SELECT * FROM doctor_schedules
                WHERE (doctor_id = ? OR LOWER(doctor_name) = LOWER(?))
                  AND DATE(schedule_date) = DATE(?)
                  AND (hospital_id = ? OR hospital_id IS NULL)
                  AND (deleted_at IS NULL)
                ORDER BY id DESC LIMIT 1
            """),
            (doc_id, doc_name, check_date, scoped_id),
        )
        today_override = cursor.fetchone()

        if today_override:
            sched = dict(today_override)
            sched_status = (sched.get("status") or "available").lower()

            if sched_status in ("leave", "off", "off_duty", "inactive", "full_day_off"):
                return False, {
                    "scheduled": False,
                    "source": "date_override",
                    "reason": f"Marked {sched_status} on roster for today",
                    "shift": sched.get("shift_type") or "Custom",
                }

            start = normalize_time_str(sched.get("start_time") or "09:00")
            end = normalize_time_str(sched.get("end_time") or "17:00")
            is_overnight = bool(sched.get("is_overnight")) or (start > end)

            if is_time_within_shift(time_str, start, end, is_overnight=is_overnight):
                return True, {
                    "scheduled": True,
                    "source": "date_override",
                    "shift": sched.get("shift_type") or "Scheduled Shift",
                    "start_time": start,
                    "end_time": end,
                    "is_overnight": is_overnight,
                    "slot_capacity": sched.get("slot_capacity"),
                }
            else:
                return False, {
                    "scheduled": False,
                    "source": "date_override",
                    "reason": f"Outside shift hours ({start} - {end})",
                    "shift": sched.get("shift_type") or "Scheduled Shift",
                    "start_time": start,
                    "end_time": end,
                }

        # Step 2: Check yesterday's overnight shift from doctor_schedules
        cursor.execute(
            _to_sql_params("""
                SELECT * FROM doctor_schedules
                WHERE (doctor_id = ? OR LOWER(doctor_name) = LOWER(?))
                  AND DATE(schedule_date) = DATE(?)
                  AND (is_overnight = TRUE OR start_time > end_time)
                  AND LOWER(status) = 'available'
                  AND (hospital_id = ? OR hospital_id IS NULL)
                  AND (deleted_at IS NULL)
                ORDER BY id DESC LIMIT 1
            """),
            (doc_id, doc_name, yesterday_date, scoped_id),
        )
        yesterday_override = cursor.fetchone()
        if yesterday_override:
            sched = dict(yesterday_override)
            end = normalize_time_str(sched.get("end_time") or "04:00")
            # If current time is earlier than the overnight shift end
            if time_str <= end:
                return True, {
                    "scheduled": True,
                    "source": "yesterday_overnight_override",
                    "shift": sched.get("shift_type") or "Night Shift",
                    "start_time": sched.get("start_time"),
                    "end_time": end,
                    "is_overnight": True,
                    "slot_capacity": sched.get("slot_capacity"),
                }

    # Step 3: Evaluate recurring weekly schedule
    if not doctor_record.get("schedule_active", True):
        return False, {
            "scheduled": False,
            "source": "weekly_default",
            "reason": "Doctor schedule is marked inactive",
        }

    weekly_offs = set(doctor_record.get("weekly_off_days") or [])
    working_days = set(doctor_record.get("working_days") or [])
    weekly_schedules = doctor_record.get("weekly_schedules") or {}

    # Check if yesterday had an overnight shift extending into today
    duty_start = normalize_time_str(doctor_record.get("duty_start_time") or "09:00")
    duty_end = normalize_time_str(doctor_record.get("duty_end_time") or "17:00")
    is_overnight = duty_start > duty_end

    if is_overnight and yesterday_weekday_str in working_days and yesterday_weekday_str not in weekly_offs:
        if time_str <= duty_end:
            return True, {
                "scheduled": True,
                "source": "weekly_overnight_spillover",
                "shift": doctor_record.get("shift_name") or "Night Shift",
                "start_time": duty_start,
                "end_time": duty_end,
                "is_overnight": True,
            }

    # If today is a weekly off day or not a working day
    if weekday_str in weekly_offs or (working_days and weekday_str not in working_days):
        return False, {
            "scheduled": False,
            "source": "weekly_default",
            "reason": f"Weekly off-day ({weekday_str})",
            "shift": "Off Duty",
        }

    # Check day-specific config in weekly_schedules (e.g. Wednesday morning vs Friday evening)
    day_config = weekly_schedules.get(weekday_str) or {}
    if day_config.get("is_off"):
        return False, {
            "scheduled": False,
            "source": "weekly_day_config",
            "reason": f"Scheduled off on {weekday_str}",
            "shift": "Off Duty",
        }

    day_start = normalize_time_str(day_config.get("start_time") or duty_start)
    day_end = normalize_time_str(day_config.get("end_time") or duty_end)
    day_shift = day_config.get("shift_name") or doctor_record.get("shift_name") or "General"
    day_overnight = day_start > day_end

    if is_time_within_shift(time_str, day_start, day_end, is_overnight=day_overnight):
        return True, {
            "scheduled": True,
            "source": "weekly_default",
            "shift": day_shift,
            "start_time": day_start,
            "end_time": day_end,
            "is_overnight": day_overnight,
        }
    else:
        return False, {
            "scheduled": False,
            "source": "weekly_default",
            "reason": f"Outside shift hours ({day_start} - {day_end})",
            "shift": day_shift,
            "start_time": day_start,
            "end_time": day_end,
        }


def get_doctor_current_workload(
    doctor_name: str,
    check_date: date,
    hospital_id: Optional[int] = None,
) -> int:
    """Count active patient appointments assigned to doctor for check_date."""
    if not doctor_name:
        return 0

    scoped_id = hospital_id or resolve_hospital_id()
    name_clean = doctor_name.strip()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT COUNT(*) AS active_count
                FROM appointments
                WHERE (LOWER(doctor_name) = LOWER(?) OR LOWER(doctor_name) LIKE LOWER(?))
                  AND DATE(appointment_date) = DATE(?)
                  AND status IN ('scheduled', 'checked_in', 'in_consultation')
                  AND (hospital_id = ? OR hospital_id IS NULL)
                  AND (deleted_at IS NULL)
            """),
            (name_clean, f"%{name_clean}%", check_date, scoped_id),
        )
        row = cursor.fetchone()
        return int(row["active_count"] if isinstance(row, dict) else (row[0] if row else 0))


# ── Centralized Availability Evaluator ────────────────────────────────────────

def get_doctor_availability(
    doctor_ident: Any,
    dt: Optional[datetime] = None,
    hospital_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Evaluate ALL 7 doctor availability & assignment rules in real-time.

    Rules:
    1. Account is active (users.status='active' and doctor.active=true).
    2. Logged in with valid active session in sessions table.
    3. Officially scheduled for duty covering current hospital date & time.
    4. Not on approved leave for current date & time.
    5. Not manually marked unavailable.
    6. Department / specialty match.
    7. Workload is strictly below configured capacity.

    Calculates exact status:
    - 'available': satisfies all 7 conditions.
    - 'busy': on duty & logged in, but workload >= capacity.
    - 'on_leave': approved leave exists.
    - 'off_duty': not scheduled for duty right now.
    - 'offline': not logged in or active session expired.
    - 'unavailable': manually marked unavailable or account inactive.
    """
    check_dt = dt or get_hospital_now(hospital_id)
    doc = get_doctor_record(doctor_ident, hospital_id=hospital_id)
    if not doc:
        return None

    scoped_id = hospital_id or doc.get("hospital_id") or resolve_hospital_id()
    check_date = check_dt.date()

    # Rule 1: Account active
    account_active = bool(doc.get("is_account_active", True))

    # Rule 2: Active login session
    is_logged_in, session_info = check_doctor_session(doc, hospital_id=scoped_id)

    # Rule 3: Duty schedule
    on_duty, schedule_info = check_doctor_duty_schedule(doc, check_dt, hospital_id=scoped_id)

    # Rule 4: Leave status
    on_leave, leave_info = check_doctor_leave(doc, check_dt, hospital_id=scoped_id)

    # Rule 5: Manual availability
    manually_unavailable = bool(doc.get("is_manually_unavailable", False)) or (doc.get("raw_status") == "unavailable")
    manual_reason = doc.get("manual_unavailable_reason") or ""

    # Rule 6 & 7: Workload capacity
    max_workload = int(schedule_info.get("slot_capacity") or doc.get("max_workload") or DEFAULT_MAX_WORKLOAD)
    current_workload = get_doctor_current_workload(doc["doctor_name"], check_date, hospital_id=scoped_id)
    within_capacity = current_workload < max_workload

    # Determine centralized availability status
    if not account_active:
        status = "unavailable"
        status_label = "Inactive Account"
    elif on_leave:
        status = "on_leave"
        status_label = f"On Leave ({leave_info.get('leave_type', 'Approved')})" if leave_info else "On Leave"
    elif manually_unavailable:
        status = "unavailable"
        status_label = f"Unavailable ({manual_reason})" if manual_reason else "Unavailable"
    elif not is_logged_in:
        status = "offline"
        status_label = "Offline (Logged Out)"
    elif not on_duty:
        status = "off_duty"
        status_label = f"Off Duty ({schedule_info.get('reason', 'Not Scheduled')})"
    elif not within_capacity:
        status = "busy"
        status_label = f"Busy ({current_workload}/{max_workload} Patients)"
    else:
        status = "available"
        status_label = "Available"

    is_eligible = (status == "available")

    return {
        "id": doc["id"],
        "doctor_id": doc["id"],
        "user_id": doc.get("user_id"),
        "doctor_name": doc["doctor_name"],
        "name": doc["doctor_name"],
        "department": doc["department"],
        "specialty": doc["specialty"],
        "staff_id": doc["staff_id"],
        "username": doc["username"],
        "room": doc["room"],
        "gender": doc["gender"],
        "consultation_fee": doc["consultation_fee"],
        "review_fee": doc["review_fee"],
        "status": status,
        "status_label": status_label,
        "is_eligible": is_eligible,
        "current_workload": current_workload,
        "max_workload": max_workload,
        "capacity_remaining": max(0, max_workload - current_workload),
        "eligibility_reasons": {
            "account_active": account_active,
            "logged_in": is_logged_in,
            "on_duty": on_duty,
            "not_on_leave": not on_leave,
            "not_manually_unavailable": not manually_unavailable,
            "within_capacity": within_capacity,
        },
        "session": session_info,
        "schedule": schedule_info,
        "leave": leave_info,
        "evaluated_at": check_dt.isoformat(),
        "hospital_id": scoped_id,
    }


def get_all_doctor_availabilities(
    department: Optional[str] = None,
    status_filter: Optional[str] = None,
    dt: Optional[datetime] = None,
    hospital_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Retrieve availability for all doctors in the hospital, with optional filters."""
    scoped_id = hospital_id or resolve_hospital_id()
    check_dt = dt or get_hospital_now(scoped_id)

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT id FROM doctors
                WHERE (hospital_id = ? OR hospital_id IS NULL)
                ORDER BY doctor_name ASC
            """),
            (scoped_id,),
        )
        doc_rows = cursor.fetchall()

    results = []
    seen_ids = set()

    for row in doc_rows:
        d_id = row["id"] if isinstance(row, dict) else row[0]
        if d_id in seen_ids:
            continue
        seen_ids.add(d_id)
        avail = get_doctor_availability(d_id, dt=check_dt, hospital_id=scoped_id)
        if not avail:
            continue

        # Department filter
        if department and department != "all":
            if department.strip().lower() not in avail["department"].strip().lower() and \
               avail["department"].strip().lower() not in department.strip().lower():
                continue

        # Status filter
        if status_filter and status_filter != "all":
            if avail["status"].lower() != status_filter.strip().lower():
                continue

        results.append(avail)

    return results


def get_eligible_doctors_for_department(
    department: Optional[str] = None,
    dt: Optional[datetime] = None,
    hospital_id: Optional[int] = None,
    patient_gender: Optional[str] = None,
    doctor_gender_preference: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return ONLY doctors who satisfy ALL 7 eligibility criteria for a given department.

    Sorts by workload-balancing strategy:
    1. Lowest current active workload (least assigned patients first).
    2. Gender preference match (if patient/doctor gender preference specified).
    3. Doctor ID / schedule order.
    """
    scoped_id = hospital_id or resolve_hospital_id()
    check_dt = dt or get_hospital_now(scoped_id)

    desired_gender = (doctor_gender_preference or patient_gender or "").strip().capitalize()
    if desired_gender not in ("Male", "Female"):
        desired_gender = None

    all_docs = get_all_doctor_availabilities(
        department=department,
        status_filter="available",
        dt=check_dt,
        hospital_id=scoped_id,
    )

    eligible = [doc for doc in all_docs if doc.get("is_eligible")]

    # Workload balancing & tie-breaker sorting
    def sort_key(doc):
        workload = doc["current_workload"]
        gender_match = 1 if (desired_gender and doc.get("gender") == desired_gender) else 0
        return (workload, -gender_match, doc["id"])

    eligible.sort(key=sort_key)
    return eligible


def is_doctor_eligible_for_assignment(
    doctor_ident: Any,
    department: Optional[str] = None,
    dt: Optional[datetime] = None,
    target_datetime: Optional[datetime] = None,
    hospital_id: Optional[int] = None,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """Verify whether a specific doctor is eligible to receive a new patient right now.

    Returns: (is_eligible, failure_reason_if_not, doctor_availability_dict)
    """
    effective_dt = target_datetime or dt
    avail = get_doctor_availability(doctor_ident, dt=effective_dt, hospital_id=hospital_id)
    if not avail:
        return False, "Doctor not found in records", None

    if department and department.strip() and department.lower() != "all":
        req = department.strip().lower()
        doc_dept = avail["department"].strip().lower()
        if req not in doc_dept and doc_dept not in req:
            return False, f"Doctor belongs to {avail['department']}, not required specialty {department}", avail

    if not avail["is_eligible"]:
        reason = avail["status_label"]
        return False, f"Doctor is currently {reason}", avail

    return True, "Eligible", avail


# ── Notifications & Event Dispatcher ──────────────────────────────────────────

def create_availability_notification(
    event_type: str,
    message: str,
    doctor_name: Optional[str] = None,
    doctor_id: Optional[int] = None,
    department: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    severity: str = "warning",
    hospital_id: Optional[int] = None,
) -> int:
    """Record a doctor availability notification in the database and emit transfer notice."""
    scoped_id = hospital_id or resolve_hospital_id()
    details_str = json.dumps(details or {})

    notif_id = 0
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                _to_sql_params("""
                    INSERT INTO doctor_availability_notifications (
                        hospital_id, doctor_id, doctor_name, department,
                        event_type, message, details, severity
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """),
                (
                    scoped_id, doctor_id, doctor_name, department,
                    event_type, message, details_str, severity
                ),
            )
            row = cursor.fetchone()
            if row:
                notif_id = row["id"] if isinstance(row, dict) else row[0]
            conn.commit()
        except Exception as exc:
            logger.warning(f"Could not record doctor availability notification: {exc}")

        # Also emit to transfer_notices so live notice banners pick it up
        try:
            cursor.execute(
                _to_sql_params("""
                    INSERT INTO transfer_notices (
                        hospital_id, kind, patient_id, patient_name,
                        from_dept, to_dept, to_module, note, ref,
                        priority, audience, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """),
                (
                    scoped_id,
                    "Doctor Availability",
                    details.get("patient_id") if details else None,
                    details.get("patient_name", "Availability Alert") if details else "Availability Alert",
                    department or "OP",
                    department or "Administration",
                    "Administration",
                    message,
                    f"avail_{event_type}_{doctor_name or department}",
                    "Urgent" if severity == "critical" else "High",
                    "administrators",
                    "system",
                ),
            )
            conn.commit()
        except Exception:
            pass

    return notif_id


def notify_no_doctor_available(
    department: str,
    patient_info: Optional[Dict[str, Any]] = None,
    hospital_id: Optional[int] = None,
):
    """Notify when no eligible doctor is available for an incoming patient."""
    pat_str = f" for patient {patient_info.get('name', '')} ({patient_info.get('patient_id', '')})" if patient_info else ""
    msg = f"No eligible doctor available in {department}{pat_str}. Patient retained in unassigned queue."
    create_availability_notification(
        event_type="no_doctor_available",
        message=msg,
        department=department,
        details=patient_info,
        severity="critical",
        hospital_id=hospital_id,
    )


def notify_doctor_logout_with_pending_queue(
    doctor_name: str,
    department: str,
    queue_count: int,
    hospital_id: Optional[int] = None,
):
    """Notify when a doctor logs out while patients are waiting in their department queue."""
    msg = f"Dr. {doctor_name} logged out while {queue_count} patient(s) are waiting in {department} queue."
    create_availability_notification(
        event_type="doctor_logged_out_with_queue",
        message=msg,
        doctor_name=doctor_name,
        department=department,
        details={"queue_count": queue_count},
        severity="warning",
        hospital_id=hospital_id,
    )


def notify_leave_affects_schedule(
    doctor_name: str,
    leave_record: Dict[str, Any],
    hospital_id: Optional[int] = None,
):
    """Notify when an approved leave overlaps with a doctor's scheduled duties."""
    msg = f"Approved leave for Dr. {doctor_name} ({leave_record.get('start_date')} to {leave_record.get('end_date')}) overlaps with duty roster."
    create_availability_notification(
        event_type="leave_affected_schedule",
        message=msg,
        doctor_name=doctor_name,
        details=leave_record,
        severity="warning",
        hospital_id=hospital_id,
    )


def notify_doctor_became_available(
    doctor_name: str,
    department: str,
    hospital_id: Optional[int] = None,
):
    """Notify when a doctor becomes available again (e.g. logs in on duty)."""
    msg = f"Dr. {doctor_name} is now Available for assignments in {department}."
    create_availability_notification(
        event_type="doctor_became_available",
        message=msg,
        doctor_name=doctor_name,
        department=department,
        severity="info",
        hospital_id=hospital_id,
    )


# ── Atomic Patient Assignment Engine ──────────────────────────────────────────

def assign_patient_to_doctor_atomic(
    appointment_id: int,
    department: Optional[str] = None,
    preferred_doctor: Optional[str] = None,
    hospital_id: Optional[int] = None,
    actor: Optional[str] = None,
) -> Dict[str, Any]:
    """Assign patient to an eligible doctor with final concurrency validation.

    Process:
    1. Retrieve appointment with FOR UPDATE lock.
    2. If preferred_doctor is provided:
       - Validate real-time eligibility.
       - If eligible: assign directly.
       - If not eligible: reject if explicit override not requested, or fallback to best available doctor in department.
    3. If no preferred_doctor:
       - Find best available eligible doctor in department using workload-balancing strategy.
    4. If no eligible doctor exists:
       - Retain patient in unassigned queue (doctor_name = NULL, op_status = 'queued', status = 'scheduled').
       - Create alert notification for administrators/staff.
    5. Save assignment and record timeline event.
    """
    scoped_id = hospital_id or resolve_hospital_id()
    now_dt = get_hospital_now(scoped_id)

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT id, patient_id, patient_name, visit_type, department,
                       doctor_name, appointment_date, status, op_status, gender_preference
                FROM appointments
                WHERE id = ? AND hospital_id = ?
                FOR UPDATE
            """),
            (appointment_id, scoped_id),
        )
        appointment = cursor.fetchone()
        if not appointment:
            return {"success": False, "error": "Appointment not found", "assigned": False}

        appt_dict = dict(appointment)
        target_dept = (department or appt_dict.get("department") or "General Medicine").strip()

        assigned_doctor = None
        used_fallback = False

        # If an explicit doctor was requested
        if preferred_doctor and preferred_doctor.strip():
            pref_name = preferred_doctor.strip()
            is_ok, reason, doc_details = is_doctor_eligible_for_assignment(
                pref_name, department=target_dept, dt=now_dt, hospital_id=scoped_id
            )
            if is_ok and doc_details:
                assigned_doctor = doc_details
            else:
                # Preferred doctor is not eligible right now
                logger.info(f"Requested doctor {pref_name} ineligible ({reason}). Falling back to available roster.")
                used_fallback = True

        # If not assigned yet, select best available doctor via workload balancing
        if not assigned_doctor:
            eligible_docs = get_eligible_doctors_for_department(
                department=target_dept,
                dt=now_dt,
                hospital_id=scoped_id,
                doctor_gender_preference=appt_dict.get("gender_preference"),
            )
            if eligible_docs:
                assigned_doctor = eligible_docs[0]

        # Case: An eligible doctor was found
        if assigned_doctor:
            doc_name = assigned_doctor["doctor_name"]
            doc_dept = assigned_doctor["department"]

            cursor.execute(
                _to_sql_params("""
                    UPDATE appointments
                    SET doctor_name = ?, department = COALESCE(?, department),
                        status = 'checked_in', op_status = 'doctor_assigned'
                    WHERE id = ? AND hospital_id = ?
                """),
                (doc_name, doc_dept, appointment_id, scoped_id),
            )

            # Record timeline event
            try:
                from utils.database import record_op_timeline_event
                record_op_timeline_event(
                    appointment_id,
                    "Doctor Assigned",
                    f"Patient assigned to Dr. {doc_name} ({doc_dept}). Workload: {assigned_doctor['current_workload'] + 1}/{assigned_doctor['max_workload']}.",
                    actor=actor,
                    hospital_id=scoped_id,
                )
            except Exception:
                pass

            conn.commit()
            return {
                "success": True,
                "assigned": True,
                "doctor_name": doc_name,
                "department": doc_dept,
                "used_fallback": used_fallback,
                "workload": assigned_doctor["current_workload"] + 1,
            }

        # Case: NO eligible doctor available in the department
        else:
            cursor.execute(
                _to_sql_params("""
                    UPDATE appointments
                    SET doctor_name = NULL, department = ?,
                        status = 'scheduled', op_status = 'queued'
                    WHERE id = ? AND hospital_id = ?
                """),
                (target_dept, appointment_id, scoped_id),
            )
            conn.commit()

            # Dispatch notification
            notify_no_doctor_available(
                department=target_dept,
                patient_info={
                    "appointment_id": appointment_id,
                    "patient_id": appt_dict.get("patient_id"),
                    "name": appt_dict.get("patient_name"),
                },
                hospital_id=scoped_id,
            )

            return {
                "success": True,
                "assigned": False,
                "queued": True,
                "error": f"No eligible doctor currently available in {target_dept}. Patient placed in unassigned queue.",
                "department": target_dept,
            }


# ── Administration Helpers ───────────────────────────────────────────────────

def set_doctor_manual_availability(
    doctor_id: int,
    is_available: bool,
    reason: Optional[str] = None,
    actor: Optional[str] = None,
    hospital_id: Optional[int] = None,
) -> bool:
    """Manually toggle doctor availability status (admin override)."""
    scoped_id = hospital_id or resolve_hospital_id()
    manually_unavailable = not is_available
    new_status = "available" if is_available else "unavailable"

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                UPDATE doctors
                SET is_manually_unavailable = ?,
                    manual_unavailable_reason = ?,
                    status = ?
                WHERE id = ? AND (hospital_id = ? OR hospital_id IS NULL)
            """),
            (manually_unavailable, reason or "", new_status, doctor_id, scoped_id),
        )
        conn.commit()
        success = cursor.rowcount > 0

    if success:
        log_audit_event(
            "update_availability",
            "doctors",
            str(doctor_id),
            {"is_available": is_available, "reason": reason, "actor": actor},
        )
    return success


def update_doctor_schedule_config(
    doctor_id: int,
    schedule_data: Dict[str, Any],
    actor: Optional[str] = None,
    hospital_id: Optional[int] = None,
) -> bool:
    """Update a doctor's shift schedule, working days, off days, and workload capacity."""
    scoped_id = hospital_id or resolve_hospital_id()

    working_days = schedule_data.get("working_days")
    if isinstance(working_days, list):
        working_days_json = json.dumps(working_days)
    else:
        working_days_json = '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]'

    weekly_off_days = schedule_data.get("weekly_off_days")
    if isinstance(weekly_off_days, list):
        weekly_off_json = json.dumps(weekly_off_days)
    else:
        weekly_off_json = '["Sunday"]'

    weekly_schedules = schedule_data.get("weekly_schedules")
    if isinstance(weekly_schedules, dict):
        weekly_schedules_json = json.dumps(weekly_schedules)
    else:
        weekly_schedules_json = '{}'

    duty_start = normalize_time_str(schedule_data.get("duty_start_time") or "09:00")
    duty_end = normalize_time_str(schedule_data.get("duty_end_time") or "17:00")
    shift_name = schedule_data.get("shift_name") or "Morning"
    max_workload = int(schedule_data.get("max_workload") or DEFAULT_MAX_WORKLOAD)
    schedule_active = bool(schedule_data.get("schedule_active", True))

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                UPDATE doctors
                SET duty_start_time = ?,
                    duty_end_time = ?,
                    shift_name = ?,
                    working_days = ?,
                    weekly_off_days = ?,
                    weekly_schedules = ?,
                    max_workload = ?,
                    schedule_active = ?
                WHERE id = ? AND (hospital_id = ? OR hospital_id IS NULL)
            """),
            (
                duty_start,
                duty_end,
                shift_name,
                working_days_json,
                weekly_off_json,
                weekly_schedules_json,
                max_workload,
                schedule_active,
                doctor_id,
                scoped_id,
            ),
        )
        conn.commit()
        success = cursor.rowcount > 0

    if success:
        log_audit_event(
            "update_schedule",
            "doctors",
            str(doctor_id),
            {"duty_start": duty_start, "duty_end": duty_end, "shift": shift_name, "actor": actor},
        )
    return success


def get_departments_availability_summary(hospital_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Return an aggregated overview of doctor availability per department."""
    scoped_id = hospital_id or resolve_hospital_id()
    now_dt = get_hospital_now(scoped_id)

    all_docs = get_all_doctor_availabilities(hospital_id=scoped_id, dt=now_dt)

    dept_map: Dict[str, Dict[str, Any]] = {}
    for doc in all_docs:
        dept = doc["department"]
        if dept not in dept_map:
            dept_map[dept] = {
                "department": dept,
                "total_doctors": 0,
                "available_doctors": 0,
                "busy_doctors": 0,
                "offline_doctors": 0,
                "on_leave_doctors": 0,
                "off_duty_doctors": 0,
                "unavailable_doctors": 0,
                "total_capacity": 0,
                "active_patients": 0,
            }
        d_stat = dept_map[dept]
        d_stat["total_doctors"] += 1
        st = doc["status"]
        if st == "available":
            d_stat["available_doctors"] += 1
        elif st == "busy":
            d_stat["busy_doctors"] += 1
        elif st == "offline":
            d_stat["offline_doctors"] += 1
        elif st == "on_leave":
            d_stat["on_leave_doctors"] += 1
        elif st == "off_duty":
            d_stat["off_duty_doctors"] += 1
        else:
            d_stat["unavailable_doctors"] += 1

        d_stat["total_capacity"] += doc["max_workload"]
        d_stat["active_patients"] += doc["current_workload"]

    summary = list(dept_map.values())
    summary.sort(key=lambda x: (x["available_doctors"] > 0, x["department"]))
    return summary


def get_unassigned_queue(hospital_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Return all active patients currently queued waiting for an eligible doctor."""
    scoped_id = hospital_id or resolve_hospital_id()
    today = get_hospital_now(scoped_id).date()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
                SELECT id, patient_id, patient_name, visit_type, department,
                       token_no, status, op_status, appointment_date, created_at,
                       chief_complaint, symptoms
                FROM appointments
                WHERE (doctor_name IS NULL OR TRIM(doctor_name) = '' OR op_status = 'queued')
                  AND status IN ('scheduled', 'checked_in')
                  AND DATE(appointment_date) = DATE(?)
                  AND (hospital_id = ? OR hospital_id IS NULL)
                  AND (deleted_at IS NULL)
                ORDER BY token_no ASC, id ASC
            """),
            (today, scoped_id),
        )
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            for k in ("appointment_date", "created_at"):
                if d.get(k) and hasattr(d[k], "isoformat"):
                    d[k] = d[k].isoformat()
            result.append(d)
        return result
