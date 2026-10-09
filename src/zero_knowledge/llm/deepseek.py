"""Minimal OpenAI-compatible DeepSeek HTTP client for ZEROK-1.

The client implements the ``generate(prompt) -> str`` boundary expected by
ZEROK-4 and exposes lower-level JSON/chat methods used by the original PoC.
"""

from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from typing import Any

import httpx

from zero_knowledge.task_generation.errors import ProviderUnavailableError

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_MAX_TOKENS = 4096

_JSON_OBJECT_FORMAT: dict[str, Any] = {"type": "json_object"}


class DeepSeekJsonError(ValueError):
    """The model response cannot be parsed as a JSON object."""


@dataclass
class ChatResult:
    """Raw model content and request metadata."""

    content: str
    usage: dict[str, Any] | None
    attempts: int
    latency_ms: float


class DeepSeekClient:
    """Synchronous ``chat/completions`` client with JSON mode and retries."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        max_tokens: int | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        self._base_url = (
            base_url or os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL)
        ).rstrip("/")
        self._model = model or os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL)
        self._timeout = _coalesce(
            timeout, _env_float("DEEPSEEK_TIMEOUT"), DEFAULT_TIMEOUT
        )
        self._max_retries = _coalesce(
            max_retries, _env_int("DEEPSEEK_MAX_RETRIES"), DEFAULT_MAX_RETRIES
        )
        self._max_tokens = _coalesce(
            max_tokens, _env_int("DEEPSEEK_MAX_TOKENS"), DEFAULT_MAX_TOKENS
        )
        self._client = httpx.Client(timeout=self._timeout, transport=transport)

    @property
    def model(self) -> str:
        return self._model

    def generate(self, prompt: str) -> str:
        """Return the model response as JSON text for ZEROK-4.

        Markdown fences and surrounding commentary are removed when a complete
        JSON value can be extracted. Otherwise the raw text is returned so that
        ZEROK-4 can classify it as a content validation failure.
        """

        result = self.chat(prompt)
        extracted = _extract_json_text(result.content)
        return extracted if extracted is not None else result.content

    def chat_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return the response parsed as a JSON object."""

        result = self.chat(prompt, system=system, response_format=response_format)
        return _parse_json_object(result.content)

    def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> ChatResult:
        """Perform one logical request and return content plus metadata."""

        if not self._api_key:
            raise ProviderUnavailableError("DEEPSEEK_API_KEY is not set")

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": False,
            "max_tokens": self._max_tokens,
            "response_format": response_format or _JSON_OBJECT_FORMAT,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self._base_url}/chat/completions"

        for attempt in range(self._max_retries + 1):
            started = time.monotonic()
            try:
                response = self._client.post(url, json=payload, headers=headers)
            except httpx.TimeoutException as exc:
                if attempt < self._max_retries:
                    _sleep(_backoff(attempt))
                    continue
                raise ProviderUnavailableError(
                    f"DeepSeek request timed out after {self._timeout:g}s"
                ) from exc
            except httpx.HTTPError as exc:
                if attempt < self._max_retries:
                    _sleep(_backoff(attempt))
                    continue
                raise ProviderUnavailableError(
                    f"DeepSeek transport error: {exc}"
                ) from exc

            latency_ms = (time.monotonic() - started) * 1000

            if response.status_code in (401, 403):
                raise ProviderUnavailableError(
                    f"DeepSeek authentication failed (HTTP {response.status_code})"
                )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < self._max_retries:
                    _sleep(_retry_after(response) or _backoff(attempt))
                    continue
                raise ProviderUnavailableError(
                    f"DeepSeek unavailable (HTTP {response.status_code}) after "
                    f"{self._max_retries + 1} attempts"
                )
            if response.status_code >= 400:
                raise ProviderUnavailableError(
                    f"DeepSeek error HTTP {response.status_code}: {response.text[:400]}"
                )

            data = response.json()
            try:
                content = data["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError) as exc:
                raise DeepSeekJsonError(
                    f"unexpected DeepSeek response shape: {exc}"
                ) from exc
            return ChatResult(
                content=content,
                usage=data.get("usage"),
                attempts=attempt + 1,
                latency_ms=latency_ms,
            )

        raise AssertionError("unreachable")

    def close(self) -> None:
        self._client.close()


def _coalesce(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _env_float(name: str) -> float | None:
    value = os.environ.get(name)
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _env_int(name: str) -> int | None:
    value = os.environ.get(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _backoff(attempt: int) -> float:
    base = min(2**attempt, 8)
    return base * 0.5 * (1 + random.random() * 0.2)


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_json_text(text: str) -> str | None:
    """Extract a complete JSON value from fences or surrounding text."""

    content = text.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    pairs = {"{": "}", "[": "]"}
    start = next((i for i, char in enumerate(content) if char in pairs), -1)
    if start == -1:
        return None

    stack: list[str] = []
    in_string = False
    escaped = False
    for index in range(start, len(content)):
        char = content[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in pairs:
            stack.append(char)
        elif char in ("}", "]"):
            if not stack or pairs[stack.pop()] != char:
                return None
            if not stack:
                candidate = content[start : index + 1]
                try:
                    json.loads(candidate)
                except json.JSONDecodeError:
                    return None
                return candidate
    return None


def _parse_json_object(content: str) -> dict[str, Any]:
    text = _extract_json_text(content)
    if text is None:
        raise DeepSeekJsonError("model output does not contain a JSON object")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DeepSeekJsonError(f"model output is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise DeepSeekJsonError(
            "model JSON root must be an object, not an array/scalar"
        )
    return value
