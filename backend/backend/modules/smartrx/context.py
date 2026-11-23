"""Build the patient context the safety checks run against, and say what is missing."""
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

import psycopg2

from . import allergy as allergy_mod
from .clinical import (creatinine_to_mg_dl, estimate_egfr, normalize_sex, parse_number)
from .config import ACTIVE_MED_DAYS, LAB_STALE_DAYS, MAX_CURRENT_MEDS
from .knowledge import KnowledgeBase

logger = logging.getLogger(__name__)


@dataclass
class PatientContext:
    patient_found: Optional[bool] = None       # None: no patient_id supplied
    age_years: Optional[float] = None
    sex: Optional[str] = None
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    pregnant: Optional[bool] = None
    lactating: Optional[bool] = None
    current_meds: list = field(default_factory=list)   # [{name, source, date}]
    egfr: Optional[float] = None
    egfr_method: Optional[str] = None
    egfr_source: Optional[str] = None          # request_egfr | request_creatinine | icu_lab_egfr | icu_lab_creatinine
    egfr_measured_at: Optional[str] = None
    egfr_stale: bool = False
    labs: dict = field(default_factory=dict)   # potassium, ...
    allergies: list = field(default_factory=list)
    no_known_allergy: bool = False
    unmapped_allergy_text: list = field(default_factory=list)
    missing: list = field(default_factory=list)

    def summary(self):
        return {
            "patient_found": self.patient_found, "age_years": self.age_years, "sex": self.sex,
            "pregnant": self.pregnant, "lactating": self.lactating, "current_medications_considered": len(self.current_meds), "egfr": self.egfr, "egfr_method": self.egfr_method,
            "egfr_source": self.egfr_source, "egfr_measured_at": self.egfr_measured_at, "egfr_stale": self.egfr_stale,
            "allergies_considered": len(self.allergies), "no_known_allergy": self.no_known_allergy,
            "unmapped_allergy_text": self.unmapped_allergy_text, "missing": self.missing,
        }


def _to_dt(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _age_from(dob, today=None):
    if not dob:
        return None
    if isinstance(dob, str):
        try:
            dob = date.fromisoformat(dob[:10])
        except ValueError:
            return None
    today = today or date.today()
    return round((today - dob).days / 365.25, 1)


def _safe(cur, sql, params):
    try:
        cur.execute(sql, params)
        return cur.fetchall()
    except psycopg2.Error as exc:
        logger.warning("smartrx context query failed: %s", str(exc).splitlines()[0])
        try:
            cur.connection.rollback()
        except Exception:
            pass
        return []


def build(cur, kb: KnowledgeBase, payload: dict, hospital_id) -> PatientContext:
    ctx = PatientContext()
    patient_id = payload.get("patient_id")
    labs_in = payload.get("labs") or {}
    legacy_allergy_text = []

    # ---- demographics from the record (hospital-scoped), overridden by what the caller sent
    if patient_id:
        rows = _safe(cur, """SELECT age, dob, gender, weight, height, pregnant, allergies FROM patients
                             WHERE patient_id = %s AND hospital_id = %s LIMIT 1""", (str(patient_id), hospital_id))
        ctx.patient_found = bool(rows)
        if rows:
            age, dob, gender, weight, height, pregnant, allergies = rows[0]
            ctx.age_years = _age_from(dob) or (float(age) if age is not None else None)
            ctx.sex = normalize_sex(gender)
            ctx.weight_kg = float(weight) if weight else None
            ctx.height_cm = float(height) if height else None
            ctx.pregnant = bool(pregnant) if pregnant is not None else None
            if allergies:
                legacy_allergy_text.append(str(allergies))
            mh = _safe(cur, "SELECT allergies FROM medical_history WHERE patient_id = %s ORDER BY id DESC LIMIT 1", (str(patient_id),))
            if mh and mh[0][0]:
                legacy_allergy_text.append(str(mh[0][0]))
        else:
            ctx.missing.append("patient_not_found_in_this_hospital")

    if payload.get("patient_age") not in (None, ""):
        ctx.age_years = parse_number(payload.get("patient_age"))
    if payload.get("patient_sex"):
        ctx.sex = normalize_sex(payload.get("patient_sex")) or ctx.sex
    if payload.get("patient_weight_kg") not in (None, ""):
        ctx.weight_kg = parse_number(payload.get("patient_weight_kg"))
    if payload.get("patient_height_cm") not in (None, ""):
        ctx.height_cm = parse_number(payload.get("patient_height_cm"))
    if payload.get("pregnant") is not None:
        ctx.pregnant = bool(payload.get("pregnant"))
    if payload.get("lactating") is not None:
        ctx.lactating = bool(payload.get("lactating"))

    # ---- medicines the patient is already on: what the caller lists, plus recent prescriptions in this hospital
    seen_meds = set()

    def add_med(name, source, when=None):
        key = str(name or "").strip().lower()
        if key and key not in seen_meds and len(ctx.current_meds) < MAX_CURRENT_MEDS:
            seen_meds.add(key)
            ctx.current_meds.append({"name": str(name).strip()[:120], "source": source, "date": when})

    for name in payload.get("current_medications") or []:
        add_med(name, "current medication (reported)")
    if patient_id and ctx.patient_found:
        for medicines_json, created in _safe(cur, """SELECT medicines_json, created_at FROM pharmacy_prescriptions
                WHERE patient_id = %s AND hospital_id = %s AND created_at > NOW() - (%s || ' days')::interval
                ORDER BY created_at DESC LIMIT 20""", (str(patient_id), hospital_id, str(ACTIVE_MED_DAYS))):
            try:
                meds = json.loads(medicines_json or "[]")
            except (TypeError, ValueError):
                meds = []
            for m in meds if isinstance(meds, list) else []:
                if isinstance(m, dict):
                    add_med(m.get("name") or m.get("medicine_name"), "recent prescription", created.date().isoformat() if created else None)

    # ---- labs: request first, then the structured ICU results table (the only structured lab store)
    icu = {}
    if patient_id and ctx.patient_found:
        for name, value, unit, created in _safe(cur, """SELECT test_name, value, unit, created_at FROM icu_lab_results
                WHERE patient_id = %s ORDER BY created_at DESC LIMIT 200""", (str(patient_id),)):
            n = (name or "").lower()
            kind = ("egfr" if "egfr" in n or "glomerular" in n else
                    "creatinine" if "creatinine" in n and "clearance" not in n and "ratio" not in n else
                    "potassium" if n.strip() in ("potassium", "serum potassium", "k+", "k", "s. potassium") else None)
            num = parse_number(value)
            if kind and num is not None and kind not in icu:
                icu[kind] = (num, unit, created)

    def stale_flag(dt):
        dt = _to_dt(dt)
        return bool(dt and (datetime.now(timezone.utc) - dt).days > LAB_STALE_DAYS)

    def iso(dt):
        dt = _to_dt(dt)
        return dt.isoformat() if dt else None

    measured_in = labs_in.get("measured_at")
    req_egfr = parse_number(labs_in.get("egfr"))
    req_scr = parse_number(labs_in.get("creatinine"))
    reason = None
    if req_egfr is not None:
        ctx.egfr, ctx.egfr_source, ctx.egfr_method = req_egfr, "request_egfr", "reported"
        ctx.egfr_measured_at, ctx.egfr_stale = iso(measured_in), stale_flag(measured_in)
    elif req_scr is not None:
        ctx.egfr, ctx.egfr_method, reason = estimate_egfr(
            creatinine_to_mg_dl(req_scr, labs_in.get("creatinine_unit")), ctx.age_years, ctx.sex, ctx.height_cm)
        ctx.egfr_source, ctx.egfr_measured_at, ctx.egfr_stale = "request_creatinine", iso(measured_in), stale_flag(measured_in)
    elif "egfr" in icu:
        ctx.egfr, ctx.egfr_source, ctx.egfr_method = icu["egfr"][0], "icu_lab_egfr", "reported"
        ctx.egfr_measured_at, ctx.egfr_stale = iso(icu["egfr"][2]), stale_flag(icu["egfr"][2])
    elif "creatinine" in icu:
        scr = creatinine_to_mg_dl(icu["creatinine"][0], icu["creatinine"][1])
        ctx.egfr, ctx.egfr_method, reason = estimate_egfr(scr, ctx.age_years, ctx.sex, ctx.height_cm)
        ctx.egfr_source, ctx.egfr_measured_at, ctx.egfr_stale = "icu_lab_creatinine", iso(icu["creatinine"][2]), stale_flag(icu["creatinine"][2])
    else:
        ctx.missing.append("renal_function_not_on_record")
    if reason:
        ctx.missing.append(f"egfr_not_computed:{reason}")
        ctx.egfr_source = None
    if labs_in.get("potassium") is not None and parse_number(labs_in.get("potassium")) is not None:
        ctx.labs["potassium"] = parse_number(labs_in.get("potassium"))
    elif "potassium" in icu:
        ctx.labs["potassium"] = icu["potassium"][0]

    # ---- allergies: structured rows + request + legacy free text, de-duplicated
    seen, entries = set(), []

    def add(e):
        k = (e.kind, e.code or e.text.lower())
        if k not in seen:
            seen.add(k)
            entries.append(e)

    for item in payload.get("allergies_structured") or []:
        if isinstance(item, dict) and (item.get("text") or item.get("code")):
            e = allergy_mod.AllergyEntry(
                item.get("kind") if item.get("kind") in ("substance", "class") else "unmapped",
                item.get("code"), str(item.get("text") or item.get("code"))[:300],
                item.get("reaction"), item.get("severity") if item.get("severity") in ("mild", "moderate", "severe") else "unknown",
                "request")
            if e.kind != "unmapped" and not e.code:
                e = allergy_mod.resolve_allergen(e.text, kb)
            add(e)
    if patient_id and ctx.patient_found:
        for e in allergy_mod.load_structured(cur, hospital_id, patient_id):
            add(e)
    texts = [payload.get("patient_allergies")] if payload.get("patient_allergies") else legacy_allergy_text
    for t in texts:
        parsed, none_known = allergy_mod.parse_free_text(t, kb)
        ctx.no_known_allergy = ctx.no_known_allergy or none_known
        for e in parsed:
            add(e)
    ctx.allergies = entries
    ctx.unmapped_allergy_text = [e.text for e in entries if e.kind == "unmapped"]
    if not entries and not ctx.no_known_allergy:
        ctx.missing.append("allergy_status_not_recorded")
    return ctx
