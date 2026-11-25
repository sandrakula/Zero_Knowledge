"""Map ejudge status codes to the domain verdict enum.

Only statuses confirmed by the integration contract are mapped here. Unknown
statuses become ``UNKNOWN`` and keep the raw code, instead of pretending to be
an answer verdict.
"""

from __future__ import annotations

from src.db.informatics import Verdict

IN_PROGRESS_STATUSES = {11, 96, 98, 377}
SOLVED_STATUSES = {0, 8}

STATUS_TO_VERDICT: dict[int, Verdict] = {
    0: Verdict.ACCEPTED,
    8: Verdict.ACCEPTED,
    1: Verdict.COMPILATION_ERROR,
    2: Verdict.PRESENTATION_ERROR,
    3: Verdict.WRONG_ANSWER,
    4: Verdict.RUNTIME_ERROR,
    5: Verdict.TIME_LIMIT,
    6: Verdict.MEMORY_LIMIT,
    7: Verdict.RUNTIME_ERROR,
    9: Verdict.RUNTIME_ERROR,
    10: Verdict.RUNTIME_ERROR,
}

VERDICT_LABELS: dict[Verdict, str] = {
    Verdict.ACCEPTED: "Принято",
    Verdict.WRONG_ANSWER: "Неверный ответ",
    Verdict.COMPILATION_ERROR: "Ошибка компиляции",
    Verdict.RUNTIME_ERROR: "Ошибка выполнения",
    Verdict.TIME_LIMIT: "Превышено время",
    Verdict.MEMORY_LIMIT: "Превышена память",
    Verdict.PRESENTATION_ERROR: "Ошибка формата вывода",
    Verdict.PARTIAL: "Частичное решение",
    Verdict.INTERNAL_ERROR: "Внутренняя ошибка",
    Verdict.UNKNOWN: "Неизвестный вердикт",
}


def is_in_progress(ejudge_status: int | None) -> bool:
    return ejudge_status in IN_PROGRESS_STATUSES


def is_solved(ejudge_status: int | None) -> bool:
    return ejudge_status in SOLVED_STATUSES


def map_verdict(ejudge_status: int | None) -> Verdict:
    if ejudge_status is None:
        return Verdict.UNKNOWN
    return STATUS_TO_VERDICT.get(ejudge_status, Verdict.UNKNOWN)


def verdict_label(verdict: str | Verdict) -> str:
    try:
        value = verdict if isinstance(verdict, Verdict) else Verdict(verdict)
    except ValueError:
        value = Verdict.UNKNOWN
    return VERDICT_LABELS[value]
