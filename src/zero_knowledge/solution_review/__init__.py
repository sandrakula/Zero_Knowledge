"""Разбор решения студента: вопросы AI и оценка понимания.

После решения студента AI задаёт диагностические вопросы по решению, а
сервис формирует детерминированную оценку понимания с учётом правильности
ответа и факта/уровня использованных подсказок.
"""

from .errors import (
    QuestionsInvalidError,
    SolutionReviewAttemptsExhaustedError,
    SolutionReviewError,
)
from .ports import SolutionQuestionProvider
from .scoring import assess_understanding, compute_independence
from .service import SolutionReviewService
from .stubs import UnavailableSolutionQuestionProvider
from .validation import parse_and_validate_questions

__all__ = [
    "QuestionsInvalidError",
    "SolutionReviewAttemptsExhaustedError",
    "SolutionReviewError",
    "SolutionQuestionProvider",
    "SolutionReviewService",
    "UnavailableSolutionQuestionProvider",
    "assess_understanding",
    "compute_independence",
    "parse_and_validate_questions",
]
