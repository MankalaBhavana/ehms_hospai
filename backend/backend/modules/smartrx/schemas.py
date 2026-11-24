"""Request validation. Hand-rolled to avoid a new dependency; every limit is explicit."""
from .config import MAX_ITEMS_PER_EVALUATION

MAX_TEXT = 300
SEVERITIES = ("critical", "warning", "info")


class ValidationError(ValueError):
    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


def _text(value, field, required=False, limit=MAX_TEXT):
    if value is None or value == "":
        if required:
            raise ValidationError(f"{field} is required", field)
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValidationError(f"{field} must be text", field)
    s = str(value).strip()
    if len(s) > limit:
        raise ValidationError(f"{field} is longer than {limit} characters", field)
    return s


def validate_evaluate(payload):
    if not isinstance(payload, dict):
        raise ValidationError("JSON object expected")
    items = payload.get("items")
    if items is None:
        items = []
    if not isinstance(items, list):
        raise ValidationError("items must be a list", "items")
    if len(items) > MAX_ITEMS_PER_EVALUATION:
        raise ValidationError(f"at most {MAX_ITEMS_PER_EVALUATION} items per evaluation", "items")

    clean_items = []
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise ValidationError(f"items[{i}] must be an object", f"items[{i}]")
        name = _text(it.get("medicine") or it.get("name"), f"items[{i}].medicine", required=True)
        clean_items.append({
            "medicine": name,
            "strength": _text(it.get("strength"), f"items[{i}].strength", limit=60),
            "route": _text(it.get("route"), f"items[{i}].route", limit=40),
            "dosage_form": _text(it.get("dosage_form") or it.get("form"), f"items[{i}].dosage_form", limit=60),
            "duration": _text(it.get("duration"), f"items[{i}].duration", limit=40),
            "dosage": _text(it.get("dosage"), f"items[{i}].dosage", limit=80),
            "frequency": _text(it.get("frequency"), f"items[{i}].frequency", limit=40),
        })

    labs = payload.get("labs") or {}
    if not isinstance(labs, dict):
        raise ValidationError("labs must be an object", "labs")
    structured = payload.get("allergies_structured") or []
    if not isinstance(structured, list) or len(structured) > 50:
        raise ValidationError("allergies_structured must be a list of at most 50 entries", "allergies_structured")

    current_meds = payload.get("current_medications") or []
    if not isinstance(current_meds, list) or len(current_meds) > 40:
        raise ValidationError("current_medications must be a list of at most 40 names", "current_medications")
    current_meds = [_text(m, "current_medications[]", limit=120) for m in current_meds if m]

    return {
        "patient_id": _text(payload.get("patient_id"), "patient_id", limit=60),
        "encounter_id": _text(payload.get("encounter_id"), "encounter_id", limit=60),
        "patient_allergies": _text(payload.get("patient_allergies"), "patient_allergies", limit=2000),
        "patient_age": _text(payload.get("patient_age"), "patient_age", limit=10),
        "patient_sex": _text(payload.get("patient_sex"), "patient_sex", limit=10),
        "patient_weight_kg": _text(payload.get("patient_weight_kg"), "patient_weight_kg", limit=10),
        "patient_height_cm": _text(payload.get("patient_height_cm"), "patient_height_cm", limit=10),
        "pregnant": payload.get("pregnant") if isinstance(payload.get("pregnant"), bool) else None,
        "lactating": payload.get("lactating") if isinstance(payload.get("lactating"), bool) else None,
        "current_medications": current_meds,
        "labs": {k: labs.get(k) for k in ("egfr", "creatinine", "creatinine_unit", "potassium", "measured_at") if k in labs},
        "allergies_structured": structured,
        "items": clean_items,
    }


def validate_allergy(payload):
    if not isinstance(payload, dict):
        raise ValidationError("JSON object expected")
    text = _text(payload.get("text") or payload.get("allergen"), "text", required=True)
    severity = (payload.get("severity") or "unknown")
    if severity not in ("mild", "moderate", "severe", "unknown"):
        raise ValidationError("severity must be mild, moderate, severe or unknown", "severity")
    return {"text": text, "reaction": _text(payload.get("reaction"), "reaction"), "severity": severity}


OVERRIDE_REASONS = ("benefit_outweighs_risk", "already_tolerating", "no_alternative", "dose_adjusted", "monitoring_planned", "other")


def validate_override(payload):
    if not isinstance(payload, dict):
        raise ValidationError("JSON object expected")
    reason = payload.get("reason_code")
    if reason not in OVERRIDE_REASONS:
        raise ValidationError(f"reason_code must be one of {', '.join(OVERRIDE_REASONS)}", "reason_code")
    text = _text(payload.get("reason_text"), "reason_text", limit=500)
    if reason == "other" and (not text or len(text) < 5):
        raise ValidationError("please describe the reason (at least 5 characters)", "reason_text")
    return {
        "patient_id": _text(payload.get("patient_id"), "patient_id", required=True, limit=60),
        "encounter_id": _text(payload.get("encounter_id"), "encounter_id", limit=60),
        "alert_id": _text(payload.get("alert_id"), "alert_id", required=True, limit=160),
        "check": _text(payload.get("check"), "check", limit=30),
        "severity": payload.get("severity") if payload.get("severity") in SEVERITIES else None,
        "drug_name": _text(payload.get("drug_name"), "drug_name", limit=300),
        "rule_set_version": _text(payload.get("rule_set_version"), "rule_set_version", limit=40),
        "reason_code": reason,
        "reason_text": text,
    }
