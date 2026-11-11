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
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import httpx
import yt_dlp

logger = logging.getLogger(__name__)

# Per-video and per-block caps keep the material context bounded (the caller
# also enforces an overall 600k cap on the combined reference-materials block).
MAX_TRANSCRIPT_CHARS = 200_000
MAX_YOUTUBE_BLOCK_CHARS = 1_500_000

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


MAX_VIDEOS = _env_int("LEARNHOUSE_YOUTUBE_MAX_VIDEOS", 50)
_TRANSCRIPT_CACHE_DIR = Path(
    os.getenv("LEARNHOUSE_YOUTUBE_CACHE_DIR", "content/youtube_transcripts")
)
_TRANSCRIPT_MIN_INTERVAL = float(
    os.getenv("LEARNHOUSE_YOUTUBE_MIN_INTERVAL", "1.5")
)
_TRANSCRIPT_RATE = threading.Semaphore(1)
_TRANSCRIPT_LAST = [0.0]
_TRANSCRIPT_CLIENTS = ("android", "ios", "web")
_ASR_ENABLED = os.getenv("LEARNHOUSE_YOUTUBE_ASR", "1").lower() not in ("0", "false", "no")
_ASR_MODEL_NAME = os.getenv("LEARNHOUSE_YOUTUBE_ASR_MODEL", "small")
_ASR_CPU_THREADS = int(os.getenv("LEARNHOUSE_YOUTUBE_ASR_CPU_THREADS", "12"))
_SKIP_CAPTIONS = os.getenv("LEARNHOUSE_YOUTUBE_SKIP_CAPTIONS", "0").lower() in ("1", "true", "yes")
_ASR_MODEL = None
_ASR_LOCK = threading.Lock()

# Cue timing line, e.g. "00:00:00.000 --> 00:00:05.000 align:start position:0%".
_CUE_TIME_RE = re.compile(r"^(?:\d+:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->")
# Inline tags: <c>, <00:00:00.000>, <v Speaker>, </...>, etc.
_TAG_RE = re.compile(r"<[^>]*>")
_METADATA_RE = re.compile(r"^(Kind|Language)\s*:", re.IGNORECASE)

_COOKIE_OPTS: dict[str, object] = {}
_COOKIE_FILE = os.getenv("LEARNHOUSE_YOUTUBE_COOKIES_FILE", "").strip()
_COOKIE_BROWSER = os.getenv("LEARNHOUSE_YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
if _COOKIE_FILE and Path(_COOKIE_FILE).exists():
    _COOKIE_OPTS["cookiefile"] = _COOKIE_FILE
elif _COOKIE_BROWSER:
    _COOKIE_OPTS["cookiesfrombrowser"] = (_COOKIE_BROWSER,)

_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "extract_flat": True,
    **_COOKIE_OPTS,
}
# The default web client is frequently challenged with a bot check on
# datacenter-like IPs. The Android client still serves metadata and caption
# tracks without cookies, so transcript extraction uses it explicitly.
_ANDROID_CLIENT = {"extractor_args": {"youtube": {"player_client": ["android"]}}}
_FETCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    **_ANDROID_CLIENT,
    **_COOKIE_OPTS,
}
_FETCH_OPTS_WEB = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    **_COOKIE_OPTS,
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
    """Pick the best subtitle track for ``lang`` (matched by first subtag).

    Prefers original tracks over machine-translated ones: ``tlang=`` URLs are
    the translation endpoint, which is rate-limited far more aggressively.
    """
    for code, tracks in (tracks_by_lang or {}).items():
        if code.split("-")[0].lower() != lang:
            continue
        if not tracks:
            continue
        original = [
            track for track in tracks
            if track.get("url") and "tlang=" not in track["url"]
        ]
        for track in original:
            if (track.get("ext") or "").lower() == "vtt":
                return track
        if original:
            return original[0]
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


def _video_id(url: str) -> Optional[str]:
    match = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})", url or "")
    return match.group(1) if match else None


def _cache_file(video_id: str) -> Path:
    return _TRANSCRIPT_CACHE_DIR / f"{video_id}.vtt"


def _text_cache_file(video_id: str) -> Path:
    return _TRANSCRIPT_CACHE_DIR / f"{video_id}.txt"


def _read_cache(video_id: str) -> str:
    try:
        text_path = _text_cache_file(video_id)
        if text_path.is_file() and text_path.stat().st_size > 0:
            return text_path.read_text(encoding="utf-8")
        path = _cache_file(video_id)
        if path.is_file() and path.stat().st_size > 0:
            return parse_vtt_transcript(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("Transcript cache read failed for %s", video_id, exc_info=True)
    return ""


def _write_cache(video_id: str, vtt: str) -> None:
    try:
        _TRANSCRIPT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_file(video_id).write_text(vtt, encoding="utf-8")
    except Exception:
        logger.debug("Transcript cache write failed for %s", video_id, exc_info=True)


def _write_text_cache(video_id: str, text: str) -> None:
    try:
        _TRANSCRIPT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _text_cache_file(video_id).write_text(text, encoding="utf-8")
    except Exception:
        logger.debug("Transcript text cache write failed for %s", video_id, exc_info=True)


def _throttle() -> None:
    now = time.monotonic()
    delay = _TRANSCRIPT_MIN_INTERVAL - (now - _TRANSCRIPT_LAST[0])
    if delay > 0:
        time.sleep(delay)
    _TRANSCRIPT_LAST[0] = time.monotonic()


def _transcribe_audio(url: str, video_id: str) -> str:
    """Full-speech fallback without cookies: audio download + faster-whisper."""
    if not _ASR_ENABLED:
        return ""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            options = {
                "quiet": True,
                "no_warnings": True,
                "format": "bestaudio/best",
                "outtmpl": str(Path(tmp) / "%(id)s.%(ext)s"),
                "noplaylist": True,
                "retries": 6,
                "sleep_requests": 1.0,
                "sleep_interval": 1.5,
                "extractor_args": {"youtube": {"player_client": list(_TRANSCRIPT_CLIENTS)}},
                **_COOKIE_OPTS,
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "wav", "preferredquality": "192"}
                ],
            }
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.download([url])
            audio_files = sorted(Path(tmp).glob("*.wav")) or sorted(Path(tmp).glob("*"))
            audio_files = [path for path in audio_files if path.is_file() and path.suffix.lower() in {".wav", ".m4a", ".webm", ".mp3", ".opus"}]
            if not audio_files:
                return ""
            ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
            wav_path = Path(tmp) / "audio16k.wav"
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(audio_files[0]),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    str(wav_path),
                ],
                capture_output=True,
                timeout=900,
            )
            if not wav_path.is_file():
                return ""
            import numpy as np

            with wave.open(str(wav_path), "rb") as wav_file:
                raw = wav_file.readframes(wav_file.getnframes())
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            global _ASR_MODEL
            with _ASR_LOCK:
                if _ASR_MODEL is None:
                    from faster_whisper import WhisperModel

                    _ASR_MODEL = WhisperModel(
                        _ASR_MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=_ASR_CPU_THREADS
                    )
                segments, _info = _ASR_MODEL.transcribe(
                    audio, vad_filter=True, beam_size=1
                )
                text = " ".join(
                    segment.text.strip() for segment in segments if segment.text.strip()
                )
            if text.strip() and video_id:
                _write_text_cache(video_id, text)
            return text
    except Exception:
        logger.warning("ASR fallback failed for %s", url, exc_info=True)
        return ""


def _asr_fallback(url: str, video_id: Optional[str], max_chars: int) -> str:
    if not video_id:
        return ""
    return _transcribe_audio(url, video_id)[:max_chars]


def _fetch_subtitles_ytdlp(url: str, video_id: str) -> str:
    """Download subtitles through yt-dlp, trying several player clients."""
    for client in _TRANSCRIPT_CLIENTS:
        with tempfile.TemporaryDirectory() as tmp:
            options = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitleslangs": ["en.*", "ru.*", "en", "ru"],
                "subtitlesformat": "vtt",
                "outtmpl": str(Path(tmp) / "%(id)s.%(ext)s"),
                "noplaylist": True,
                "retries": 6,
                "fragment_retries": 6,
                "sleep_requests": 1.0,
                "sleep_interval": 1.5,
                "max_sleep_interval": 3,
                "extractor_args": {"youtube": {"player_client": [client]}},
                **_COOKIE_OPTS,
            }
            try:
                with yt_dlp.YoutubeDL(options) as ydl:
                    ydl.download([url])
            except Exception:
                logger.debug("yt-dlp subtitle client %s failed for %s", client, url, exc_info=True)
            candidates = sorted(
                Path(tmp).glob("*.vtt"),
                key=lambda path: (
                    0 if ".en" in path.name.lower() else 1 if ".ru" in path.name.lower() else 2,
                    path.name,
                ),
            )
            for path in candidates:
                try:
                    vtt = path.read_text(encoding="utf-8")
                    text = parse_vtt_transcript(vtt)
                    if text.strip():
                        _write_cache(video_id, vtt)
                        return text
                except Exception:
                    logger.debug("Subtitle parse failed for %s", path, exc_info=True)
        _throttle()
    return ""


def fetch_transcript(url: str, max_chars: int = MAX_TRANSCRIPT_CHARS) -> str:
    """Download and flatten the full transcript for a YouTube ``url``.

    Captions are fetched through yt-dlp first (cached on disk), then through
    the timedtext endpoint, and the video description is the final fallback.
    Network access is serialized and throttled to avoid per-IP 429s.
    """
    try:
        with _TRANSCRIPT_RATE:
            video_id = _video_id(url)
            if video_id:
                cached = _read_cache(video_id)
                if cached:
                    return cached[:max_chars]
            _throttle()
            if video_id and not _SKIP_CAPTIONS:
                subtitles = _fetch_subtitles_ytdlp(url, video_id)
                if subtitles:
                    return subtitles[:max_chars]
            _throttle()
            info = None
            if not _SKIP_CAPTIONS:
                for opts in (_FETCH_OPTS, _FETCH_OPTS_WEB):
                    try:
                        with yt_dlp.YoutubeDL(opts) as ydl:
                            info = ydl.extract_info(url, download=False)
                        if info:
                            break
                    except Exception:
                        logger.debug("yt-dlp client failed for %s; trying fallback", url, exc_info=True)
            track = _select_track(info or {}) if not _SKIP_CAPTIONS else None
            description = str((info or {}).get("description") or "").strip()
            if not track:
                return _asr_fallback(url, video_id, max_chars) or description[:max_chars]
            vtt_url = track.get("url")
            if not vtt_url:
                return _asr_fallback(url, video_id, max_chars) or description[:max_chars]
            for attempt in range(3):
                try:
                    response = httpx.get(vtt_url, timeout=30.0, follow_redirects=True)
                    response.raise_for_status()
                    parsed = parse_vtt_transcript(response.text)
                    if parsed and video_id:
                        _write_cache(video_id, response.text)
                    return (parsed or description)[:max_chars]
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code
                    if attempt < 2 and (status == 429 or 500 <= status < 600):
                        time.sleep(5.0 * (attempt + 1))
                        continue
                    return _asr_fallback(url, video_id, max_chars) or description[:max_chars]
            return _asr_fallback(url, video_id, max_chars) or description[:max_chars]
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
