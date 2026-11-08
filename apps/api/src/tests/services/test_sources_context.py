"""Tests for the two-stage distill-then-build pipeline (courseplanning.py).

Covers ``summarize_source`` and ``build_sources_context`` in isolation by
monkeypatching the LLM boundary so no network is touched.
"""

import src.services.ai.courseplanning as cp


async def _no_visuals(url, language, max_frames=6):
    return ""


async def test_build_sources_context_contains_titles_urls_and_summaries(monkeypatch):
    async def fake_summarize(kind, title, url, text, language, model_name):
        return f"SUMMARY[{title}]"

    monkeypatch.setattr(cp, "summarize_source", fake_summarize)
    monkeypatch.setattr(cp, "describe_video_visuals", _no_visuals)

    sources = [
        {"kind": "youtube", "title": "Lecture One", "url": "https://youtube.com/watch?v=1", "text": "raw one"},
        {"kind": "article", "title": "Article Two", "url": "https://example.com/a", "text": "raw two"},
    ]

    out = await cp.build_sources_context(sources, "en", "test-model")

    assert "=== DISTILLED SOURCE NOTES (many videos + articles) ===" in out
    assert "--- youtube | Lecture One | https://youtube.com/watch?v=1 ---" in out
    assert "SUMMARY[Lecture One]" in out
    assert "--- article | Article Two | https://example.com/a ---" in out
    assert "SUMMARY[Article Two]" in out


async def test_build_sources_context_falls_back_to_raw_text_on_failure(monkeypatch):
    async def fake_summarize(kind, title, url, text, language, model_name):
        return ""

    monkeypatch.setattr(cp, "summarize_source", fake_summarize)
    monkeypatch.setattr(cp, "describe_video_visuals", _no_visuals)

    sources = [
        {
            "kind": "youtube",
            "title": "Dead Video",
            "url": "https://youtube.com/watch?v=dead",
            "text": "some raw transcript text here",
        },
    ]

    out = await cp.build_sources_context(sources, "en", "test-model")

    assert "[summary failed]" in out
    assert "some raw transcript text here" in out
    assert "Dead Video" in out


async def test_build_sources_context_returns_empty_for_no_sources():
    assert await cp.build_sources_context([], "en", "test-model") == ""


async def test_build_sources_context_calls_on_sources_with_source_infos(monkeypatch):
    async def fake_summarize(kind, title, url, text, language, model_name):
        return f"SUMMARY[{title}]"

    monkeypatch.setattr(cp, "summarize_source", fake_summarize)
    monkeypatch.setattr(cp, "describe_video_visuals", _no_visuals)

    sources = [
        {"kind": "youtube", "title": "Lecture One", "url": "https://youtube.com/watch?v=1", "text": "raw one"},
        {"kind": "article", "title": "Article Two", "url": "https://example.com/a", "text": "raw two"},
    ]

    captured = []
    out = await cp.build_sources_context(
        sources, "en", "test-model", on_sources=captured.append
    )

    assert len(captured) == 1
    infos = captured[0]
    assert [(s.kind, s.title, s.url, s.summary) for s in infos] == [
        ("youtube", "Lecture One", "https://youtube.com/watch?v=1", "SUMMARY[Lecture One]"),
        ("article", "Article Two", "https://example.com/a", "SUMMARY[Article Two]"),
    ]
    assert "=== DISTILLED SOURCE NOTES (many videos + articles) ===" in out


async def test_build_sources_context_on_sources_falls_back_to_raw_text(monkeypatch):
    async def fake_summarize(kind, title, url, text, language, model_name):
        return ""

    monkeypatch.setattr(cp, "summarize_source", fake_summarize)
    monkeypatch.setattr(cp, "describe_video_visuals", _no_visuals)

    sources = [
        {"kind": "youtube", "title": "Dead Video", "url": "https://youtube.com/watch?v=dead", "text": "some raw transcript text here"},
    ]

    captured = []
    await cp.build_sources_context(sources, "en", "test-model", on_sources=captured.append)

    infos = captured[0]
    assert len(infos) == 1
    assert infos[0].summary.startswith("[summary failed] some raw transcript text here")


async def test_build_sources_context_on_sources_exception_is_swallowed(monkeypatch):
    async def fake_summarize(kind, title, url, text, language, model_name):
        return "ok"

    monkeypatch.setattr(cp, "summarize_source", fake_summarize)
    monkeypatch.setattr(cp, "describe_video_visuals", _no_visuals)

    sources = [
        {"kind": "youtube", "title": "V", "url": "https://youtube.com/watch?v=1", "text": "raw"},
    ]

    def boom(infos):
        raise RuntimeError("boom")

    out = await cp.build_sources_context(sources, "en", "test-model", on_sources=boom)

    assert "=== DISTILLED SOURCE NOTES (many videos + articles) ===" in out


async def test_summarize_source_calls_generate_and_caps(monkeypatch):
    captured = {}

    async def fake_generate(**kwargs):
        captured.update(kwargs)
        return "x" * 3000

    monkeypatch.setattr(cp, "generate", fake_generate)

    result = await cp.summarize_source("youtube", "T", "http://u", "body", "ru", "m")

    assert len(result) == 2500
    assert captured["model_name"] == "m"
    assert captured["max_tokens"] == 1500
    assert captured["temperature"] == 0.2
    assert captured["timeout"] == 180
    assert captured["system_prompt"].startswith(
        "Distill ONE lecture/article into concise study notes in Russian:"
    )
    assert "KIND: youtube" in captured["user_prompt"]
    assert "TITLE: T" in captured["user_prompt"]
    assert "URL: http://u" in captured["user_prompt"]
    assert "TEXT:\nbody" in captured["user_prompt"]


async def test_summarize_source_returns_empty_on_failure(monkeypatch):
    async def fake_generate(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(cp, "generate", fake_generate)

    assert await cp.summarize_source("youtube", "T", "http://u", "body", "en", "m") == ""
