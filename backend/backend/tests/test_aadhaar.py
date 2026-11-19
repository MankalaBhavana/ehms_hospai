"""Aadhaar identity key: validation (Verhoeff), masking and the keyed hash. No full number is ever kept."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import aadhaar as aad  # noqa: E402

VALID = aad.make_valid_number("23456789012")  # 12 digits, starts with 2, correct check digit


def test_made_up_valid_number_passes():
    assert len(VALID) == 12 and VALID[0] == "2"
    assert aad.normalize_aadhaar(VALID) == VALID


def test_spaces_and_hyphens_are_accepted():
    grouped = f"{VALID[:4]} {VALID[4:8]} {VALID[8:]}"
    assert aad.normalize_aadhaar(grouped) == VALID
    assert aad.normalize_aadhaar(f"{VALID[:4]}-{VALID[4:8]}-{VALID[8:]}") == VALID


@pytest.mark.parametrize("bad", ["", "1234", "12345678901", "1234567890123", "abcdefghijkl", "0" * 12, "1" * 12, "2345 6789 01x2"])
def test_wrong_length_letters_or_leading_zero_one_are_rejected(bad):
    with pytest.raises(ValueError):
        aad.normalize_aadhaar(bad)


def test_a_mistyped_digit_fails_the_checksum():
    wrong = VALID[:-1] + str((int(VALID[-1]) + 1) % 10)
    with pytest.raises(ValueError):
        aad.normalize_aadhaar(wrong)
    swapped = VALID[:3] + VALID[4] + VALID[3] + VALID[5:]
    if swapped != VALID:
        with pytest.raises(ValueError):
            aad.normalize_aadhaar(swapped)


def test_masked_form_shows_only_the_last_four():
    assert aad.mask_aadhaar(VALID) == f"XXXX XXXX {VALID[-4:]}"
    assert VALID[:8] not in aad.mask_aadhaar(VALID)
    assert aad.is_masked(aad.mask_aadhaar(VALID)) and not aad.is_masked(VALID)


def test_hash_is_stable_keyed_and_not_the_number(monkeypatch):
    monkeypatch.setenv("AADHAAR_HASH_PEPPER", "pepper-one")
    a = aad.aadhaar_hash(VALID)
    assert a == aad.aadhaar_hash(VALID) and len(a) == 64 and VALID not in a
    monkeypatch.setenv("AADHAAR_HASH_PEPPER", "pepper-two")
    assert aad.aadhaar_hash(VALID) != a  # a different secret gives a different key


def test_storing_needs_a_server_secret(monkeypatch):
    monkeypatch.delenv("AADHAAR_HASH_PEPPER", raising=False)
    monkeypatch.delenv("SESSION_PEPPER", raising=False)
    with pytest.raises(RuntimeError):
        aad.aadhaar_hash(VALID)


def test_patient_rows_sent_to_clients_never_carry_the_key():
    from shared.responses import row_to_dict

    out = row_to_dict({"patient_id": "PAT-1", "aadhar_number": "XXXX XXXX 1234", "aadhar_hash": "abc"})
    assert "aadhar_hash" not in out and out["aadhar_number"] == "XXXX XXXX 1234"


def test_audit_trail_never_logs_an_aadhaar_number():
    from shared.audit import redact_secrets

    assert redact_secrets({"patient": {"aadhar_number": VALID, "name": "x"}})["patient"]["aadhar_number"] == "[redacted]"
