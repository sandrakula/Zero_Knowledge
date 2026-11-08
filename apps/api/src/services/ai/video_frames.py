"""Visual-aware course pipeline: sample YouTube lecture frames and describe them.

Turns a lecture video into both its transcript and a description of what is
actually shown on screen (slides, diagrams, formulas, code, axes), so the
course planner can ground its notes on the visual content rather than just the
spoken words.

Frame extraction (yt-dlp + ffmpeg) is blocking and runs in a thread; the vision
classification/description is an async HTTP call to the vision gateway. Every
failure is swallowed and logged: ``extract_keyframes`` returns ``[]`` and
``describe_frame`` returns ``{"is_slide": False, "text": "", "description": ""}``.
Course planning must never abort because a frame could not be read or the
vision model was unreachable.
"""

import asyncio
import base64
import json
import logging
import os
import re
import subprocess

import httpx
import yt_dlp

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# Hard cap on the number of frames sampled per lecture. Override with
# LEARNHOUSE_YOUTUBE_FRAMES. Scene-change dedup may drop some of these, so the
# cap bounds the extraction + vision cost even for very long videos.
FRAMES_PER_VIDEO = _env_int("LEARNHOUSE_YOUTUBE_FRAMES", 120)

# Seconds between two sampled frames. Dense sampling every interval seconds
# covers the whole video instead of a handful of evenly-spaced shots. Override
# with LEARNHOUSE_YOUTUBE_FRAME_INTERVAL.
FRAME_INTERVAL_SECONDS = _env_int("LEARNHOUSE_YOUTUBE_FRAME_INTERVAL", 5)

# Primary vision model: describes frames over the Anthropic Messages API, which
# is the only path where deepseek-v4-flash sees images.
DEFAULT_VISION_MODEL = "deepseek-v4.1-flash"

# Fallback vision model for the OpenAI-compatible /chat/completions path. DeepSeek
# models are text-only there, so when the Messages API fails we retry with qwen,
# which does see image_url inputs.
FALLBACK_VISION_MODEL = "qwen3.8"

# Per-frame description cap (~700 chars) keeps the merged notes compact.
MAX_FRAME_DESCRIPTION_CHARS = 700

# Scene-change threshold: a frame is kept only when its 8x8 grayscale hash
# differs from the previous KEPT frame by more than this Hamming distance,
# i.e. the on-screen content has visibly changed. Override with
# LEARNHOUSE_FRAME_CHANGE_THRESHOLD.
SCENE_CHANGE_HAMMING = _env_int("LEARNHOUSE_FRAME_CHANGE_THRESHOLD", 10)

# Samples live in the middle 94% of the video: the first and last ~3% are
# usually intros/outros and are skipped.
_SKIP_EDGE_FRACTION = 0.03

_PROBE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "format": "bestvideo[height<=720]/best",
}

# 11-char YouTube video id, in watch/embed/shorts/live/you.tu.be forms.
_VIDEO_ID_RE = re.compile(
    r"(?:v=|youtu\.be/|/embed/|/shorts/|/live/|/v/)([A-Za-z0-9_-]{11})"
)

_LANGUAGE_NAMES = {
    "en": "English",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "it": "Italian",
    "nl": "Dutch",
    "pl": "Polish",
    "ru": "Russian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ar": "Arabic",
    "hi": "Hindi",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "id": "Indonesian",
    "th": "Thai",
    "bn": "Bengali",
    "fa": "Persian",
}


def get_language_name(language_code: str) -> str:
    """Convert a language code to its full name (defaults to English)."""
    return _LANGUAGE_NAMES.get(language_code, "English")


def compute_frame_timestamps(
    duration: float,
    max_frames: int,
    interval: int = FRAME_INTERVAL_SECONDS,
) -> list[int]:
    """Return sample timestamps (seconds) covering the middle 94% of the video.

    The first/last ~3% (intros/outros) are skipped. Short videos are sampled
    densely every ``interval`` seconds; when that would exceed ``max_frames``,
    exactly ``max_frames`` samples are spread evenly across the span so the last
    sample lands at ``int(end)``. Empty for non-positive inputs.
    """
    if not duration or duration <= 0 or max_frames <= 0 or interval <= 0:
        return []
    start = float(duration) * _SKIP_EDGE_FRACTION
    end = float(duration) * (1.0 - _SKIP_EDGE_FRACTION)
    span = end - start
    if span <= 0:
        return []
    if max_frames == 1:
        return [int(start)]
    if span / interval + 1 <= max_frames:
        timestamps: list[int] = []
        current = start
        while current <= end and len(timestamps) < max_frames:
            timestamps.append(int(current))
            current += interval
        return timestamps
    step = span / (max_frames - 1)
    timestamps = [int(start + i * step) for i in range(max_frames)]
    timestamps[-1] = int(end)
    return timestamps


def _extract_frame_png(media_url: str, timestamp_sec: int) -> bytes:
    """Decode one PNG frame at ``timestamp_sec`` via ffmpeg; ``b""`` on failure."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp_sec),
        "-i", media_url,
        "-frames:v", "1",
        "-vf", "scale=960:-1",
        "-f", "image2pipe",
        "-vcodec", "png",
        "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        logger.warning("ffmpeg failed at %ss", timestamp_sec, exc_info=True)
        return b""
    if result.returncode != 0 or not result.stdout:
        return b""
    return result.stdout


def _frame_ahash(png: bytes) -> int | None:
    """8x8 grayscale average hash of ``png`` (PIL); ``None`` on failure."""
    import io

    from PIL import Image

    try:
        image = Image.open(io.BytesIO(png)).convert("L").resize((8, 8))
        pixels = list(image.tobytes())
    except Exception:
        logger.warning("Frame hash failed", exc_info=True)
        return None
    average = sum(pixels) / len(pixels)
    bits = 0
    for index, pixel in enumerate(pixels):
        if pixel >= average:
            bits |= 1 << index
    return bits


def _hamming_distance(left: int, right: int) -> int:
    """Number of differing bits between two hashes."""
    return (left ^ right).bit_count()


def extract_keyframes(
    url: str,
    max_frames: int = FRAMES_PER_VIDEO,
    interval: int = FRAME_INTERVAL_SECONDS,
) -> list[dict]:
    """Probe ``url`` and sample dense, scene-changed PNG frames.

    Returns ``[{"timestamp_sec": int, "png": bytes}]``; ``[]`` on any failure
    (never raises). A frame is kept only when its aHash Hamming distance from
    the previous KEPT frame exceeds ``SCENE_CHANGE_HAMMING`` (a visual change),
    or when the previous hash is missing. The first and last sampled timestamps
    are always kept.
    """
    if not url:
        return []
    try:
        with yt_dlp.YoutubeDL(_PROBE_OPTS) as ydl:
            info = ydl.extract_info(url, download=False)
        info = info or {}
        entries = info.get("entries")
        if isinstance(entries, list):
            entries = [entry for entry in entries if isinstance(entry, dict)]
            info = entries[0] if entries else {}
        duration = info.get("duration")
        media_url = info.get("url")
        if not duration or not media_url:
            return []
        timestamps = compute_frame_timestamps(float(duration), max_frames, interval)
        if not timestamps:
            return []
        first_ts = timestamps[0]
        last_ts = timestamps[-1]
        frames: list[dict] = []
        prev_hash: int | None = None
        for ts in timestamps:
            png = _extract_frame_png(media_url, ts)
            if not png:
                continue
            frame_hash = _frame_ahash(png)
            is_boundary = ts == first_ts or ts == last_ts
            if (
                not is_boundary
                and prev_hash is not None
                and frame_hash is not None
                and _hamming_distance(frame_hash, prev_hash) <= SCENE_CHANGE_HAMMING
            ):
                continue
            frames.append({"timestamp_sec": ts, "png": png})
            if frame_hash is not None:
                prev_hash = frame_hash
        return frames
    except Exception:
        logger.warning("Frame extraction failed for %s", url, exc_info=True)
        return []


async def _describe_via_messages_api(
    model: str, base_url: str, api_key: str, png: bytes, prompt: str
) -> str:
    """Describe ``png`` via the Anthropic Messages API (deepseek-v4-flash)."""
    body = {
        "model": model,
        "max_tokens": 4000,
        "system": "You analyze lecture video frames and return strict JSON only.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.b64encode(png).decode(),
                        },
                    },
                ],
            }
        ],
    }
    env_vision_base = os.environ.get("LEARNHOUSE_AI_VISION_BASE_URL")
    if env_vision_base and "opencode.ai" in (base_url or ""):
        vision_base = env_vision_base.rstrip("/")
    else:
        vision_base = (base_url or "").rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if "opencode.ai" in vision_base:
        headers["x-opencode-session"] = os.environ.get("LEARNHOUSE_AI_SESSION_ID") or f"lh-{os.getpid()}"
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{vision_base}/messages",
                headers=headers,
                json=body,
            )
            response.raise_for_status()
            data = response.json()
        blocks = data.get("content") or []
        return " ".join(
            block.get("text", "").strip()
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip()
    except Exception:
        logger.warning("Messages API vision description failed", exc_info=True)
        return ""


async def _describe_via_openai_chat(
    model: str, base_url: str, api_key: str, png: bytes, language_name: str
) -> str:
    """Describe ``png`` via the OpenAI-compatible /chat/completions path."""
    data_uri = f"data:image/png;base64,{base64.b64encode(png).decode()}"
    prompt = (
        "This is a frame from a lecture video. "
        f"In {language_name}: describe concretely all visible text, diagrams, formulas, code, axes and what they show. 2-4 sentences."
    )
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            chat_headers = {"Authorization": f"Bearer {api_key}"}
            if "opencode.ai" in (base_url or ""):
                chat_headers["x-opencode-session"] = os.environ.get("LEARNHOUSE_AI_SESSION_ID") or f"lh-{os.getpid()}"
            response = await client.post(
                f"{base_url}/chat/completions",
                headers=chat_headers,
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": data_uri}},
                            ],
                        }
                    ],
                    "max_tokens": 1500,
                    "temperature": 0.1,
                    # qwen/gemma on the gateway otherwise spend the whole
                    # budget on reasoning_content and return empty content.
                    "reasoning_effort": "none",
                },
            )
            response.raise_for_status()
            data = response.json()
            message = (data.get("choices") or [{}])[0].get("message") or {}
            content = (message.get("content") or "").strip()
            return content[:MAX_FRAME_DESCRIPTION_CHARS]
    except Exception:
        logger.warning("OpenAI chat vision description failed", exc_info=True)
        return ""


def _parse_frame_json(raw: str) -> dict | None:
    """Parse the first JSON object in ``raw`` into a slide dict, or ``None``."""
    text = raw.strip()
    start = text.find("{")
    if start == -1:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    is_slide = obj.get("is_slide")
    if isinstance(is_slide, bool):
        is_slide = is_slide
    elif isinstance(is_slide, str):
        is_slide = is_slide.strip().lower() == "true"
    else:
        is_slide = False
    slide_text = obj.get("text")
    description = obj.get("description")
    return {
        "is_slide": is_slide,
        "text": str(slide_text).strip() if slide_text else "",
        "description": str(description).strip() if description else "",
    }


async def describe_frame(png: bytes, language: str) -> dict:
    """Classify + describe one PNG frame via the vision model.

    Returns ``{"is_slide": bool, "text": str, "description": str}``. Never
    raises: an empty or undescribable frame returns ``is_slide=False``.
    """
    if not png:
        return {"is_slide": False, "text": "", "description": ""}
    model = (os.environ.get("LEARNHOUSE_AI_VISION_MODEL") or DEFAULT_VISION_MODEL).strip()
    cfg = get_learnhouse_config().ai_config
    base_url = (cfg.base_url or "").rstrip("/")
    api_key = cfg.api_key or cfg.gemini_api_key
    if not model or not base_url or not api_key:
        return {"is_slide": False, "text": "", "description": ""}
    language_name = get_language_name(language)
    prompt = (
        "This is a frame from a lecture video. Return STRICT JSON only: "
        '{"is_slide": true/false, '
        '"text": "<all visible on-screen text/slide/code/formula text, verbatim, or empty>", '
        '"description": "<2-3 sentences describing diagrams/slides/code/axes in '
        f'{language_name}>"'
        "}. is_slide=true only if the frame shows a slide, diagram, formula, table, "
        "code, or other teaching visual (not just a talking-head/webcam)."
    )
    raw = await _describe_via_messages_api(model, base_url, api_key, png, prompt)
    if not raw:
        return {"is_slide": False, "text": "", "description": ""}
    parsed = _parse_frame_json(raw)
    if parsed is not None:
        return parsed
    return {
        "is_slide": bool(len(raw.strip()) >= 20),
        "text": "",
        "description": raw,
    }


def _extract_video_id(url: str) -> str:
    """Return the 11-char YouTube video id from ``url``, or ``""``."""
    if not url:
        return ""
    match = _VIDEO_ID_RE.search(url)
    return match.group(1) if match else ""


async def describe_video_visuals(
    url: str, language: str, max_frames: int = FRAMES_PER_VIDEO
) -> str:
    """Sample + describe ``url``'s frames and build a VISUAL NOTES block.

    Frames that are not slides (talking-head / blank) are dropped; only slide /
    diagram / formula / code frames are kept. Returns the block text, or ``""``
    when no frame survived (never raises).
    """
    frames = await asyncio.to_thread(extract_keyframes, url, max_frames)
    if not frames:
        return ""
    video_id = _extract_video_id(url)
    semaphore = asyncio.Semaphore(4)

    async def describe_one(frame: dict) -> str:
        async with semaphore:
            result = await describe_frame(frame["png"], language)
        if not result.get("is_slide"):
            return ""
        text = (result.get("text") or "").strip()
        description = (result.get("description") or "").strip()
        if len("".join(text.split())) < 20 and not description:
            return ""
        timestamp = int(frame["timestamp_sec"])
        mm, ss = divmod(timestamp, 60)
        body_parts = []
        if description:
            body_parts.append(description)
        if text:
            body_parts.append(f"text: {text}")
        body = " | ".join(body_parts)
        link = f" (https://youtu.be/{video_id}?t={timestamp})" if video_id else ""
        return f"- [{mm:02d}:{ss:02d}] {body}{link}"

    lines = await asyncio.gather(*(describe_one(frame) for frame in frames))
    lines = [line for line in lines if line]
    if not lines:
        return ""
    return "VISUAL NOTES (slides from the video):\n" + "\n".join(lines)
