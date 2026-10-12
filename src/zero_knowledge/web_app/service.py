"""Stateful orchestration of the ZEROK-7 end-to-end diagnostic."""

from __future__ import annotations

import json
import threading
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from zero_knowledge.learning_path import LearningPathService
from zero_knowledge.schemas import (
    Answer,
    AnswerFormat,
    AnswerStatus,
    KnowledgeProfile,
    ReferenceSolution,
    Roadmap,
    SolutionReview,
    Task,
    TaskSet,
    TestCase,
)
from zero_knowledge.solution_review import SolutionReviewService
from zero_knowledge.task_generation import TaskBlockService
from zero_knowledge.task_generation.validation import tests_for_task

from .evaluation import Evaluation, StudentSolutionEvaluator


class DiagnosticStateError(Exception):
    """A requested transition is invalid for the current session."""


@dataclass(slots=True)
class DiagnosticSession:
    id: UUID
    student_id: UUID
    task_set: TaskSet
    tasks: list[Task]
    solutions: list[ReferenceSolution]
    tests: list[TestCase]
    attempts: dict[UUID, list[Answer]] = field(default_factory=dict)
    evaluations: dict[UUID, Evaluation] = field(default_factory=dict)
    reviews: list[SolutionReview] | None = None
    explanations: dict[str, str] | None = None
    profile: KnowledgeProfile | None = None
    roadmap: Roadmap | None = None
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class DiagnosticService:
    """Use ZEROK-1—6 while keeping private entities on the backend."""

    def __init__(
        self,
        task_blocks: TaskBlockService,
        evaluator: StudentSolutionEvaluator,
        reviews: SolutionReviewService,
        learning_path: LearningPathService,
    ) -> None:
        self._task_blocks = task_blocks
        self._evaluator = evaluator
        self._review_service = reviews
        self._learning_path = learning_path
        self._sessions: dict[UUID, DiagnosticSession] = {}
        self._sessions_lock = threading.RLock()
        self._generation_lock = threading.Lock()

    def create_diagnostic(self) -> dict[str, Any]:
        # TaskBlockService exposes latest-attempt state, so serialize calls to this
        # shared instance even though the HTTP server itself is threaded.
        with self._generation_lock:
            task_set, tasks, solutions, tests = self._task_blocks.generate()
        session = DiagnosticSession(
            id=uuid4(),
            student_id=uuid4(),
            task_set=task_set,
            tasks=tasks,
            solutions=solutions,
            tests=tests,
        )
        with self._sessions_lock:
            self._sessions[session.id] = session
        return self._public_diagnostic(session)

    def submit_solution(
        self, session_id: UUID, task_id: UUID, code: str
    ) -> dict[str, Any]:
        session = self._session(session_id)
        with session.lock:
            task_index = self._task_index(session, task_id)
            self._require_previous_passes(session, task_index)
            task = session.tasks[task_index]
            attempts = session.attempts.setdefault(task_id, [])
            if (
                task.allowed_attempts is not None
                and len(attempts) >= task.allowed_attempts
            ):
                raise DiagnosticStateError("Лимит попыток для этой задачи исчерпан.")
            if not isinstance(code, str) or not code.strip():
                raise ValueError("Поле code не может быть пустым.")

            evaluation = self._evaluator.evaluate(
                code, tests_for_task(task, session.tests)
            )
            answer = Answer(
                task_id=task.id,
                student_id=session.student_id,
                attempt_number=len(attempts) + 1,
                format=AnswerFormat.CODE,
                content=code,
                code_language="python",
                status=AnswerStatus.CORRECT
                if evaluation.passed
                else AnswerStatus.INCORRECT,
                is_correct=evaluation.passed,
                score=1.0 if evaluation.passed else 0.0,
                feedback=(
                    "Решение прошло все проверки."
                    if evaluation.passed
                    else evaluation.details
                ),
                execution_log=evaluation.execution_log,
            )
            attempts.append(answer)
            session.evaluations[task_id] = evaluation
            self._invalidate_downstream(session)
            return {
                "answer": answer.model_dump(mode="json"),
                "evaluation": {
                    "state": evaluation.state,
                    "kind": evaluation.kind,
                    "details": evaluation.details,
                },
            }

    def create_reviews(self, session_id: UUID) -> list[dict[str, Any]]:
        session = self._session(session_id)
        with session.lock:
            self._require_all_passed(session)
            if session.reviews is None:
                reviews: list[SolutionReview] = []
                for task in session.tasks:
                    answer = session.attempts[task.id][-1]
                    reviews.append(self._review_service.review(task, answer, []))
                session.reviews = reviews
            return [review.model_dump(mode="json") for review in session.reviews]

    def submit_explanations(
        self, session_id: UUID, explanations: Sequence[dict[str, Any]]
    ) -> dict[str, Any]:
        session = self._session(session_id)
        with session.lock:
            if session.reviews is None:
                raise DiagnosticStateError("Сначала нужно сформировать вопросы.")
            expected = {
                f"{review.answer_id}:{question.order}"
                for review in session.reviews
                for question in review.questions
            }
            received: dict[str, str] = {}
            for item in explanations:
                if not isinstance(item, dict):
                    raise TypeError("Каждый ответ должен быть JSON-объектом.")
                key = f"{item.get('answer_id')}:{item.get('question_order')}"
                content = item.get("content")
                if (
                    key in received
                    or not isinstance(content, str)
                    or not content.strip()
                ):
                    raise ValueError("Все вопросы требуют одного непустого ответа.")
                received[key] = content.strip()
            if set(received) != expected:
                raise ValueError("Набор ответов не соответствует вопросам сессии.")
            session.explanations = received
            session.profile = None
            session.roadmap = None
            return {
                "assessments": [
                    review.assessment.model_dump(mode="json")
                    for review in session.reviews
                ]
            }

    def get_profile(self, session_id: UUID) -> dict[str, Any]:
        session = self._session(session_id)
        with session.lock:
            if session.explanations is None or session.reviews is None:
                raise DiagnosticStateError("Сначала ответьте на вопросы по решениям.")
            if session.profile is None:
                session.profile = self._learning_path.build_profile(
                    session.student_id, self._observations(session)
                )
            return {
                "profile": session.profile.model_dump(mode="json"),
                "assessments": [
                    review.assessment.model_dump(mode="json")
                    for review in session.reviews
                ],
            }

    def get_roadmap(self, session_id: UUID) -> dict[str, Any]:
        session = self._session(session_id)
        with session.lock:
            if session.profile is None:
                raise DiagnosticStateError("Сначала сформируйте профиль знаний.")
            if session.roadmap is None:
                session.roadmap = self._learning_path.build_roadmap(
                    session.student_id,
                    session.profile,
                    goal="Укрепить навыки решения задач на Python",
                    assessment_summary=self._assessment_summary(session),
                )
            return session.roadmap.model_dump(mode="json")

    def _session(self, session_id: UUID) -> DiagnosticSession:
        with self._sessions_lock:
            try:
                return self._sessions[session_id]
            except KeyError as error:
                raise KeyError("Диагностическая сессия не найдена.") from error

    @staticmethod
    def _task_index(session: DiagnosticSession, task_id: UUID) -> int:
        for index, task in enumerate(session.tasks):
            if task.id == task_id:
                return index
        raise KeyError("Задача не относится к этой сессии.")

    @staticmethod
    def _require_previous_passes(session: DiagnosticSession, task_index: int) -> None:
        for task in session.tasks[:task_index]:
            if not session.evaluations.get(task.id, Evaluation("", "", "")).passed:
                raise DiagnosticStateError("Сначала пройдите предыдущую задачу.")

    @staticmethod
    def _require_all_passed(session: DiagnosticSession) -> None:
        if any(
            not session.evaluations.get(task.id, Evaluation("", "", "")).passed
            for task in session.tasks
        ):
            raise DiagnosticStateError("Все три задачи должны быть успешно решены.")

    @staticmethod
    def _invalidate_downstream(session: DiagnosticSession) -> None:
        session.reviews = None
        session.explanations = None
        session.profile = None
        session.roadmap = None

    @staticmethod
    def _public_diagnostic(session: DiagnosticSession) -> dict[str, Any]:
        task_set = {
            "id": str(session.task_set.id),
            "title": session.task_set.title,
            "purpose": session.task_set.purpose.value,
            "description": session.task_set.description,
        }
        tasks = []
        presentations: dict[str, Any] = {}
        for task in session.tasks:
            public_task = {
                "id": str(task.id),
                "title": task.title,
                "statement": task.statement,
                "difficulty": task.difficulty.value,
                "cognitive_depth": task.cognitive_depth.value,
                "topic_ids": task.topic_ids,
                "tags": task.tags,
                "prerequisites": task.prerequisites,
                "allowed_attempts": task.allowed_attempts,
                "time_limit_seconds": task.time_limit_seconds,
                "metadata": {"language": task.metadata.get("language", "python")},
            }
            tasks.append(public_task)
            visible = [
                case
                for case in tests_for_task(task, session.tests)
                if not case.is_hidden
            ]
            presentations[str(task.id)] = {
                "starterCode": "",
                "examples": [
                    {
                        "description": case.description,
                        "input_data": case.input_data,
                        "expected_output": case.expected_output,
                    }
                    for case in visible
                ],
            }
        return {
            "session_id": str(session.id),
            "student_id": str(session.student_id),
            "taskSet": task_set,
            "tasks": tasks,
            "taskPresentation": presentations,
        }

    @staticmethod
    def _assessment_summary(session: DiagnosticSession) -> str:
        assert session.reviews is not None
        return "\n".join(
            f"- {task.title}: {review.assessment.understanding.value}; "
            f"independence={review.assessment.independence:.2f}; "
            f"attempts={len(session.attempts[task.id])}."
            for task, review in zip(session.tasks, session.reviews, strict=True)
        )

    def _observations(self, session: DiagnosticSession) -> str:
        assert session.reviews is not None and session.explanations is not None
        records: list[dict[str, Any]] = []
        for task, review in zip(session.tasks, session.reviews, strict=True):
            answer = session.attempts[task.id][-1]
            records.append(
                {
                    "task": {
                        "title": task.title,
                        "difficulty": task.difficulty.value,
                        "topics": task.topic_ids,
                    },
                    "attempts": len(session.attempts[task.id]),
                    "solution_code": answer.content,
                    "assessment": review.assessment.model_dump(mode="json"),
                    "question_answers": [
                        {
                            "question": question.text,
                            "kind": question.kind.value,
                            "answer": session.explanations[
                                f"{review.answer_id}:{question.order}"
                            ],
                        }
                        for question in review.questions
                    ],
                }
            )
        return json.dumps(records, ensure_ascii=False, indent=2)
