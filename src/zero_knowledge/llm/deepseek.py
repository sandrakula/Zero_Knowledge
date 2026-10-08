"""Минимальный HTTP-клиент DeepSeek (OpenAI-совместимый) для ZEROK-1.

Реализует границу ``generate(prompt) -> str``, которую ожидает ZEROK-4
(``TaskGenerationProvider``), и JSON-режим для сценариев PoC (профиль,
roadmap, вопросы по решениям).

Поведение при ошибках:

- 401/403 (auth) и прочие 4xx — немедленный :class:`ProviderUnavailableError`,
  без retries: повтор того же запроса не поможет.
- 429 (rate limit) и 5xx — повтор с экспоненциальной задержкой и учётом
  заголовка ``Retry-After``.
- таймаут/сетевые ошибки — повтор с экспоненциальной задержкой.
- исчерпание retries — :class:`ProviderUnavailableError`.
- ответ, который не удаётся разобрать как JSON-объект, — :class:`DeepSeekJsonError`.
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
    """Модель вернула текст, который нельзя разобрать как JSON-объект."""


@dataclass
class ChatResult:
    """Сырой ответ модели плюс служебная информация о вызове."""

    content: str
    usage: dict[str, Any] | None
    attempts: int
    latency_ms: float


class DeepSeekClient:
    """Синхронный клиент ``chat/completions`` с JSON-режимом и retries."""

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
        """Вернуть ответ как JSON-текст (граница ZEROK-1).

        Если модель оборачивает JSON в Markdown-ограждение или добавляет
        текст, возвращается вырезанная JSON-подстрока; иначе — сырой текст,
        чтобы валидация в ZEROK-4 классифицировала его как контентную ошибку.
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
        """Вернуть ответ, разобранный как JSON-объект.

        Поднимает :class:`DeepSeekJsonError`, если ответ не является
        JSON-объектом.
        """

        result = self.chat(prompt, system=system, response_format=response_format)
        return _parse_json_object(result.content)

    def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> ChatResult:
        """Выполнить запрос и вернуть сырой ответ с метаданными."""

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
    """Экспоненциальная задержка с джиттером: ~0.5s, 1s, 2s, ... до 8s."""
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
    """Вырезать JSON-подстроку (убирая Markdown-ограждения и лишний текст)."""

    content = text.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    pairs = {"{": "}", "[": "]"}
    start = next((i for i, ch in enumerate(content) if ch in pairs), -1)
    if start == -1:
        return None

    stack: list[str] = []
    in_string = False
    escaped = False
    for i in range(start, len(content)):
        ch = content[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in pairs:
            stack.append(ch)
        elif ch in ("}", "]"):
            if not stack or pairs[stack.pop()] != ch:
                return None
            if not stack:
                candidate = content[start : i + 1]
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
        raise DeepSeekJsonError("model JSON root must be an object, not an array/scalar")
    return value
