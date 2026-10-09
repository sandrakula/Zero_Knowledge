"""Network-free integration tests for the direct ZEROK-1 -> ZEROK-4 seam."""

from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.task_generation import (
    AttemptsExhaustedError,
    GeneratedBlockInvalidError,
    ProviderUnavailableError,
    TaskBlockService,
)


def _payload() -> dict[str, object]:
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
                "statement": "Read and print one integer.",
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
                "approach": "Echo the input.",
                "final_answer": "The integer is printed.",
                "code": "print(input())",
            }
        )
        tests.append(
            {
                "id": test_id,
                "task_id": task_id,
                "input_data": "7\n",
                "expected_output": "7\n",
                "order": 0,
            }
        )
    return {"tasks": tasks, "solutions": solutions, "tests": tests}


def _response(content: str, request: httpx.Request) -> httpx.Response:
    body = json.dumps({"choices": [{"message": {"content": content}}]})
    return httpx.Response(200, text=body, request=request)


class RunnerMustNotBeCalled:
    calls = 0

    def verify_reference(self, task, solution, tests) -> None:
        del task, solution, tests
        self.calls += 1
        raise AssertionError("unverified generation must not execute code")


def test_deepseek_response_becomes_canonical_unverified_block() -> None:
    raw = f"```json\n{json.dumps(_payload())}\n```"
    client = DeepSeekClient(
        api_key="test-key",
        transport=httpx.MockTransport(lambda request: _response(raw, request)),
    )
    runner = RunnerMustNotBeCalled()

    result = TaskBlockService(client, runner).generate_without_reference_execution()

    assert [task.difficulty.value for task in result.tasks] == [
        "easy",
        "medium",
        "hard",
    ]
    assert result.generation == "success"
    assert result.schema_validation == "success"
    assert result.reference_execution == "not_run"
    assert result.generation_attempts == 1
    assert runner.calls == 0


def test_deepseek_infrastructure_error_is_propagated() -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, text="denied", request=request)

    client = DeepSeekClient(api_key="test-key", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderUnavailableError, match="authentication"):
        TaskBlockService(
            client, RunnerMustNotBeCalled()
        ).generate_without_reference_execution()
    assert calls == 1


def test_invalid_model_content_uses_bounded_generation_retries() -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return _response("not JSON", request)

    client = DeepSeekClient(api_key="test-key", transport=httpx.MockTransport(handler))
    with pytest.raises(AttemptsExhaustedError) as caught:
        TaskBlockService(
            client, RunnerMustNotBeCalled(), max_attempts=2
        ).generate_without_reference_execution()
    assert calls == 2
    assert isinstance(caught.value.last_error, GeneratedBlockInvalidError)


def test_missing_api_key_fails_clearly_without_network(monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return _response(json.dumps(_payload()), request)

    client = DeepSeekClient(api_key="", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderUnavailableError, match="DEEPSEEK_API_KEY"):
        TaskBlockService(
            client, RunnerMustNotBeCalled()
        ).generate_without_reference_execution()
    assert calls == 0
