"""Tests for auto-YouTube search injection in courseplanning.py.

The feature derives a search query from a bare prompt and appends a
``youtube_search`` attachment when the user supplied no explicit web source, so
a plain prompt ("Хочу курс деревьев решений") pulls real lectures instead of
relying on general knowledge alone.

All tests are offline: the LLM stream, the material-context builder and session
persistence are monkeypatched so no network or Redis is touched.
"""

from types import SimpleNamespace

import src.services.ai.courseplanning as cp
from src.services.ai.schemas.courseplanning import AttachmentData


def test_derive_search_query_strips_russian_lead_ins():
    assert cp._derive_search_query("Хочу курс деревьев решений") == "деревьев решений"


def test_derive_search_query_strips_english_lead_ins():
    assert cp._derive_search_query("Create a course about Python") == "Python"


def test_derive_search_query_blank_prompt_returns_empty():
    # Documented behavior: an all-whitespace prompt yields "" (not the trimmed
    # prompt, which would also be "").
    assert cp._derive_search_query("   ") == ""


def test_derive_search_query_strips_multiple_lead_ins():
    assert (
        cp._derive_search_query("Пожалуйста хочу курс деревьев решений")
        == "деревьев решений"
    )


def test_derive_search_query_strips_kurs_po():
    assert cp._derive_search_query("Курс по машинному обучению") == "машинному обучению"


def test_derive_search_query_caps_at_120_chars():
    result = cp._derive_search_query("хочу курс " + "тема " * 40)
    assert len(result) == 120


def test_auto_youtube_enabled_true_by_default(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_AI_AUTO_YOUTUBE", raising=False)
    assert cp._auto_youtube_enabled() is True


def test_auto_youtube_enabled_respects_false_values(monkeypatch):
    for value in ("false", "FALSE", "0", "no", "OFF"):
        monkeypatch.setenv("LEARNHOUSE_AI_AUTO_YOUTUBE", value)
        assert cp._auto_youtube_enabled() is False


def test_auto_youtube_enabled_true_for_other_values(monkeypatch):
    for value in ("true", "1", "yes", "on", "banana"):
        monkeypatch.setenv("LEARNHOUSE_AI_AUTO_YOUTUBE", value)
        assert cp._auto_youtube_enabled() is True


def _make_session(language: str = "ru") -> cp.CoursePlanningSessionData:
    return cp.CoursePlanningSessionData(session_uuid="cp_test", org_id=1, language=language)


def _patch_offline(monkeypatch, captured) -> None:
    async def fake_build_attachment_context(
        attachments, language, model_name, on_progress=None, on_sources=None
    ):
        captured["attachments"] = list(attachments)
        return ""

    async def fake_generate_stream(**kwargs):
        if False:  # pragma: no cover - makes this an async generator
            yield ""

    monkeypatch.setattr(cp, "build_attachment_context", fake_build_attachment_context)
    monkeypatch.setattr(cp, "generate_stream", fake_generate_stream)
    monkeypatch.setattr(cp, "save_course_planning_session", lambda session: True)
    monkeypatch.setattr(
        cp,
        "get_learnhouse_config",
        lambda: SimpleNamespace(ai_config=SimpleNamespace(provider="deepseek")),
    )


async def _drain(generator):
    async for _ in generator:
        pass


async def test_stream_injects_youtube_search_when_no_source(monkeypatch):
    captured = {}
    _patch_offline(monkeypatch, captured)
    monkeypatch.setenv("LEARNHOUSE_AI_AUTO_YOUTUBE", "true")

    await _drain(
        cp.generate_course_plan_stream("Хочу курс деревьев решений", _make_session())
    )

    assert captured["attachments"] == [
        AttachmentData(type="youtube_search", name="деревьев решений")
    ]


async def test_stream_keeps_explicit_source_and_does_not_inject(monkeypatch):
    captured = {}
    _patch_offline(monkeypatch, captured)
    monkeypatch.setenv("LEARNHOUSE_AI_AUTO_YOUTUBE", "true")

    explicit = AttachmentData(
        type="youtube", name="Лекция", url="https://youtube.com/watch?v=abc"
    )
    await _drain(
        cp.generate_course_plan_stream(
            "Хочу курс деревьев решений", _make_session(), attachments=[explicit]
        )
    )

    assert captured["attachments"] == [explicit]


async def test_stream_does_not_inject_when_disabled(monkeypatch):
    captured = {}
    _patch_offline(monkeypatch, captured)
    monkeypatch.setenv("LEARNHOUSE_AI_AUTO_YOUTUBE", "false")

    await _drain(
        cp.generate_course_plan_stream("Хочу курс деревьев решений", _make_session())
    )

    # With the flag off and no explicit attachments, the material-context
    # builder is never invoked, so nothing was injected.
    assert captured == {}
