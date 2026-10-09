"""Network- and Docker-free tests for the ZEROK-3 -> ZEROK-4 seam."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from zero_knowledge.execution import (
    CodeExecutionResult,
    DockerIsolatedExecutionRunner,
    SandboxUnavailableError,
)
from zero_knowledge.schemas import (
    CognitiveDepth,
    Difficulty,
    Discipline,
    ReferenceSolution,
    Task,
    TaskType,
)
from zero_knowledge.schemas import TestCase as ZkTestCase
from zero_knowledge.task_generation import (
    IsolatedExecutionUnavailableError,
    ReferenceSolutionFailedError,
    TaskBlockService,
)


def _result(
    *,
    exit_code: int | None = 0,
    stdout: str = "ok\n",
    stderr: str = "",
    timed_out: bool = False,
) -> CodeExecutionResult:
    return CodeExecutionResult(
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
        timed_out=timed_out,
        duration_ms=1.5,
    )


class FakeSandbox:
    def __init__(
        self, *outcomes: CodeExecutionResult | SandboxUnavailableError
    ) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, object]] = []

    def execute(self, source: str, **kwargs) -> CodeExecutionResult:
        self.calls.append({"source": source, **kwargs})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _entities(
    *, timeout_ms: int | None = None, memory_mb: int | None = None
) -> tuple[Task, ReferenceSolution, ZkTestCase]:
    task = Task(
        title="adapter",
        discipline=Discipline.PROGRAMMING,
        task_type=TaskType.PROGRAMMING,
        statement="Print ok.",
        difficulty=Difficulty.EASY,
        cognitive_depth=CognitiveDepth.APPLICATION,
    )
    solution = ReferenceSolution(
        task_id=task.id,
        approach="print",
        final_answer="ok",
        code="print('ok')",
    )
    case = ZkTestCase(
        task_id=task.id,
        input_data="",
        expected_output="ok\n",
        timeout_ms=timeout_ms,
        memory_mb=memory_mb,
    )
    return task, solution, case


def test_runner_passes_case_limits_to_sandbox() -> None:
    sandbox = FakeSandbox(_result())
    task, solution, case = _entities(timeout_ms=250, memory_mb=32)

    DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])

    assert sandbox.calls == [
        {
            "source": "print('ok')",
            "input_data": "",
            "timeout": 0.25,
            "memory": "32m",
        }
    ]


def test_output_mismatch_is_content_failure() -> None:
    sandbox = FakeSandbox(_result(stdout="wrong\n"))
    task, solution, case = _entities()

    with pytest.raises(ReferenceSolutionFailedError, match="output mismatch"):
        DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])


@pytest.mark.parametrize(
    "stderr",
    [
        "ZeroDivisionError: division by zero",
        "IndexError: list index out of range",
        "SyntaxError: invalid syntax",
        "MemoryError",
    ],
)
def test_runtime_errors_are_content_failures(stderr: str) -> None:
    sandbox = FakeSandbox(_result(exit_code=1, stdout="", stderr=stderr))
    task, solution, case = _entities()

    with pytest.raises(ReferenceSolutionFailedError, match="exited with code 1"):
        DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])


def test_timeout_is_content_failure() -> None:
    sandbox = FakeSandbox(_result(exit_code=None, stdout="", timed_out=True))
    task, solution, case = _entities()

    with pytest.raises(ReferenceSolutionFailedError, match="timed out"):
        DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])


def test_sandbox_unavailable_is_infrastructure_failure() -> None:
    sandbox = FakeSandbox(SandboxUnavailableError("docker unavailable"))
    task, solution, case = _entities()

    with pytest.raises(IsolatedExecutionUnavailableError, match="docker unavailable"):
        DockerIsolatedExecutionRunner(sandbox).verify_reference(task, solution, [case])


def _payload() -> str:
    tasks: list[dict[str, object]] = []
    solutions: list[dict[str, object]] = []
    tests: list[dict[str, object]] = []
    for order, difficulty in enumerate(("easy", "medium", "hard")):
        task_id, solution_id, test_id = (str(uuid4()) for _ in range(3))
        tasks.append(
            {
                "id": task_id,
                "title": f"Task {order}",
                "discipline": "programming",
                "task_type": "programming",
                "statement": "Print ok.",
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
                "approach": "print",
                "final_answer": "ok",
                "code": "print('ok')",
            }
        )
        tests.append(
            {
                "id": test_id,
                "task_id": task_id,
                "input_data": "",
                "expected_output": "ok\n",
                "order": 0,
            }
        )
    return json.dumps({"tasks": tasks, "solutions": solutions, "tests": tests})


class QueueProvider:
    def __init__(self, *responses: str) -> None:
        self.responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        del prompt
        self.calls += 1
        return self.responses.pop(0)


def test_strict_service_uses_real_runner_adapter_and_retries_content() -> None:
    raw = _payload()
    provider = QueueProvider(raw, raw)
    sandbox = FakeSandbox(
        _result(stdout="wrong\n"),
        _result(),
        _result(),
        _result(),
    )
    service = TaskBlockService(
        provider, DockerIsolatedExecutionRunner(sandbox), max_attempts=2
    )

    _task_set, tasks, _solutions, _tests = service.generate()

    assert len(tasks) == 3
    assert provider.calls == 2
    assert len(sandbox.calls) == 4
    assert service.attempts_used == 2


def test_strict_service_does_not_retry_infrastructure_failure() -> None:
    raw = _payload()
    provider = QueueProvider(raw, raw)
    sandbox = FakeSandbox(SandboxUnavailableError("daemon offline"))
    service = TaskBlockService(
        provider, DockerIsolatedExecutionRunner(sandbox), max_attempts=2
    )

    with pytest.raises(IsolatedExecutionUnavailableError, match="daemon offline"):
        service.generate()

    assert provider.calls == 1
    assert service.attempts_used == 1
