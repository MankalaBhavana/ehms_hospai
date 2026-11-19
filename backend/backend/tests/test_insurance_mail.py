"""Inbound mail matching: only messages that belong to an insurance case are kept."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from modules.insurance.mail import CASE_TAG, parse_inbound  # noqa: E402

KNOWN = {"<sent-1@hospital.test>": "CLM-2026-E1"}


def _raw(headers, body="hello"):
    return ("\r\n".join(headers) + "\r\n\r\n" + body + "\r\n").encode()


def test_reply_with_case_tag_is_matched():
    rec = parse_inbound(
        _raw(["From: TPA <a@tpa.test>", "Subject: Re: [CLM-2026-E1] Pre-auth", "Message-ID: <r1@tpa.test>", "Content-Type: text/plain"], "Approved. Code AUTH-7."),
        KNOWN,
    )
    assert rec and rec["case_id"] == "CLM-2026-E1"
    assert "AUTH-7" in rec["body"]


def test_reply_threaded_to_a_sent_message_is_matched_without_a_tag():
    rec = parse_inbound(
        _raw(["From: a@tpa.test", "Subject: Re: your request", "Message-ID: <r2@tpa.test>", "In-Reply-To: <sent-1@hospital.test>", "Content-Type: text/html"], "<p>Send <b>discharge summary</b></p>"),
        KNOWN,
    )
    assert rec and rec["case_id"] == "CLM-2026-E1"
    assert rec["body"] == "Send discharge summary"


def test_unrelated_mail_is_ignored_and_never_returned():
    assert parse_inbound(_raw(["From: friend@x.test", "Subject: lunch?", "Message-ID: <z@x>"]), KNOWN) is None


def test_case_tag_pattern():
    assert CASE_TAG.search("Re: [CLM-2026-E12345] Final claim").group(1) == "CLM-2026-E12345"
    assert CASE_TAG.search("no tag here") is None
