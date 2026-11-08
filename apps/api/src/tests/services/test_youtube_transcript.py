"""Tests for src/services/ai/youtube_transcript.py (YouTube search/transcripts)."""

import src.services.ai.youtube_transcript as yt

VTT = """WEBVTT
Kind: captions
Language: ru

00:00:00.000 --> 00:00:05.000
<c>Привет</c> мир

00:00:05.000 --> 00:00:10.000
<00:00:05.000>Начинаем</00:00:07.000> лекцию

00:00:10.000 --> 00:00:15.000
лекцию

00:00:15.000 --> 00:00:20.000
лекцию
"""


def test_parse_vtt_transcript_strips_timestamps_tags_and_duplicates():
    assert yt.parse_vtt_transcript(VTT) == (
        "Привет мир\nНачинаем лекцию\nлекцию"
    )


def test_parse_vtt_transcript_handles_metadata_note_and_empty():
    assert yt.parse_vtt_transcript("") == ""
    assert yt.parse_vtt_transcript(
        "WEBVTT\nKind: captions\nLanguage: en\n\nNOTE\nignored comment\n\n"
        "00:00:00.000 --> 00:00:01.000\nhello <c>world</c>\n"
    ) == "hello world"


def test_build_youtube_material_contains_titles_urls_and_transcripts(monkeypatch):
    monkeypatch.setattr(
        yt,
        "search_videos",
        lambda query, limit=6: [
            {"id": "abc", "title": "Деревья решений 1", "url": "https://www.youtube.com/watch?v=abc", "duration": 120},
            {"id": "def", "title": "Деревья решений 2", "url": "https://www.youtube.com/watch?v=def", "duration": 90},
        ],
    )
    monkeypatch.setattr(
        yt,
        "fetch_transcript",
        lambda url, max_chars=12000: "текст лекции" if url.endswith("abc") else "",
    )

    out = yt.build_youtube_material([("search", "деревья решений")])

    assert "=== YOUTUBE LECTURES (transcripts) ===" in out
    assert "Деревья решений 1" in out
    assert "https://www.youtube.com/watch?v=abc" in out
    assert "текст лекции" in out
    assert "Деревья решений 2" in out
    assert "https://www.youtube.com/watch?v=def" in out
    assert "[transcript unavailable: https://www.youtube.com/watch?v=def]" in out


def test_build_youtube_material_url_job_always_includes_url(monkeypatch):
    monkeypatch.setattr(yt, "fetch_transcript", lambda url, max_chars=12000: "some transcript")

    out = yt.build_youtube_material([("url", "https://www.youtube.com/watch?v=xyz")])

    assert "=== YOUTUBE LECTURES (transcripts) ===" in out
    assert "--- Video: https://www.youtube.com/watch?v=xyz ---" in out
    assert "some transcript" in out
