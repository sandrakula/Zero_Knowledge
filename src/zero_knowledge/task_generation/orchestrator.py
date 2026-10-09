"""Bounded ZEROK-4 generation and reference-validation workflow."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from zero_knowledge.schemas import (
    ReferenceSolution,
    Task,
    TaskSet,
    TaskSetItem,
    TaskSetPurpose,
    TestCase,
)

from .errors import (
    AttemptsExhaustedError,
    GeneratedBlockInvalidError,
    IsolatedExecutionUnavailableError,
    ProviderUnavailableError,
    ReferenceSolutionFailedError,
)
from .ports import IsolatedExecutionRunner, TaskGenerationProvider
from .prompt import build_task_generation_prompt
from .validation import parse_and_validate_block, tests_for_task

GeneratedTaskBlock = tuple[TaskSet, list[Task], list[ReferenceSolution], list[TestCase]]


@dataclass(frozen=True, slots=True)
class UnverifiedTaskBlock:
    """A schema-valid block whose reference code was deliberately not run."""

    task_set: TaskSet
    tasks: list[Task]
    solutions: list[ReferenceSolution]
    tests: list[TestCase]
    generation_attempts: int
    generation: Literal["success"] = "success"
    schema_validation: Literal["success"] = "success"
    reference_execution: Literal["not_run"] = "not_run"
    reason: str = "ZEROK-3 isolated execution is unavailable"


class TaskBlockService:
    """Generate a three-task block and verify references through ZEROK-3."""

    def __init__(
        self,
        provider: TaskGenerationProvider,
        runner: IsolatedExecutionRunner,
        *,
        max_attempts: int = 3,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._provider = provider
        self._runner = runner
        self._max_attempts = max_attempts
        self._attempts_used = 0

    @property
    def attempts_used(self) -> int:
        """Number of content-generation attempts used by the latest call."""

        return self._attempts_used

    def generate(self) -> GeneratedTaskBlock:
        prompt = build_task_generation_prompt()
        last_error: GeneratedBlockInvalidError | ReferenceSolutionFailedError | None = (
            None
        )

        self._attempts_used = 0
        for attempt in range(1, self._max_attempts + 1):
            self._attempts_used = attempt
            raw_response = self._request_provider(prompt)

            try:
                tasks, solutions, tests = parse_and_validate_block(raw_response)
                self._verify_references(tasks, solutions, tests)
            except (GeneratedBlockInvalidError, ReferenceSolutionFailedError) as error:
                last_error = error
                continue

            task_set = self._build_task_set(tasks)
            return task_set, tasks, solutions, tests

        assert last_error is not None
        raise AttemptsExhaustedError(self._max_attempts, last_error)

    def generate_without_reference_execution(self) -> UnverifiedTaskBlock:
        """Generate and validate a block while explicitly leaving code unexecuted.

        It never calls the configured runner, and its return type cannot be
        confused with the fully verified tuple returned by :meth:`generate`.
        """

        prompt = build_task_generation_prompt()
        last_error: GeneratedBlockInvalidError | None = None

        self._attempts_used = 0
        for attempt in range(1, self._max_attempts + 1):
            self._attempts_used = attempt
            raw_response = self._request_provider(prompt)
            try:
                tasks, solutions, tests = parse_and_validate_block(raw_response)
            except GeneratedBlockInvalidError as error:
                last_error = error
                continue

            return UnverifiedTaskBlock(
                task_set=self._build_task_set(tasks),
                tasks=tasks,
                solutions=solutions,
                tests=tests,
                generation_attempts=attempt,
            )

        assert last_error is not None
        raise AttemptsExhaustedError(self._max_attempts, last_error)

    def _request_provider(self, prompt: str) -> str:
        try:
            return self._provider.generate(prompt)
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError("task generation provider failed") from error

    @staticmethod
    def _build_task_set(tasks: Sequence[Task]) -> TaskSet:
        return TaskSet(
            title="Python diagnostic task block",
            purpose=TaskSetPurpose.DIAGNOSTIC,
            description="Three generated Python tasks: easy, medium, hard.",
            items=[
                TaskSetItem(task_id=task.id, order=index)
                for index, task in enumerate(tasks)
            ],
        )

    def _verify_references(
        self,
        tasks: Sequence[Task],
        solutions: Sequence[ReferenceSolution],
        tests: list[TestCase],
    ) -> None:
        solutions_by_task = {solution.task_id: solution for solution in solutions}
        for task in tasks:
            try:
                self._runner.verify_reference(
                    task,
                    solutions_by_task[task.id],
                    tests_for_task(task, tests),
                )
            except (ReferenceSolutionFailedError, IsolatedExecutionUnavailableError):
                raise
            except Exception as error:
                raise IsolatedExecutionUnavailableError(
                    "isolated execution runner failed"
                ) from error
