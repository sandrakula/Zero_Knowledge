"""Tests for src/services/ai/video_frames.py.

``describe_video_visuals`` is tested by monkeypatching ``extract_keyframes``
(no yt-dlp/ffmpeg) and ``describe_frame`` (no network), so the block-building,
slide-filtering and failure-skipping logic is exercised in isolation. The
timestamp helper, the aHash scene-change helper, and the two vision-call paths
(Messages API + OpenAI chat fallback) are unit-tested directly with a fake HTTP
client.
"""

import base64
import io
from types import SimpleNamespace

from PIL import Image

import src.services.ai.video_frames as vf


def _patch_config(monkeypatch, base_url="https://llm.azati.ai/v1", api_key="sk-test"):
    ai = SimpleNamespace(base_url=base_url, api_key=api_key, gemini_api_key=None)
    monkeypatch.setattr(
        vf, "get_learnhouse_config", lambda: SimpleNamespace(ai_config=ai)
    )


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _patch_http(monkeypatch, responses):
    calls = []

    class Client:
        def __init__(self, timeout=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return _FakeResponse(responses.get(url))

    monkeypatch.setattr(vf.httpx, "AsyncClient", Client)
    return calls


def test_compute_frame_timestamps_spreads_across_full_video():
    # A 1-hour video with max_frames=40 must cover the whole middle 94%, not
    # truncate after the first ~11 minutes.
    ts = vf.compute_frame_timestamps(3600, 40, interval=15)

    assert len(ts) == 40
    assert ts[0] == 108
    assert ts[-1] == 3492
    assert ts == sorted(ts)
    assert ts[-1] > 3000


def test_compute_frame_timestamps_dense_sampling_for_short_video():
    # A 5-minute video fits dense 15s sampling under max_frames=40.
    ts = vf.compute_frame_timestamps(300, 40, interval=15)

    assert len(ts) == 19
    assert ts[0] == 9
    assert all(b - a == 15 for a, b in zip(ts, ts[1:]))
    assert abs(ts[-1] - 291) <= 20


def test_compute_frame_timestamps_single_sample_when_max_frames_is_one():
    ts = vf.compute_frame_timestamps(3600, 1, interval=15)

    assert ts == [108]


def test_compute_frame_timestamps_single_sample_when_interval_exceeds_span():
    # A 20s video sampled every 60s has room for exactly one frame.
    ts = vf.compute_frame_timestamps(20.0, 6, interval=60)

    assert len(ts) == 1
    assert ts[0] == int(20 * 0.03)


def test_compute_frame_timestamps_empty_for_non_positive():
    assert vf.compute_frame_timestamps(0, 6) == []
    assert vf.compute_frame_timestamps(-5, 6) == []
    assert vf.compute_frame_timestamps(100, 0) == []
    assert vf.compute_frame_timestamps(100, 6, interval=0) == []


def test_frame_ahash_is_deterministic_and_hamming_measures_difference():
    def png_from(pixels):
        image = Image.new("L", (8, 8))
        image.putdata(pixels)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    left_dark = [0 if x < 4 else 255 for y in range(8) for x in range(8)]
    left_light = [255 if x < 4 else 0 for y in range(8) for x in range(8)]

    h1 = vf._frame_ahash(png_from(left_dark))
    h2 = vf._frame_ahash(png_from(left_light))

    assert isinstance(h1, int)
    assert isinstance(h2, int)
    assert h1 == vf._frame_ahash(png_from(left_dark))
    assert vf._hamming_distance(h1, h1) == 0
    assert vf._hamming_distance(h1, h2) > 0


def test_extract_keyframes_drops_near_duplicates_but_keeps_first_and_last(monkeypatch):
    class FakeYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=False):
            return {"duration": 1000, "url": "https://media.test/v.mp4"}

    monkeypatch.setattr(vf.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(
        vf, "_extract_frame_png", lambda media_url, ts: f"png-{ts}".encode()
    )
    # Every frame hashes identically, so only the boundary frames survive.
    monkeypatch.setattr(vf, "_frame_ahash", lambda png: 0b1010)

    frames = vf.extract_keyframes(
        "https://youtu.be/abcdefghijk", max_frames=4, interval=15
    )

    assert [f["timestamp_sec"] for f in frames] == [30, 970]


def test_extract_keyframes_keeps_scene_changes_and_boundaries(monkeypatch):
    class FakeYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=False):
            return {"duration": 1000, "url": "https://media.test/v.mp4"}

    monkeypatch.setattr(vf.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(
        vf, "_extract_frame_png", lambda media_url, ts: f"png-{ts}".encode()
    )
    # ts=30 (first) and ts=970 (last) are boundaries; ts=343 is a near-duplicate
    # of the first (dropped), ts=656 is a real scene change (kept).
    monkeypatch.setattr(
        vf,
        "_frame_ahash",
        lambda png: {
            "png-30": 0,
            "png-343": 0,
            "png-656": 0b111111111111,
            "png-970": 0b111111111111,
        }[png.decode()],
    )

    frames = vf.extract_keyframes(
        "https://youtu.be/abcdefghijk", max_frames=4, interval=15
    )

    assert [f["timestamp_sec"] for f in frames] == [30, 656, 970]


async def test_describe_frame_returns_not_slide_for_empty_png():
    assert await vf.describe_frame(b"", "en") == {
        "is_slide": False,
        "text": "",
        "description": "",
    }


async def test_describe_frame_parses_json_for_deepseek(monkeypatch):
    _patch_config(monkeypatch)
    monkeypatch.delenv("LEARNHOUSE_AI_VISION_MODEL", raising=False)
    png = b"\x89PNG\r\nfake"
    calls = _patch_http(
        monkeypatch,
        {
            "https://llm.azati.ai/v1/messages": {
                "content": [
                    {"type": "thinking", "thinking": "hidden reasoning"},
                    {"type": "text", "text": "Here is the analysis: "},
                    {
                        "type": "text",
                        "text": (
                            '{"is_slide": true, "text": "Matrix multiplication", '
                            '"description": "A slide about matrix multiplication."}'
                        ),
                    },
                ]
            }
        },
    )

    result = await vf.describe_frame(png, "ru")

    assert result == {
        "is_slide": True,
        "text": "Matrix multiplication",
        "description": "A slide about matrix multiplication.",
    }
    url, kwargs = calls[0]
    assert url == "https://llm.azati.ai/v1/messages"
    assert kwargs["headers"]["anthropic-version"] == "2023-06-01"
    assert kwargs["headers"]["Authorization"] == "Bearer sk-test"
    body = kwargs["json"]
    assert body["model"] == "deepseek-v4.1-flash"
    assert body["max_tokens"] == 4000
    content = body["messages"][0]["content"]
    assert content[0]["type"] == "text"
    assert "STRICT JSON" in content[0]["text"]
    assert "Russian" in content[0]["text"]
    assert content[1]["type"] == "image"
    assert content[1]["source"] == {
        "type": "base64",
        "media_type": "image/png",
        "data": base64.b64encode(png).decode(),
    }


async def test_describe_frame_falls_back_on_json_parse_failure(monkeypatch):
    _patch_config(monkeypatch)
    monkeypatch.delenv("LEARNHOUSE_AI_VISION_MODEL", raising=False)
    _patch_http(
        monkeypatch,
        {
            "https://llm.azati.ai/v1/messages": {
                "content": [
                    {
                        "type": "text",
                        "text": "A plain prose description that is long enough",
                    }
                ]
            }
        },
    )

    result = await vf.describe_frame(b"png", "en")

    assert result == {
        "is_slide": True,
        "text": "",
        "description": "A plain prose description that is long enough",
    }


async def test_describe_frame_always_uses_messages_api(monkeypatch):
    _patch_config(monkeypatch)
    monkeypatch.setenv("LEARNHOUSE_AI_VISION_MODEL", "deepseek-v4.1-flash")
    calls = _patch_http(
        monkeypatch,
        {
            "https://llm.azati.ai/v1/messages": {
                "content": [
                    {
                        "type": "text",
                        "text": '{"is_slide": true, "text": "t", "description": "d"}',
                    }
                ]
            }
        },
    )

    result = await vf.describe_frame(b"png", "en")

    assert result == {"is_slide": True, "text": "t", "description": "d"}
    assert [url for url, _ in calls] == ["https://llm.azati.ai/v1/messages"]
    assert calls[0][1]["json"]["model"] == "deepseek-v4.1-flash"


async def test_describe_frame_returns_not_slide_when_messages_empty(monkeypatch):
    _patch_config(monkeypatch)
    monkeypatch.delenv("LEARNHOUSE_AI_VISION_MODEL", raising=False)
    calls = _patch_http(
        monkeypatch,
        {
            "https://llm.azati.ai/v1/messages": {
                "content": [{"type": "thinking", "thinking": "only reasoning"}]
            }
        },
    )

    result = await vf.describe_frame(b"png", "en")

    assert result == {"is_slide": False, "text": "", "description": ""}
    assert [url for url, _ in calls] == ["https://llm.azati.ai/v1/messages"]


async def test_describe_video_visuals_builds_timestamped_block(monkeypatch):
    frames = [
        {"timestamp_sec": 66, "png": b"a"},
        {"timestamp_sec": 125, "png": b"b"},
    ]

    def fake_extract(url, max_frames=vf.FRAMES_PER_VIDEO):
        return frames

    async def fake_describe(png, language):
        return {
            "a": {"is_slide": True, "text": "the first formula", "description": "first slide"},
            "b": {"is_slide": True, "text": "the second diagram", "description": "second slide"},
        }[png.decode()]

    monkeypatch.setattr(vf, "extract_keyframes", fake_extract)
    monkeypatch.setattr(vf, "describe_frame", fake_describe)

    out = await vf.describe_video_visuals(
        "https://www.youtube.com/watch?v=j8L07nuns2Y", "ru", 3
    )

    assert "VISUAL NOTES (slides from the video):" in out
    assert "- [01:06] first slide | text: the first formula (https://youtu.be/j8L07nuns2Y?t=66)" in out
    assert "- [02:05] second slide | text: the second diagram (https://youtu.be/j8L07nuns2Y?t=125)" in out


async def test_describe_video_visuals_drops_non_slide_frames(monkeypatch):
    frames = [
        {"timestamp_sec": 66, "png": b"a"},
        {"timestamp_sec": 125, "png": b"b"},
        {"timestamp_sec": 200, "png": b"c"},
    ]

    def fake_extract(url, max_frames=vf.FRAMES_PER_VIDEO):
        return frames

    async def fake_describe(png, language):
        return {
            "a": {"is_slide": True, "text": "", "description": "kept slide"},
            "b": {"is_slide": False, "text": "talking head", "description": "a person speaking"},
            "c": {"is_slide": True, "text": "short", "description": ""},
        }[png.decode()]

    monkeypatch.setattr(vf, "extract_keyframes", fake_extract)
    monkeypatch.setattr(vf, "describe_frame", fake_describe)

    out = await vf.describe_video_visuals("https://youtu.be/abcdefghijk", "en", 3)

    assert "- [01:06] kept slide" in out
    assert "- [02:05]" not in out
    assert "- [03:20]" not in out


async def test_describe_video_visuals_returns_empty_with_no_frames(monkeypatch):
    monkeypatch.setattr(vf, "extract_keyframes", lambda url, max_frames=40: [])

    assert await vf.describe_video_visuals("https://youtu.be/abcdefghijk", "en", 3) == ""


async def test_describe_video_visuals_returns_empty_when_all_frames_dropped(monkeypatch):
    monkeypatch.setattr(
        vf,
        "extract_keyframes",
        lambda url, max_frames=40: [{"timestamp_sec": 30, "png": b"a"}],
    )

    async def fake_describe(png, language):
        return {"is_slide": False, "text": "", "description": ""}

    monkeypatch.setattr(vf, "describe_frame", fake_describe)

    assert await vf.describe_video_visuals("https://youtu.be/abcdefghijk", "en", 3) == ""


async def test_describe_video_visuals_omits_link_without_video_id(monkeypatch):
    frames = [{"timestamp_sec": 30, "png": b"a"}]

    def fake_extract(url, max_frames=vf.FRAMES_PER_VIDEO):
        return frames

    async def fake_describe(png, language):
        return {
            "is_slide": True,
            "text": "some meaningful on-screen text",
            "description": "some text",
        }

    monkeypatch.setattr(vf, "extract_keyframes", fake_extract)
    monkeypatch.setattr(vf, "describe_frame", fake_describe)

    out = await vf.describe_video_visuals("https://example.com/not-youtube", "en", 3)

    assert "- [00:30] some text" in out
    assert "https://youtu.be/" not in out
