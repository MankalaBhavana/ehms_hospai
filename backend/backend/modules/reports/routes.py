from core.export import generate_pdf, generate_word
from core.storage import ObjectStorage
from flask import Blueprint, jsonify, request, g, send_file
from werkzeug.exceptions import BadRequest
import os
import io
import csv
import uuid
import time
from datetime import datetime
from io import BytesIO

from shared.session_auth import require_permissions
from shared.audit import log_audit_event
from shared.responses import (
    row_to_dict,
    rows_to_dicts,
    validate_required_fields,
)
from shared.hospital import current_hospital_id
from shared.reports import build_reports_export_text

from utils.database import get_reports_overview

reports_bp = Blueprint("reports", __name__)


@reports_bp.get("/api/reports/overview")
@require_permissions("reports.read")
def reports_overview():
    return jsonify(get_reports_overview(hospital_id=current_hospital_id()))


@reports_bp.get("/api/reports/export/csv")
@require_permissions("reports.read")
def reports_export_csv():
    overview = get_reports_overview(hospital_id=current_hospital_id())
    csv_stream = io.StringIO()
    writer = csv.writer(csv_stream)
    writer.writerow(["section", "label", "value"])
    writer.writerow(
        ["billing", "total_billed", overview["billing_summary"]["total_billed"]]
    )
    writer.writerow(
        ["billing", "total_collected", overview["billing_summary"]["total_collected"]]
    )
    writer.writerow(["billing", "total_due", overview["billing_summary"]["total_due"]])
    writer.writerow(
        ["accounts", "net_position", overview["accounts_summary"]["net_position"]]
    )
    writer.writerow(
        [
            "operations",
            "monthly_op",
            overview["hospital_summary"]["ip_op_counts"]["monthly_op"],
        ]
    )
    writer.writerow(
        [
            "operations",
            "monthly_ip",
            overview["hospital_summary"]["ip_op_counts"]["monthly_ip"],
        ]
    )
    writer.writerow(
        ["operations", "average_los_days", overview["alos_summary"]["average_los_days"]]
    )
    for row in overview.get("clinic_income", []):
        writer.writerow(["clinic_income", row["label"], row["count"]])
    for row in overview.get("discount_by_module", []):
        writer.writerow(["discount_by_module", row["label"], row["count"]])
    for row in overview.get("payment_status_breakdown", []):
        writer.writerow(["payment_status", row["label"], row["count"]])

    payload = io.BytesIO(csv_stream.getvalue().encode("utf-8"))
    payload.seek(0)
    return send_file(
        payload,
        mimetype="text/csv",
        as_attachment=True,
        download_name="reports-overview.csv",
    )


@reports_bp.get("/api/reports/export/pdf")
@require_permissions("reports.read")
def reports_export_pdf():
    overview = get_reports_overview(hospital_id=current_hospital_id())
    pdf_bytes = generate_pdf(
        "Hospital Operations",
        "reports_overview",
        build_reports_export_text(overview),
        datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="reports-overview.pdf",
    )


@reports_bp.get("/api/reports/export/word")
@require_permissions("reports.read")
def reports_export_word():
    overview = get_reports_overview(hospital_id=current_hospital_id())
    word_bytes = generate_word(
        "Hospital Operations",
        "reports_overview",
        build_reports_export_text(overview),
        datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    return send_file(
        io.BytesIO(word_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name="reports-overview.docx",
    )


# Only tables that exist in the schema. OP visits are rows in `appointments` (visit_type = 'OP').
_REPORT_TABLES = {
    "op": "appointments",
    "appointments": "appointments",
    "inpatient": "admissions",
    "admissions": "admissions",
    "er": "er_visits",
    "pharmacy": "pharmacy_inventory",
    "beds": "bed_master",
}


def _pct_delta(current: int, previous: int):
    """30-day change vs the prior 30 days, from real counts; None when there is no baseline."""
    if not previous:
        return None
    change = (current - previous) * 100 / previous
    return f"{change:+.0f}%"



@reports_bp.get("/api/reports/<report_type>")
@require_permissions("reports.read")
def get_dynamic_report(report_type: str):
    """Dynamic reporting endpoint returning structured ReportPayload for any report type."""
    from utils.database import get_connection
    clean_key = report_type.lower().replace("reports_", "").replace("report_", "")
    scoped_hospital_id = current_hospital_id()
    limit = int(request.args.get("limit", 50))
    page = int(request.args.get("page", 1))
    offset = (page - 1) * limit
    search = (request.args.get("search") or "").strip().lower()

    records = []
    total = 0
    kpis = []
    summary = {}
    charts = {}

    with get_connection() as conn:
        cursor = conn.cursor()
        if clean_key in ("patients", "overview"):
            cursor.execute(
                """
                SELECT id, patient_id AS umr, TRIM(name || ' ' || COALESCE(last_name, '')) AS name, age, gender, phone,
                       created_at AS registration_date
                FROM patients
                WHERE hospital_id = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (scoped_hospital_id, limit, offset),
            )
            records = [dict(r) for r in cursor.fetchall()]
            cursor.execute("SELECT COUNT(*) as count FROM patients WHERE hospital_id = ?", (scoped_hospital_id,))
            row = cursor.fetchone()
            total = row["count"] if row else len(records)
            cursor.execute(
                """
                SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS cur30,
                       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days'
                                          AND created_at < NOW() - INTERVAL '30 days') AS prev30
                FROM patients WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
            trend = cursor.fetchone()
            cur30 = int(trend["cur30"] or 0) if trend else 0
            prev30 = int(trend["prev30"] or 0) if trend else 0
            active = total
            kpis = [
                {"id": "total_patients", "label": "Total Patients", "value": total, "unit": "count", "delta": _pct_delta(cur30, prev30), "status": "neutral"},
                {"id": "active_patients", "label": "Active Patients", "value": active, "unit": "count", "delta": None, "status": "neutral"},
            ]
        elif clean_key in ("revenue", "billing"):
            cursor.execute(
                """
                SELECT invoice_no, patient_id, patient_name, module, total_amount, paid_amount, due_amount, payment_status, created_at
                FROM invoices
                WHERE hospital_id = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (scoped_hospital_id, limit, offset),
            )
            records = [dict(r) for r in cursor.fetchall()]
            cursor.execute(
                """
                SELECT COALESCE(SUM(total_amount), 0) as total_billed,
                       COALESCE(SUM(paid_amount), 0) as total_paid,
                       COALESCE(SUM(due_amount), 0) as total_due,
                       COUNT(*) as count
                FROM invoices WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
            rev_row = cursor.fetchone()
            total = rev_row["count"] if rev_row else len(records)
            tb = float(rev_row["total_billed"] if rev_row else 0)
            tp = float(rev_row["total_paid"] if rev_row else 0)
            td = float(rev_row["total_due"] if rev_row else 0)
            kpis = [
                {"id": "total_billed", "label": "Total Billed", "value": f"₹{int(tb):,}", "unit": "currency", "delta": None, "status": "positive"},
                {"id": "total_collected", "label": "Total Collected", "value": f"₹{int(tp):,}", "unit": "currency", "delta": None, "status": "positive"},
                {"id": "total_due", "label": "Outstanding Due", "value": f"₹{int(td):,}", "unit": "currency", "delta": None, "status": "neutral"},
            ]
        elif clean_key == "doctors":
            cursor.execute(
                """
                SELECT id, doctor_name, department, specialty, consultation_fee, status, email, phone
                FROM doctors
                WHERE (hospital_id = ? OR hospital_id IS NULL)
                ORDER BY doctor_name ASC
                LIMIT ? OFFSET ?
                """,
                (scoped_hospital_id, limit, offset),
            )
            records = [dict(r) for r in cursor.fetchall()]
            total = len(records)
            kpis = [
                {"id": "total_doctors", "label": "Active Doctors", "value": total, "unit": "count", "delta": None, "status": "positive"},
            ]
        else:
            # Fixed report -> table map; nothing from the URL is ever used as an identifier.
            table_name = _REPORT_TABLES.get(clean_key)
            if table_name is None:
                return jsonify({"error": "unsupported report type"}), 400
            cursor.execute(
                f"SELECT * FROM {table_name} WHERE (hospital_id = ? OR hospital_id IS NULL) LIMIT ? OFFSET ?",
                (scoped_hospital_id, limit, offset),
            )
            records = [dict(r) for r in cursor.fetchall()]
            total = len(records)

    total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1
    return jsonify({
        "summary": summary,
        "kpis": kpis,
        "charts": charts,
        "records": records,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": total_pages,
        }
    })
