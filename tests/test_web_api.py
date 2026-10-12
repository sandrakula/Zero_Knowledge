"""End-to-end API orchestration tests without external AI or Docker."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from zero_knowledge.execution import CodeExecutionResult
from zero_knowledge.execution.sandbox import SandboxUnavailableError
from zero_knowledge.profile import ProfileRoadmapService
from zero_knowledge.schemas import (
    CognitiveDepth,
    Difficulty,
    Discipline,
    ReferenceSolution,
    Task,
    TaskSet,
    TaskSetItem,
    TaskSetPurpose,
    TaskType,
)
from zero_knowledge.schemas import TestCase as VerificationCase
from zero_knowledge.solution_review import SolutionReviewService
from zero_knowledge.web_app import ApiApplication, DiagnosticService
from zero_knowledge.web_app.evaluation import StudentSolutionEvaluator


class FakeTaskBlocks:
    def __init__(self) -> None:
        self.tasks: list[Task] = []
        self.solutions: list[ReferenceSolution] = []
        self.tests: list[VerificationCase] = []
        for index, difficulty in enumerate(
            (Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD)
        ):
            task_id = uuid4()
            solution = ReferenceSolution(
                task_id=task_id,
                approach="Echo input",
                final_answer="The same text",
                code="print(input()) # PRIVATE_REFERENCE",
            )
            case = VerificationCase(
                task_id=task_id,
                input_data=f"secret-{index}\n",
                expected_output=f"secret-{index}\n",
                is_hidden=True,
            )
            self.tasks.append(
                Task(
                    id=task_id,
                    title=f"Task {index}",
                    discipline=Discipline.PROGRAMMING,
                    task_type=TaskType.PROGRAMMING,
                    statement="Echo stdin.",
                    difficulty=difficulty,
                    cognitive_depth=CognitiveDepth.APPLICATION,
                    topic_ids=["python.io"],
                    solution_id=solution.id,
                    test_ids=[case.id],
                    metadata={"language": "python"},
                )
            )
            self.solutions.append(solution)
            self.tests.append(case)
        self.task_set = TaskSet(
            title="Diagnostic",
            purpose=TaskSetPurpose.DIAGNOSTIC,
            items=[
                TaskSetItem(task_id=task.id, order=i)
                for i, task in enumerate(self.tasks)
            ],
        )

    def generate(self):
        return self.task_set, self.tasks, self.solutions, self.tests


class FakeSandbox:
    def execute(self, source: str, **kwargs) -> CodeExecutionResult:
        del kwargs
        if source == "infra":
            raise SandboxUnavailableError("docker down")
        if source == "timeout":
            return CodeExecutionResult(None, "", "", True, 10_000)
        if source == "syntax":
            return CodeExecutionResult(1, "", "SyntaxError: invalid syntax", False, 10)
        if source == "runtime":
            return CodeExecutionResult(1, "", "ValueError: boom", False, 10)
        if source == "wrong":
            return CodeExecutionResult(0, "wrong\n", "", False, 10)
        return CodeExecutionResult(0, source.removeprefix("pass:"), "", False, 10)


class QuestionProvider:
    def generate(self, prompt: str) -> str:
        assert "Student answer" in prompt
        return json.dumps(
            {
                "questions": [
                    {
                        "kind": "explanation",
                        "text": "Why does your code echo the input?",
                        "target": "submitted code",
                        "rationale": "Check understanding",
                    }
                ]
            }
        )


class ExplanationProvider:
    def generate(self, prompt: str) -> str:
        assert "Knowledge profile" in prompt
        assert "Planned recommendations" in prompt
        return json.dumps(
            {
                "profile_summary": "Python I/O уверенно освоен.",
                "recommendation_rationales": [
                    "Навык готов к применению в новом контексте."
                ],
            }
        )


@pytest.fixture
def api() -> ApiApplication:
    service = DiagnosticService(
        FakeTaskBlocks(),  # type: ignore[arg-type]
        StudentSolutionEvaluator(FakeSandbox()),
        SolutionReviewService(QuestionProvider()),
        ProfileRoadmapService(ExplanationProvider()),
    )
    return ApiApplication(service)


def post(api: ApiApplication, path: str, body: dict | None = None):
    return api.handle("POST", path, json.dumps(body or {}).encode())


def start(api: ApiApplication):
    response = post(api, "/api/diagnostics")
    assert response.status == 201
    return response.body


def submit(api: ApiApplication, diagnostic: dict, index: int, code: str):
    task_id = diagnostic["tasks"][index]["id"]
    return post(
        api,
        f"/api/diagnostics/{diagnostic['session_id']}/tasks/{task_id}/submissions",
        {"code": code},
    )


def test_diagnostic_response_does_not_leak_secrets(api: ApiApplication) -> None:
    diagnostic = start(api)
    encoded = json.dumps(diagnostic)
    assert [task["difficulty"] for task in diagnostic["tasks"]] == [
        "easy",
        "medium",
        "hard",
    ]
    assert "PRIVATE_REFERENCE" not in encoded
    assert "secret-0" not in encoded
    assert "solution_id" not in encoded
    assert "test_ids" not in encoded


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        ("wrong", "incorrect_output"),
        ("syntax", "syntax_error"),
        ("runtime", "runtime_error"),
        ("timeout", "timeout"),
    ],
)
def test_submission_failure_kinds(api: ApiApplication, code: str, kind: str) -> None:
    diagnostic = start(api)
    response = submit(api, diagnostic, 0, code)
    assert response.status == 200
    assert response.body["evaluation"] == {
        "state": "failed",
        "kind": kind,
        "details": response.body["evaluation"]["details"],
    }
    assert response.body["answer"]["is_correct"] is False


def test_sandbox_failure_is_an_explicit_retryable_error(api: ApiApplication) -> None:
    diagnostic = start(api)
    response = submit(api, diagnostic, 0, "infra")
    assert response.status == 503
    assert response.body["error"]["code"] == "sandbox_unavailable"
    assert response.body["error"]["retryable"] is True


def test_full_transition_flow_and_server_side_gates(api: ApiApplication) -> None:
    diagnostic = start(api)
    blocked = submit(api, diagnostic, 1, "pass:secret-1\n")
    assert blocked.status == 409

    for index in range(3):
        response = submit(api, diagnostic, index, f"pass:secret-{index}\n")
        assert response.status == 200
        assert response.body["evaluation"]["state"] == "passed"
        assert response.body["answer"]["attempt_number"] == 1

    session = diagnostic["session_id"]
    reviews = post(api, f"/api/diagnostics/{session}/reviews")
    assert reviews.status == 200
    assert len(reviews.body) == 3
    assert all(review["questions"] for review in reviews.body)

    rejected = post(api, f"/api/diagnostics/{session}/explanations", {"answers": []})
    assert rejected.status == 400
    answers = [
        {
            "answer_id": review["answer_id"],
            "question_order": question["order"],
            "content": "Because stdin is printed unchanged.",
        }
        for review in reviews.body
        for question in review["questions"]
    ]
    accepted = post(
        api, f"/api/diagnostics/{session}/explanations", {"answers": answers}
    )
    assert accepted.status == 200
    assert [item["understanding"] for item in accepted.body["assessments"]] == [
        "expert"
    ] * 3

    profile = post(api, f"/api/diagnostics/{session}/profile")
    assert profile.status == 200
    assert "python.io" in profile.body["profile"]["skills"]
    assert profile.body["profile_summary"] == "Python I/O уверенно освоен."
    roadmap = post(api, f"/api/diagnostics/{session}/roadmap")
    assert roadmap.status == 200
    assert roadmap.body["steps"][0]["title"] == "Задачи на перенос"
    assert roadmap.body["recommendations"][0]["skill_ids"] == ["python.io"]


def test_questions_require_all_three_successes(api: ApiApplication) -> None:
    diagnostic = start(api)
    response = post(api, f"/api/diagnostics/{diagnostic['session_id']}/reviews")
    assert response.status == 409


def test_invalid_success_is_removed_after_resubmission(api: ApiApplication) -> None:
    diagnostic = start(api)
    first = submit(api, diagnostic, 0, "pass:secret-0\n")
    second = submit(api, diagnostic, 0, "wrong")
    assert first.body["evaluation"]["state"] == "passed"
    assert second.body["evaluation"]["state"] == "failed"
    assert second.body["answer"]["attempt_number"] == 2
    assert submit(api, diagnostic, 1, "pass:secret-1\n").status == 409
