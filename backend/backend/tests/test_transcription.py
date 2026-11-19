"""Speech-to-text on the server: it reports whether it can transcribe (the web app falls back to the browser's speech
service when it cannot), the hospital's drug / test names reach Whisper as a prompt, and the route is protected."""
import os
import sys
import types

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

from ai.whisper_provider import WhisperTranscriptionProvider  # noqa: E402


def test_status_reports_availability_without_loading_a_model():
    status = WhisperTranscriptionProvider().status()
    assert set(status) == {"available", "model", "device"}
    assert isinstance(status["available"], bool)


def test_the_hospital_term_list_is_passed_to_whisper_as_the_prompt(monkeypatch):
    seen = {}

    class FakeSegment:
        text = " BP 120/80 "

    class FakeModel:
        def transcribe(self, path, **kwargs):
            seen.update(kwargs)
            return [FakeSegment()], None

    provider = WhisperTranscriptionProvider()
    provider._model = FakeModel()
    text = provider.transcribe(b"audio", filename="a.webm", language="en", prompt="Paracetamol, Amoxicillin, Troponin")
    assert text == "BP 120/80"
    assert seen["initial_prompt"] == "Paracetamol, Amoxicillin, Troponin"
    assert seen["language"] == "en"
    assert seen["temperature"] == 0.0  # the same audio must give the same note twice


def test_the_prompt_is_capped_and_optional(monkeypatch):
    seen = {}

    class FakeModel:
        def transcribe(self, path, **kwargs):
            seen.update(kwargs)
            return [], None

    provider = WhisperTranscriptionProvider()
    provider._model = FakeModel()
    provider.transcribe(b"x", filename="a.webm", language="te", prompt="x" * 5000)
    assert len(seen["initial_prompt"]) == 600
    provider.transcribe(b"x", filename="a.webm", language="te")
    assert seen["initial_prompt"] is None


def test_transcribe_routes_are_behind_the_clinical_write_permission():
    src = open(os.path.join(ROOT, "modules", "ai_exports", "routes.py"), encoding="utf-8").read()
    for route in ('"/api/ai/transcribe"', '"/api/ai/transcribe/status"'):
        i = src.index(route)
        assert "require_permissions(\"patients.clinical.write\")" in src[i : i + 120], route
