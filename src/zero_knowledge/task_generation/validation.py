"""Deterministic validation of the provider's ZEROK-2 entities."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from zero_knowledge.schemas import (
    Difficulty,
    ReferenceSolution,
    Task,
    TaskType,
    TestCase,
)

from .errors import GeneratedBlockInvalidError

ParsedEntities = tuple[list[Task], list[ReferenceSolution], list[TestCase]]

_EXPECTED_DIFFICULTIES = [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]
_REQUIRED_ENVELOPE_KEYS = {"tasks", "solutions", "tests"}


def parse_and_validate_block(raw_response: str) -> ParsedEntities:
    """Parse JSON and validate both schemas and cross-entity invariants."""

    try:
        payload: Any = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError) as error:
        raise GeneratedBlockInvalidError(
            f"response is not valid JSON: {error}"
        ) from error

    if not isinstance(payload, dict):
        raise GeneratedBlockInvalidError("response root must be a JSON object")

    actual_keys = set(payload)
    if actual_keys != _REQUIRED_ENVELOPE_KEYS:
        missing = sorted(_REQUIRED_ENVELOPE_KEYS - actual_keys)
        extra = sorted(actual_keys - _REQUIRED_ENVELOPE_KEYS)
        raise GeneratedBlockInvalidError(
            f"invalid response keys; missing={missing}, extra={extra}"
        )

    try:
        tasks = TypeAdapter(list[Task]).validate_python(payload["tasks"])
        solutions = TypeAdapter(list[ReferenceSolution]).validate_python(
            payload["solutions"]
        )
        tests = TypeAdapter(list[TestCase]).validate_python(payload["tests"])
    except ValidationError as error:
        raise GeneratedBlockInvalidError(
            f"response violates ZEROK-2 schemas: {error}"
        ) from error

    _validate_entities(tasks, solutions, tests)
    return tasks, solutions, tests


def _validate_entities(
    tasks: list[Task],
    solutions: list[ReferenceSolution],
    tests: list[TestCase],
) -> None:
    if len(tasks) != 3:
        raise GeneratedBlockInvalidError(f"expected exactly 3 tasks, got {len(tasks)}")

    difficulties = [task.difficulty for task in tasks]
    if difficulties != _EXPECTED_DIFFICULTIES:
        counts = Counter(difficulty.value for difficulty in difficulties)
        raise GeneratedBlockInvalidError(
            "tasks must be ordered easy, medium, hard exactly once each; "
            f"received={dict(counts)}"
        )

    task_ids = [task.id for task in tasks]
    if len(set(task_ids)) != len(task_ids):
        raise GeneratedBlockInvalidError("task ids must be unique")

    if len(solutions) != 3:
        raise GeneratedBlockInvalidError(
            f"expected exactly 3 reference solutions, got {len(solutions)}"
        )

    solution_ids = [solution.id for solution in solutions]
    if len(set(solution_ids)) != len(solution_ids):
        raise GeneratedBlockInvalidError("reference solution ids must be unique")

    test_ids = [case.id for case in tests]
    if len(set(test_ids)) != len(test_ids):
        raise GeneratedBlockInvalidError("test case ids must be unique")

    tasks_by_id = {task.id: task for task in tasks}
    solutions_by_id = {solution.id: solution for solution in solutions}
    tests_by_id = {case.id: case for case in tests}

    if {solution.task_id for solution in solutions} != set(task_ids):
        raise GeneratedBlockInvalidError(
            "there must be exactly one reference solution per generated task"
        )
    if any(case.task_id not in tasks_by_id for case in tests):
        raise GeneratedBlockInvalidError(
            "all test cases must belong to a generated task"
        )

    for task in tasks:
        _validate_task_content(task)
        if task.solution_id is None or task.solution_id not in solutions_by_id:
            raise GeneratedBlockInvalidError(
                f"task {task.id} has no linked reference solution"
            )
        solution = solutions_by_id[task.solution_id]
        if solution.task_id != task.id:
            raise GeneratedBlockInvalidError(
                f"task {task.id} and its reference solution disagree"
            )
        _validate_solution_content(solution)

        if not task.test_ids:
            raise GeneratedBlockInvalidError(f"task {task.id} has no linked tests")
        if len(set(task.test_ids)) != len(task.test_ids):
            raise GeneratedBlockInvalidError(
                f"task {task.id} contains duplicate test references"
            )
        try:
            linked_tests = [tests_by_id[test_id] for test_id in task.test_ids]
        except KeyError as error:
            raise GeneratedBlockInvalidError(
                f"task {task.id} references a missing test"
            ) from error
        if any(case.task_id != task.id for case in linked_tests):
            raise GeneratedBlockInvalidError(
                f"task {task.id} references another task's test"
            )
        if len({case.order for case in linked_tests}) != len(linked_tests):
            raise GeneratedBlockInvalidError(
                f"task {task.id} has duplicate test order values"
            )
        for case in linked_tests:
            _validate_test_content(case)

    referenced_test_ids = {test_id for task in tasks for test_id in task.test_ids}
    if referenced_test_ids != set(test_ids):
        raise GeneratedBlockInvalidError(
            "tests must all be referenced by exactly one generated task"
        )


def _validate_task_content(task: Task) -> None:
    if task.task_type is not TaskType.PROGRAMMING:
        raise GeneratedBlockInvalidError(f"task {task.id} is not a programming task")
    if not task.title.strip() or not task.statement.strip():
        raise GeneratedBlockInvalidError(f"task {task.id} has blank title or statement")
    language = task.metadata.get("language")
    if not isinstance(language, str) or language.strip().casefold() != "python":
        raise GeneratedBlockInvalidError(
            f"task {task.id} must declare metadata.language='python'"
        )


def _validate_solution_content(solution: ReferenceSolution) -> None:
    if not solution.approach.strip() or not solution.final_answer.strip():
        raise GeneratedBlockInvalidError(
            f"reference solution {solution.id} has blank required text"
        )
    if solution.code is None or not solution.code.strip():
        raise GeneratedBlockInvalidError(
            f"reference solution {solution.id} has no executable code"
        )


def _validate_test_content(case: TestCase) -> None:
    if not isinstance(case.input_data, str) or not isinstance(
        case.expected_output, str
    ):
        raise GeneratedBlockInvalidError(f"test {case.id} input/output must be strings")
    if not case.expected_output.strip():
        raise GeneratedBlockInvalidError(f"test {case.id} has blank expected output")


def tests_for_task(task: Task, tests: list[TestCase]) -> list[TestCase]:
    """Return linked tests in declared order after validation has succeeded."""

    by_id: dict[UUID, TestCase] = {case.id: case for case in tests}
    return [by_id[test_id] for test_id in task.test_ids]
