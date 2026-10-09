"""ZEROK-1 HTTP client tests use a mock transport and never call the network."""

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
    return DeepSeekClient(transport=httpx.MockTransport(handler), **kwargs)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("zero_knowledge.llm.deepseek._sleep", lambda seconds: None)


def test_missing_api_key_raises_provider_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    client = DeepSeekClient(api_key="", transport=httpx.MockTransport(lambda req: None))
    with pytest.raises(ProviderUnavailableError, match="DEEPSEEK_API_KEY"):
        client.chat("hi")


def test_chat_json_parses_clean_object() -> None:
    def handler(request):
        return httpx.Response(200, text=_body('{"a": 1, "b": [true]}'), request=request)

    client = _make_client(handler)
    assert client.chat_json("hi") == {"a": 1, "b": [True]}


def test_chat_json_strips_markdown_fence() -> None:
    payload = '{"skill_id": "recursion", "mastery": "developing"}'

    def handler(request):
        return httpx.Response(
            200, text=_body(f"```json\n{payload}\n```"), request=request
        )

    client = _make_client(handler)
    assert client.chat_json("hi") == json.loads(payload)


def test_chat_json_tolerates_trailing_text() -> None:
    def handler(request):
        return httpx.Response(
            200,
            text=_body('{"x": 1}\nHere is some extra commentary.'),
            request=request,
        )

    client = _make_client(handler)
    assert client.chat_json("hi") == {"x": 1}


def test_invalid_json_raises_deepseek_json_error() -> None:
    def handler(request):
        return httpx.Response(200, text=_body("this is not JSON"), request=request)

    client = _make_client(handler)
    with pytest.raises(DeepSeekJsonError):
        client.chat_json("hi")


def test_generate_returns_clean_json_text() -> None:
    def handler(request):
        return httpx.Response(
            200, text=_body('```json\n{"k": "v"}\n```'), request=request
        )

    client = _make_client(handler)
    assert json.loads(client.generate("hi")) == {"k": "v"}


def test_auth_401_fails_immediately_without_retry() -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, text='{"error": "invalid key"}', request=request)

    client = _make_client(handler)
    with pytest.raises(ProviderUnavailableError, match="authentication"):
        client.chat("hi")
    assert calls == 1


@pytest.mark.parametrize("status", [429, 503])
def test_retryable_status_retries_then_succeeds(status: int) -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(status, text="retry", request=request)
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    result = client.chat("hi")
    assert calls == 2
    assert result.attempts == 2


def test_retry_exhaustion_raises_provider_unavailable() -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, text="rate limited", request=request)

    client = _make_client(handler, max_retries=2)
    with pytest.raises(ProviderUnavailableError, match="429"):
        client.chat("hi")
    assert calls == 3


def test_timeout_retries_then_succeeds() -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, text=_body('{"ok": true}'), request=request)

    client = _make_client(handler)
    assert client.chat("hi").attempts == 2


def test_transport_error_exhaustion_is_provider_unavailable() -> None:
    def handler(request):
        raise httpx.ConnectError("refused")

    client = _make_client(handler, max_retries=0)
    with pytest.raises(ProviderUnavailableError, match="transport"):
        client.chat("hi")
