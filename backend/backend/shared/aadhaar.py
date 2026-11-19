"""Aadhaar numbers: validation, masking and the lookup key.

The full number is never stored. A patient's record keeps
  - `aadhar_hash`   an HMAC-SHA256 of the 12 digits (keyed with a server secret): unique per hospital, the key a returning
                    patient is found by;
  - `aadhar_number` the masked form ("XXXX XXXX 1234") for display and last-4 search.
The 12 digits are only ever held in memory while a request is handled.
"""
import hashlib
import hmac
import os
import re

# Verhoeff checksum tables (the check Aadhaar numbers carry in their 12th digit).
_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 2, 3, 4, 0, 6, 7, 8, 9, 5), (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7), (4, 0, 1, 2, 3, 9, 5, 6, 7, 8), (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2), (7, 6, 5, 9, 8, 2, 1, 0, 4, 3), (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 5, 7, 6, 2, 8, 3, 0, 9, 4), (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7), (9, 4, 5, 3, 1, 2, 6, 8, 7, 0), (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5), (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)

INVALID_MESSAGE = "Enter a valid 12-digit Aadhaar number."


def _verhoeff_ok(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def is_masked(value) -> bool:
    """A value that already is the masked display form (so it is not a new number to validate)."""
    return "x" in str(value or "").lower()


def normalize_aadhaar(value) -> str:
    """The 12 digits of a valid Aadhaar number (spaces and hyphens allowed in the input); ValueError otherwise."""
    text = str(value or "").strip()
    if not re.fullmatch(r"[\d\s-]+", text):
        raise ValueError(INVALID_MESSAGE)
    digits = re.sub(r"\D", "", text)
    if len(digits) != 12 or digits[0] in "01" or not _verhoeff_ok(digits):
        raise ValueError(INVALID_MESSAGE)
    return digits


def mask_aadhaar(digits: str) -> str:
    return f"XXXX XXXX {digits[-4:]}"


def _pepper() -> bytes:
    pepper = os.getenv("AADHAAR_HASH_PEPPER") or os.getenv("SESSION_PEPPER")
    if not pepper:
        raise RuntimeError("AADHAAR_HASH_PEPPER (or SESSION_PEPPER) must be set before Aadhaar numbers can be stored.")
    return pepper.encode()


def aadhaar_hash(digits: str) -> str:
    return hmac.new(_pepper(), digits.encode(), hashlib.sha256).hexdigest()


def make_valid_number(first_eleven: str) -> str:
    """Complete 11 digits with their Verhoeff check digit (used by tests and sample data only)."""
    for check in range(10):
        candidate = f"{first_eleven}{check}"
        if _verhoeff_ok(candidate):
            return candidate
    raise ValueError("no check digit found")
