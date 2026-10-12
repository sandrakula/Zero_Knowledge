"""Transport-neutral JSON API for the ZEROK-7 web application."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from zero_knowledge.execution.sandbox import SandboxUnavailableError
from zero_knowledge.learning_path import (
    LearningPathAttemptsExhaustedError,
    LearningPathInvalidError,
)
from zero_knowledge.llm import DeepSeekJsonError
from zero_knowledge.solution_review import SolutionReviewAttemptsExhaustedError
from zero_knowledge.task_generation import (
    AttemptsExhaustedError,
    GeneratedBlockInvalidError,
    IsolatedExecutionUnavailableError,
    ProviderUnavailableError,
)

from .service import DiagnosticService, DiagnosticStateError

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ApiResponse:
    status: int
    body: dict[str, Any] | list[Any]


class ApiError(Exception):
    def __init__(
        self, status: int, code: str, message: str, *, retryable: bool = False
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)

    def response(self) -> ApiResponse:
        return ApiResponse(
            self.status,
            {
                "error": {
                    "code": self.code,
                    "message": self.message,
                    "retryable": self.retryable,
                }
            },
        )


_SUBMISSION = re.compile(
    r"^/api/diagnostics/(?P<session>[0-9a-f-]+)/tasks/(?P<task>[0-9a-f-]+)/submissions$"
)
_SESSION_ACTION = re.compile(
    r"^/api/diagnostics/(?P<session>[0-9a-f-]+)/(?P<action>reviews|explanations|profile|roadmap)$"
)


class ApiApplication:
    """Route API calls and translate domain failures into stable error envelopes."""

    def __init__(self, diagnostics: DiagnosticService) -> None:
        self._diagnostics = diagnostics

    def handle(self, method: str, path: str, raw_body: bytes = b"") -> ApiResponse:
        try:
            return self._dispatch(method.upper(), path, raw_body)
        except ApiError as error:
            return error.response()
        except ProviderUnavailableError:
            return ApiError(
                503,
                "provider_unavailable",
                "DeepSeek недоступен или не настроен. Проверьте backend и повторите запрос.",
                retryable=True,
            ).response()
        except (IsolatedExecutionUnavailableError, SandboxUnavailableError):
            return ApiError(
                503,
                "sandbox_unavailable",
                "Docker sandbox недоступна. Проверьте daemon и локальный image.",
                retryable=True,
            ).response()
        except (AttemptsExhaustedError, GeneratedBlockInvalidError):
            return ApiError(
                502,
                "generation_invalid",
                "DeepSeek не смог сформировать валидный блок из трёх задач.",
                retryable=True,
            ).response()
        except SolutionReviewAttemptsExhaustedError:
            return ApiError(
                502,
                "questions_invalid",
                "Не удалось сформировать валидные вопросы по решениям.",
                retryable=True,
            ).response()
        except (
            LearningPathAttemptsExhaustedError,
            LearningPathInvalidError,
            DeepSeekJsonError,
        ):
            return ApiError(
                502,
                "learning_path_invalid",
                "Не удалось сформировать валидный профиль или roadmap.",
                retryable=True,
            ).response()
        except ValidationError:
            return ApiError(
                422,
                "validation_error",
                "Данные не соответствуют серверной схеме.",
            ).response()
        except (TypeError, ValueError) as error:
            return ApiError(400, "invalid_request", str(error)).response()
        except DiagnosticStateError as error:
            return ApiError(409, "invalid_state", str(error)).response()
        except KeyError as error:
            return ApiError(404, "not_found", str(error).strip("'")).response()
        except Exception:
            logger.exception("unhandled ZEROK-7 API error")
            return ApiError(
                500,
                "internal_error",
                "Внутренняя ошибка backend. Повторите запрос или проверьте журнал сервера.",
                retryable=True,
            ).response()

    def _dispatch(self, method: str, path: str, raw_body: bytes) -> ApiResponse:
        if method == "GET" and path == "/api/health":
            return ApiResponse(200, {"status": "ok"})
        if method == "POST" and path == "/api/diagnostics":
            self._json_body(raw_body, allow_empty=True)
            return ApiResponse(201, self._diagnostics.create_diagnostic())

        submission = _SUBMISSION.fullmatch(path)
        if method == "POST" and submission:
            body = self._json_body(raw_body)
            return ApiResponse(
                200,
                self._diagnostics.submit_solution(
                    self._uuid(submission["session"]),
                    self._uuid(submission["task"]),
                    body.get("code"),
                ),
            )

        action_match = _SESSION_ACTION.fullmatch(path)
        if method == "POST" and action_match:
            session_id = self._uuid(action_match["session"])
            action = action_match["action"]
            if action == "reviews":
                self._json_body(raw_body, allow_empty=True)
                return ApiResponse(200, self._diagnostics.create_reviews(session_id))
            if action == "explanations":
                body = self._json_body(raw_body)
                explanations = body.get("answers")
                if not isinstance(explanations, list):
                    raise ApiError(
                        400, "invalid_request", "Поле answers должно быть массивом."
                    )
                return ApiResponse(
                    200,
                    self._diagnostics.submit_explanations(session_id, explanations),
                )
            if action == "profile":
                self._json_body(raw_body, allow_empty=True)
                return ApiResponse(200, self._diagnostics.get_profile(session_id))
            if action == "roadmap":
                self._json_body(raw_body, allow_empty=True)
                return ApiResponse(200, self._diagnostics.get_roadmap(session_id))

        raise ApiError(404, "not_found", "Маршрут API не найден.")

    @staticmethod
    def _json_body(raw_body: bytes, *, allow_empty: bool = False) -> dict[str, Any]:
        if not raw_body and allow_empty:
            return {}
        try:
            value = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError(
                400, "invalid_json", "Тело запроса должно быть JSON-объектом."
            ) from error
        if not isinstance(value, dict):
            raise ApiError(
                400, "invalid_json", "Тело запроса должно быть JSON-объектом."
            )
        return value

    @staticmethod
    def _uuid(value: str) -> UUID:
        try:
            return UUID(value)
        except ValueError as error:
            raise ApiError(400, "invalid_id", "Некорректный UUID в URL.") from error
