"""Local speech-to-text for browsers without the Web Speech API.

Uses the same faster-whisper cache as YouTube transcript ASR. Audio is converted
to 16 kHz mono WAV with ffmpeg, then decoded manually into a numpy array. Going
through PyAV directly breaks with newer av releases (removed `metadata_errors`),
while the manual WAV path is stable and matches the transcript ASR pipeline.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import wave
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _model_name() -> str:
    return (
        os.getenv("LEARNHOUSE_ASR_MODEL")
        or os.getenv("LEARNHOUSE_YOUTUBE_ASR_MODEL")
        or "base"
    )


def _cpu_threads() -> int:
    return _env_int("LEARNHOUSE_ASR_CPU_THREADS", 8)


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from faster_whisper import WhisperModel

            _MODEL = WhisperModel(
                _model_name(),
                device="cpu",
                compute_type="int8",
                cpu_threads=_cpu_threads(),
            )
    return _MODEL


def _transcribe_file(path: str, language: str | None) -> tuple[str, str | None, float]:
    import numpy as np

    ffmpeg = os.getenv("LEARNHOUSE_FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "audio16k.wav"
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                path,
                "-ac",
                "1",
                "-ar",
                "16000",
                str(wav_path),
            ],
            capture_output=True,
            timeout=120,
        )
        if not wav_path.is_file():
            raise RuntimeError("ffmpeg could not decode the recording")

        with wave.open(str(wav_path), "rb") as wav_file:
            raw = wav_file.readframes(wav_file.getnframes())
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    model = _get_model()
    segments, info = model.transcribe(
        audio,
        language=None if not language or language == "auto" else language,
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return text, getattr(info, "language", None), float(getattr(info, "duration", 0.0) or 0.0)


async def transcribe_audio_bytes(
    data: bytes,
    suffix: str = ".webm",
    language: str | None = "ru",
) -> dict:
    """Transcribe an uploaded audio blob. Raises on unreadable audio."""
    suffix = suffix if suffix.startswith(".") else f".{suffix}"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            handle.write(data)
            temp_path = handle.name
        text, detected, duration = await asyncio.to_thread(_transcribe_file, temp_path, language)
        return {
            "text": text,
            "language": detected,
            "duration": round(duration, 2),
            "model": _model_name(),
        }
    except Exception:
        logger.warning("Local ASR failed", exc_info=True)
        raise
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except OSError:
                pass
