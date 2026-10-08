"""Тесты HTTP-клиента DeepSeek: JSON-парсинг и обработка ошибок.

Используют ``httpx.MockTransport``, поэтому не требуют сети и API-ключа.
"""

from __future__ import annotations

import json

import httpx
import pytest

from zero_knowledge.llm import DeepSeekClient, DeepSeekJsonError
from zero_knowledge.task_generation.errors import ProviderUnavailableError


def _body(content: str) -> str:
    return json.dumps({"choices": [{"message": {"content": content}}]})


def _make_client(handler, **kwargs) -> DeepSeekClient:
    kwargs.setdefault("api_key", "test-key")
    kwargs.setdefault("max_retries", 3)
    transport = httpx.MockTransport(handler)
    return DeepSeekClient(transport=transport, **kwargs)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("zero_knowledge.llm.deepseek._sleep", lambda seconds: None)


def test_missing_api_key_raises_provider_unavailable():
    client = DeepSeekClient(api_key="", transport=httpx.MockTransport(lambda req: None))
    with pytest.raises(ProviderUnavailableError):
        client.chat("hi")


def test_chat_json_parses_clean_object():
    def handler(request):
        return httpx.Response(200, text=_body('{"a": 1, "b": [true]}'), request=request)

    client = _make_client(handler)
    assert client.chat_json("hi") == {"a": 1, "b": [True]}


def test_chat_json_strips_markdown_fence():
    payload = '{"skill_id": "recursion", "mastery": "developing"}'

    def handler(request):
        return httpx.Response(200, text=_body(f"```json\n{payload}\n```"), request=request)

    client = _make_client(handler)
    assert client.chat_json("hi") == json.loads(payload)


def test_chat_json_tolerates_trailing_text():
    def handler(request):
        return httpx.Response(
            200, text=_body('{"x": 1}\nHere is some extra commentary.'), request=request
        )

    client = _make_client(handler)
    assert client.chat_json("hi") == {"x": 1}


def test_invalid_json_raises_deepseek_json_error():
    def handler(request):
        return httpx.Response(200, text=_body("this is not JSON at all"), request=request)

    client = _make_client(handler)
    with pytest.raises(DeepSeekJsonError):
        client.chat_json("hi")


def test_json_array_root_is_rejected():
    def handler(request):
        return httpx.Response(200, text=_body("[1, 2, 3]"), request=request)

    client = _make_client(handler)
    with pytest.raises(DeepSeekJsonError):
        client.chat_json("hi")


def test_generate_returns_clean_json_text():
    def handler(request):
        return httpx.Response(200, text=_body('```json\n{"k": "v"}\n```'), request=request)

    client = _make_client(handler)
    raw = client.generate("hi")
    assert json.loads(raw) == {"k": "v"}


def test_auth_401_fails_immediately_without_retry():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, text='{"error": "invalid key"}', request=request)

    client = _make_client(handler)
    with pytest.raises(ProviderUnavailableError, match="authentication"):
        client.chat("hi")
    assert calls == 1


def test_429_retries_then_succeeds():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(
                429, text="rate limited", headers={"retry-after": "1"}, request=request
            )
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    result = client.chat("hi")
    assert calls == 2
    assert result.attempts == 2
    assert json.loads(result.content) == {"ok": True}


def test_5xx_retries_then_succeeds():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, text="unavailable", request=request)
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    result = client.chat("hi")
    assert calls == 2
    assert result.attempts == 2


def test_retry_exhaustion_raises_provider_unavailable():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, text="rate limited", request=request)

    client = _make_client(handler, max_retries=3)
    with pytest.raises(ProviderUnavailableError, match="429"):
        client.chat("hi")
    assert calls == 4  # initial + 3 retries


def test_timeout_retries_then_succeeds():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    result = client.chat("hi")
    assert calls == 2
    assert result.attempts == 2


def test_timeout_exhaustion_raises_provider_unavailable():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("slow")

    client = _make_client(handler, max_retries=2)
    with pytest.raises(ProviderUnavailableError, match="timed out"):
        client.chat("hi")
    assert calls == 3


def test_transport_error_retries_then_succeeds():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    result = client.chat("hi")
    assert calls == 2
    assert result.attempts == 2
