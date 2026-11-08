"""YouTube search + transcript extraction for the course-planning flow.

This module turns a keyword query or an explicit video URL into the actual
spoken text of the lecture, so the planner can ground chapters/activities on
real content instead of a bare URL.

Every network call is blocking (yt-dlp + httpx); callers from async code must
wrap these functions in ``asyncio.to_thread``. Any YouTube/network failure is
logged and swallowed: ``search_videos`` returns ``[]``, ``fetch_transcript``
returns ``""``. Course planning must never abort because a video is gone or
YouTube is unreachable.
"""

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx
import yt_dlp

logger = logging.getLogger(__name__)

# Per-video and per-block caps keep the material context bounded (the caller
# also enforces an overall 600k cap on the combined reference-materials block).
MAX_TRANSCRIPT_CHARS = 12_000
MAX_YOUTUBE_BLOCK_CHARS = 600_000

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


MAX_VIDEOS = _env_int("LEARNHOUSE_YOUTUBE_MAX_VIDEOS", 50)

# Cue timing line, e.g. "00:00:00.000 --> 00:00:05.000 align:start position:0%".
_CUE_TIME_RE = re.compile(r"^(?:\d+:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->")
# Inline tags: <c>, <00:00:00.000>, <v Speaker>, </...>, etc.
_TAG_RE = re.compile(r"<[^>]*>")
_METADATA_RE = re.compile(r"^(Kind|Language)\s*:", re.IGNORECASE)

_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "extract_flat": True,
}
_FETCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
}


def parse_vtt_transcript(vtt: str) -> str:
    """Convert a WebVTT document into plain, deduplicated text.

    Strips the WEBVTT header, Kind:/Language: metadata, NOTE/STYLE blocks, cue
    timestamps and inline tags (<c>, <00:00:00.000>, <v ...>); collapses
    whitespace/blank lines and drops consecutive duplicate lines.
    """
    if not vtt:
        return ""
    text_lines: list[str] = []
    skip_block = False
    for raw in vtt.splitlines():
        line = raw.strip()
        if not line:
            skip_block = False
            continue
        upper = line.upper()
        if upper.startswith("WEBVTT"):
            continue
        if _METADATA_RE.match(line):
            continue
        if upper.startswith("NOTE") or upper.startswith("STYLE"):
            skip_block = True
            continue
        if skip_block:
            continue
        if _CUE_TIME_RE.match(line):
            continue
        line = _TAG_RE.sub("", line)
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        text_lines.append(line)

    deduped: list[str] = []
    for line in text_lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)
    return "\n".join(deduped)


def search_videos(query: str, limit: int = 6) -> list[dict]:
    """Return up to ``limit`` YouTube search results for ``query``.

    Each entry has ``id``, ``title``, ``url`` and ``duration``. Returns ``[]``
    on any failure (never raises).
    """
    try:
        with yt_dlp.YoutubeDL(_SEARCH_OPTS) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        entries = (info or {}).get("entries") or []
        results: list[dict] = []
        for entry in entries:
            if not entry:
                continue
            video_id = entry.get("id")
            if not video_id:
                continue
            url = entry.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}"
            results.append(
                {
                    "id": video_id,
                    "title": entry.get("title") or "",
                    "url": url,
                    "duration": entry.get("duration"),
                }
            )
        return results
    except Exception:
        logger.warning("YouTube search failed for query %r", query, exc_info=True)
        return []


def _pick_track(tracks_by_lang: dict, lang: str) -> Optional[dict]:
    """Pick the best subtitle track for ``lang`` (matched by first subtag)."""
    for code, tracks in (tracks_by_lang or {}).items():
        if code.split("-")[0].lower() != lang:
            continue
        if not tracks:
            continue
        for track in tracks:
            if (track.get("ext") or "").lower() == "vtt":
                return track
        return tracks[0]
    return None


def _select_track(info: dict) -> Optional[dict]:
    """Choose a transcript track: subtitles first, then automatic captions,
    trying ``ru`` before ``en``."""
    subtitles = info.get("subtitles") or {}
    automatic = info.get("automatic_captions") or {}
    for source in (subtitles, automatic):
        for lang in ("ru", "en"):
            track = _pick_track(source, lang)
            if track:
                return track
    return None


def fetch_transcript(url: str, max_chars: int = MAX_TRANSCRIPT_CHARS) -> str:
    """Download and flatten the transcript for a YouTube ``url``.

    Returns the plain text (capped at ``max_chars``) or ``""`` on ANY failure
    (never raises).
    """
    try:
        with yt_dlp.YoutubeDL(_FETCH_OPTS) as ydl:
            info = ydl.extract_info(url, download=False)
        track = _select_track(info or {})
        if not track:
            return ""
        vtt_url = track.get("url")
        if not vtt_url:
            return ""
        for attempt in range(3):
            try:
                response = httpx.get(vtt_url, timeout=30.0, follow_redirects=True)
                response.raise_for_status()
                return parse_vtt_transcript(response.text)[:max_chars]
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if (status == 429 or 500 <= status < 600) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
        return ""
    except Exception:
        logger.warning("YouTube transcript fetch failed for %s", url, exc_info=True)
        return ""


def _format_video_block(title: str, url: str, transcript: str) -> str:
    header = f"--- Video: {title} | {url} ---" if title else f"--- Video: {url} ---"
    body = transcript if transcript else f"[transcript unavailable: {url}]"
    return f"{header}\n{body}"


def build_youtube_material(jobs: list[tuple[str, str]]) -> str:
    """Build a labeled transcript block from ``(kind, value)`` jobs.

    ``kind`` is ``"search"`` (value is a query) or ``"url"`` (value is a video
    URL). Every video's URL is always included so the planner can embed it.
    Failures become a short ``[transcript unavailable: <url>]`` note. The whole
    block is capped at ~600k chars and each transcript at ~12k.
    """
    header = "=== YOUTUBE LECTURES (transcripts) ==="
    parts: list[str] = [header]
    budget = MAX_YOUTUBE_BLOCK_CHARS - len(header)

    for kind, value in jobs:
        if budget <= 0:
            break
        if kind == "search":
            videos = search_videos(value, MAX_VIDEOS)
            titles = [video.get("title") or "" for video in videos]
            urls = [video.get("url") or "" for video in videos]
            with ThreadPoolExecutor(max_workers=4) as executor:
                transcripts = list(executor.map(fetch_transcript, urls))
            for title, url, transcript in zip(titles, urls, transcripts):
                if budget <= 0:
                    break
                block = _format_video_block(title, url, transcript)
                if len(block) > budget:
                    block = block[:budget]
                parts.append(block)
                budget -= len(block)
        elif kind == "url":
            transcript = fetch_transcript(value)
            block = _format_video_block("", value, transcript)
            if len(block) > budget:
                block = block[:budget]
            parts.append(block)
            budget -= len(block)

    return "\n".join(parts)


def fetch_lectures(jobs: list[tuple[str, str]]) -> list[dict]:
    """Resolve ``(kind, value)`` jobs into videos and fetch all transcripts.

    ``kind`` is ``"search"`` (value is a query, resolved via ``search_videos``
    with the shared ``MAX_VIDEOS`` cap) or ``"url"`` (value is a single video
    URL). All transcripts are then downloaded in one ``ThreadPoolExecutor``,
    so a batch of up to 50 lectures is fetched in parallel. Order is preserved
    (``executor.map`` yields results in submission order).

    Returns a list of ``{"kind": "youtube", "title", "url", "text"}`` dicts.
    A video with no retrievable transcript still appears, with ``text == ""``,
    so the planner can always cite/embed its URL.
    """
    videos: list[dict] = []
    for kind, value in jobs:
        if kind == "search":
            videos.extend(search_videos(value, MAX_VIDEOS))
        elif kind == "url":
            videos.append({"title": "", "url": value})

    if not videos:
        return []

    urls = [video.get("url") or "" for video in videos]
    with ThreadPoolExecutor(max_workers=4) as executor:
        transcripts = list(executor.map(fetch_transcript, urls))

    return [
        {"kind": "youtube", "title": video.get("title") or "", "url": url, "text": transcript}
        for video, url, transcript in zip(videos, urls, transcripts)
    ]
