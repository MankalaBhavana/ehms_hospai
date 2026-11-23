"""Pure clinical calculations. No database or Flask imports: easy to test and audit."""
import re
from typing import Optional

_NUM = re.compile(r"(\d+(?:\.\d+)?)")


def parse_number(value) -> Optional[float]:
    """First number in a lab string such as '1.2 mg/dL', '>60', '45.5'. None if there is none."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = _NUM.search(str(value).replace(",", ""))
    return float(m.group(1)) if m else None


def normalize_sex(value) -> Optional[str]:
    v = str(value or "").strip().lower()
    if v in ("m", "male", "man", "boy"):
        return "male"
    if v in ("f", "female", "woman", "girl"):
        return "female"
    return None


def creatinine_to_mg_dl(value: float, unit: Optional[str]) -> float:
    """Accept mg/dL (default) or umol/L (SI)."""
    u = (unit or "").lower().replace("µ", "u").replace(" ", "")
    if u.startswith("umol") or u.startswith("micromol"):
        return value / 88.4
    return value


def ckd_epi_2021(scr_mg_dl: float, age_years: float, sex: str) -> float:
    """CKD-EPI 2021 creatinine equation (race-free), mL/min/1.73 m2. Adults only."""
    female = sex == "female"
    kappa = 0.7 if female else 0.9
    alpha = -0.241 if female else -0.302
    ratio = scr_mg_dl / kappa
    egfr = 142 * (min(ratio, 1) ** alpha) * (max(ratio, 1) ** -1.200) * (0.9938 ** age_years)
    return egfr * 1.012 if female else egfr


def schwartz_bedside(scr_mg_dl: float, height_cm: float) -> float:
    """Bedside Schwartz equation for children 1-17 y, mL/min/1.73 m2."""
    return 0.413 * height_cm / scr_mg_dl


def estimate_egfr(scr_mg_dl: float, age_years, sex, height_cm=None):
    """Returns (value, method, reason_not_computed). Never guesses missing inputs."""
    if scr_mg_dl is None or scr_mg_dl <= 0:
        return None, None, "creatinine_invalid"
    if age_years is None:
        return None, None, "age_missing"
    if age_years >= 18:
        if sex is None:
            return None, None, "sex_missing"
        return round(ckd_epi_2021(scr_mg_dl, age_years, sex), 1), "CKD-EPI 2021", None
    if age_years >= 1:
        if not height_cm or height_cm <= 0:
            return None, None, "height_missing_for_child"
        return round(schwartz_bedside(scr_mg_dl, height_cm), 1), "Bedside Schwartz", None
    return None, None, "age_under_1_year_not_supported"


_DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)\b", re.I)


def parse_duration_days(text) -> Optional[float]:
    """'7 days' -> 7, '2 weeks' -> 14, '10d' -> 10. A bare number is read as days."""
    if text is None or text == "":
        return None
    if isinstance(text, (int, float)):
        return float(text)
    m = _DURATION.search(str(text))
    if not m:
        n = parse_number(text)
        return n if n is not None and re.fullmatch(r"\s*\d+(\.\d+)?\s*", str(text)) else None
    n, unit = float(m.group(1)), m.group(2).lower()
    if unit.startswith("w"):
        return n * 7
    if unit.startswith("m"):
        return n * 30
    return n
