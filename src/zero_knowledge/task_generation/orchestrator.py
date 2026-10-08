"""Bounded ZEROK-4 generation and reference-validation workflow."""

from __future__ import annotations

from collections.abc import Sequence

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

    def generate(self) -> GeneratedTaskBlock:
        """Return canonical ZEROK-2 entities or raise a typed failure.

        Content/structure failures consume an attempt. Provider and isolated
        runner infrastructure failures stop immediately because regeneration
        cannot repair them.
        """

        prompt = build_task_generation_prompt()
        last_error: GeneratedBlockInvalidError | ReferenceSolutionFailedError | None = (
            None
        )

        for _attempt in range(1, self._max_attempts + 1):
            try:
                raw_response = self._provider.generate(prompt)
            except ProviderUnavailableError:
                raise
            except Exception as error:
                raise ProviderUnavailableError(
                    "task generation provider failed"
                ) from error

            try:
                tasks, solutions, tests = parse_and_validate_block(raw_response)
                self._verify_references(tasks, solutions, tests)
            except (GeneratedBlockInvalidError, ReferenceSolutionFailedError) as error:
                last_error = error
                continue

            task_set = TaskSet(
                title="Python diagnostic task block",
                purpose=TaskSetPurpose.DIAGNOSTIC,
                description="Three generated Python tasks: easy, medium, hard.",
                items=[
                    TaskSetItem(task_id=task.id, order=index)
                    for index, task in enumerate(tasks)
                ],
            )
            return task_set, tasks, solutions, tests

        assert last_error is not None
        raise AttemptsExhaustedError(self._max_attempts, last_error)

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
