"""Turn a prescription line (strength, dosage, frequency) into mg per dose / per day. Pure functions.

Nothing is guessed silently: every assumption is recorded in ``assumptions`` and a result that cannot be
estimated returns None for the affected figure.
"""
import re
from dataclasses import dataclass, field
from typing import Optional

_MASS = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|µg|g|gm)\b(?!\s*/)", re.I)
_TO_MG = {"mg": 1.0, "g": 1000.0, "gm": 1000.0, "mcg": 0.001, "ug": 0.001, "µg": 0.001}
_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?|½)\s*-\s*(\d+(?:\.\d+)?|½)\s*-\s*(\d+(?:\.\d+)?|½)(?:\s*-\s*(\d+(?:\.\d+)?|½))?\s*$")
_UNITS = re.compile(r"(\d+(?:\.\d+)?|one|two|three|four|half|½)\s*(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|puff|puffs|pill|pills)?\b", re.I)
_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "half": 0.5, "½": 0.5}


@dataclass
class DoseEstimate:
    mg_per_unit: Optional[float] = None
    single_mg: Optional[float] = None
    doses_per_day: Optional[float] = None      # None: unknown or as-needed
    daily_mg: Optional[float] = None
    doses_per_week: Optional[float] = None
    as_needed: bool = False
    assumptions: list = field(default_factory=list)


def _num(token):
    t = str(token).lower()
    return _WORDS[t] if t in _WORDS else float(t)


def mg_per_unit(*texts) -> Optional[float]:
    """First plain mass strength (not a concentration like 5 mg/5 ml) found in the given texts, in mg."""
    for text in texts:
        for m in _MASS.finditer(str(text or "")):
            return float(m.group(1)) * _TO_MG[m.group(2).lower()]
    return None


def parse_frequency(text):
    """Return (doses_per_day, doses_per_week, as_needed, units_pattern). Unknown -> (None, None, False, None)."""
    t = str(text or "").strip().lower()
    if not t:
        return None, None, False, None
    pat = _PATTERN.match(t)
    if pat:
        parts = [_num(p) for p in pat.groups() if p]
        return float(sum(1 for p in parts if p > 0)), None, False, parts
    if re.search(r"\b(sos|prn|as needed|as required|when required)\b", t):
        return None, None, True, None
    if re.search(r"\b(weekly|once a week|once weekly|1/week|ow)\b", t):
        return 1 / 7, 1.0, False, None
    if re.search(r"\b(alternate day|every other day|eod)\b", t):
        return 0.5, None, False, None
    m = re.search(r"\bq\s*(\d+)\s*h\b|every\s*(\d+)\s*hours?|(\d+)\s*hourly", t)
    if m:
        hours = float(next(g for g in m.groups() if g))
        return (24 / hours if hours else None), None, False, None
    table = [(r"\b(qid|qds|four times|4 times)\b", 4), (r"\b(tds|tid|thrice|three times|3 times)\b", 3),
             (r"\b(bd|bid|twice|two times|2 times)\b", 2),
             (r"\b(od|qd|daily|once|1 time|hs|at night|bedtime|morning|nocte|stat)\b", 1)]
    for pattern, n in table:
        if re.search(pattern, t):
            return float(n), None, False, None
    return None, None, False, None


def estimate(strength, dosage, frequency, resolved_strengths=()) -> DoseEstimate:
    est = DoseEstimate()
    est.mg_per_unit = mg_per_unit(strength, *resolved_strengths)
    per_day, per_week, as_needed, pattern = parse_frequency(frequency)
    if per_day is None and not as_needed and pattern is None:
        # frequency sometimes arrives inside the dosage text ("1 tab BD")
        per_day, per_week, as_needed, pattern = parse_frequency(dosage)
    est.as_needed = as_needed

    explicit_mg = mg_per_unit(dosage)
    units = None
    if explicit_mg is not None:
        est.single_mg = explicit_mg
    elif est.mg_per_unit is not None:
        if pattern:
            units = max(pattern)
        else:
            m = _UNITS.search(str(dosage or ""))
            units = _num(m.group(1)) if m else None
        if units is None:
            units = 1.0
            est.assumptions.append("one unit per dose assumed")
        est.single_mg = est.mg_per_unit * units

    est.doses_per_day = per_day
    est.doses_per_week = per_week if per_week is not None else (per_day * 7 if per_day is not None else None)
    if est.single_mg is not None and per_day is not None:
        if pattern:  # "1-0-1": add up the actual units, not max*count
            est.daily_mg = (est.mg_per_unit or est.single_mg) * sum(pattern) if explicit_mg is None else est.single_mg * per_day
        else:
            est.daily_mg = est.single_mg * per_day
    return est
