"""ZEROK-4 orchestration and validation tests."""

from __future__ import annotations

import copy
import json
from collections.abc import Sequence
from uuid import uuid4

import pytest

from zero_knowledge.schemas import ReferenceSolution, Task
from zero_knowledge.schemas import TestCase as VerificationCase
from zero_knowledge.task_generation import (
    AttemptsExhaustedError,
    GeneratedBlockInvalidError,
    IsolatedExecutionUnavailableError,
    ProviderUnavailableError,
    ReferenceNotExecutedError,
    ReferenceSolutionFailedError,
    TaskBlockService,
    UnavailableExecutionRunner,
    parse_and_validate_block,
)


def make_payload(
    difficulties: Sequence[str] = ("easy", "medium", "hard"),
) -> dict[str, object]:
    tasks: list[dict[str, object]] = []
    solutions: list[dict[str, object]] = []
    tests: list[dict[str, object]] = []

    for order, difficulty in enumerate(difficulties):
        task_id = str(uuid4())
        solution_id = str(uuid4())
        test_id = str(uuid4())
        tasks.append(
            {
                "id": task_id,
                "title": f"Python task {order}",
                "discipline": "programming",
                "task_type": "programming",
                "statement": "Read an integer and print it.",
                "difficulty": difficulty,
                "cognitive_depth": "application",
                "solution_id": solution_id,
                "test_ids": [test_id],
                "metadata": {"language": "python"},
            }
        )
        solutions.append(
            {
                "id": solution_id,
                "task_id": task_id,
                "approach": "Read and print the value.",
                "final_answer": "The input value is printed.",
                "code": "print(input())",
            }
        )
        tests.append(
            {
                "id": test_id,
                "task_id": task_id,
                "description": "A positive integer",
                "input_data": "7\n",
                "expected_output": "7\n",
                "order": 0,
            }
        )

    return {"tasks": tasks, "solutions": solutions, "tests": tests}


class QueueProvider:
    def __init__(self, *responses: str) -> None:
        self._responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        assert "Canonical ZEROK-2 JSON Schemas" in prompt
        self.calls += 1
        return self._responses.pop(0)


class PassingRunner:
    def __init__(self) -> None:
        self.calls = 0

    def verify_reference(
        self,
        task: Task,
        solution: ReferenceSolution,
        tests: Sequence[VerificationCase],
    ) -> None:
        assert solution.task_id == task.id
        assert tests
        self.calls += 1


class FailingRunner:
    def __init__(self) -> None:
        self.calls = 0

    def verify_reference(
        self,
        task: Task,
        solution: ReferenceSolution,
        tests: Sequence[VerificationCase],
    ) -> None:
        del solution, tests
        self.calls += 1
        raise ReferenceSolutionFailedError(str(task.id), "output mismatch")


def test_valid_block_is_returned_as_canonical_schemas() -> None:
    provider = QueueProvider(json.dumps(make_payload()))
    runner = PassingRunner()
    service = TaskBlockService(provider, runner)

    task_set, tasks, solutions, tests = service.generate()

    assert [task.difficulty.value for task in tasks] == ["easy", "medium", "hard"]
    assert [item.task_id for item in task_set.items] == [task.id for task in tasks]
    assert len(solutions) == 3
    assert len(tests) == 3
    assert runner.calls == 3
    assert service.attempts_used == 1


@pytest.mark.parametrize("raw", ["not-json", "[]", '{"tasks": []}'])
def test_unparseable_or_wrong_response_structure_is_rejected(raw: str) -> None:
    with pytest.raises(GeneratedBlockInvalidError):
        parse_and_validate_block(raw)


@pytest.mark.parametrize("count", [2, 4])
def test_wrong_task_count_is_rejected(count: int) -> None:
    payload = make_payload(("easy", "medium", "hard")[:count])
    if count == 4:
        payload = make_payload(("easy", "medium", "hard", "hard"))

    with pytest.raises(GeneratedBlockInvalidError, match="exactly 3 tasks"):
        parse_and_validate_block(json.dumps(payload))


@pytest.mark.parametrize(
    "difficulties",
    [
        ("easy", "easy", "hard"),
        ("easy", "hard", "medium"),
        ("easy", "medium", "expert"),
    ],
)
def test_wrong_difficulty_set_or_order_is_rejected(difficulties: Sequence[str]) -> None:
    with pytest.raises(GeneratedBlockInvalidError, match="easy, medium, hard"):
        parse_and_validate_block(json.dumps(make_payload(difficulties)))


def test_missing_solution_and_tests_are_rejected() -> None:
    payload = make_payload()
    first_task = payload["tasks"][0]  # type: ignore[index]
    first_task["solution_id"] = None  # type: ignore[index]
    first_task["test_ids"] = []  # type: ignore[index]

    with pytest.raises(GeneratedBlockInvalidError):
        parse_and_validate_block(json.dumps(payload))


def test_failed_reference_triggers_bounded_regeneration() -> None:
    raw = json.dumps(make_payload())
    provider = QueueProvider(raw, raw)
    runner = FailingRunner()

    with pytest.raises(AttemptsExhaustedError) as caught:
        TaskBlockService(provider, runner, max_attempts=2).generate()

    assert caught.value.attempts == 2
    assert isinstance(caught.value.last_error, ReferenceSolutionFailedError)
    assert provider.calls == 2
    assert runner.calls == 2


def test_repeated_bad_generation_stops_at_configured_limit() -> None:
    provider = QueueProvider("bad", "still bad", "also bad")

    with pytest.raises(AttemptsExhaustedError) as caught:
        TaskBlockService(provider, PassingRunner(), max_attempts=3).generate()

    assert caught.value.attempts == 3
    assert isinstance(caught.value.last_error, GeneratedBlockInvalidError)
    assert provider.calls == 3


def test_provider_unavailable_is_not_retried() -> None:
    class UnavailableProvider:
        calls = 0

        def generate(self, prompt: str) -> str:
            del prompt
            self.calls += 1
            raise ProviderUnavailableError("timeout")

    provider = UnavailableProvider()
    with pytest.raises(ProviderUnavailableError, match="timeout"):
        TaskBlockService(provider, PassingRunner(), max_attempts=3).generate()
    assert provider.calls == 1


def test_isolated_execution_unavailable_is_not_retried() -> None:
    class UnavailableRunner:
        def verify_reference(
            self,
            task: Task,
            solution: ReferenceSolution,
            tests: Sequence[VerificationCase],
        ) -> None:
            del task, solution, tests
            raise IsolatedExecutionUnavailableError("runner offline")

    provider = QueueProvider(json.dumps(make_payload()), json.dumps(make_payload()))
    with pytest.raises(IsolatedExecutionUnavailableError, match="runner offline"):
        TaskBlockService(provider, UnavailableRunner(), max_attempts=2).generate()
    assert provider.calls == 1


def test_stub_runner_never_marks_reference_as_verified() -> None:
    provider = QueueProvider(json.dumps(make_payload()))

    with pytest.raises(ReferenceNotExecutedError, match="was not executed"):
        TaskBlockService(provider, UnavailableExecutionRunner()).generate()
    assert provider.calls == 1


def test_orphan_test_is_rejected() -> None:
    payload = copy.deepcopy(make_payload())
    orphan = copy.deepcopy(payload["tests"][0])  # type: ignore[index]
    orphan["id"] = str(uuid4())
    payload["tests"].append(orphan)  # type: ignore[union-attr]

    with pytest.raises(GeneratedBlockInvalidError, match="all be referenced"):
        parse_and_validate_block(json.dumps(payload))
