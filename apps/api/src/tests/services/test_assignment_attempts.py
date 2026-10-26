"""Durable CODE attempt history and hidden-result sanitization."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentAttempt,
    AssignmentAttemptRead,
    AssignmentAttemptVerdict,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionRead,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.problems import Problem
from src.routers import code_execution
from src.services.courses.activities.assignments import (
    _evaluate_code_task,
    _problem_task_contents,
    _record_attempt_result,
    _record_code_attempts_pending,
    _sanitize_task_submission_for_learner,
    read_my_assignment_attempts,
)


def _task(contents):
    return SimpleNamespace(
        assignment_task_uuid="task_attempt",
        contents=contents,
        max_grade_value=100,
    )


def _submission(data):
    return SimpleNamespace(task_submission=data)


def _patch_judge0(results):
    return patch.multiple(
        "src.routers.code_execution",
        _get_judge0_config=lambda: {"cfg": "fake"},
        _submit_single=AsyncMock(side_effect=results),
    )


def _ok(stdout="1\n"):
    return {"status": {"id": 3, "description": "Accepted"}, "stdout": stdout, "time": "0.01", "memory": 1024}


async def _rows(db, org, course, chapter, activity):
    now = str(datetime.now())
    assignment = Assignment(
        title="Attempts",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_attempts",
        creation_date=now,
        update_date=now,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        title="A+B",
        description="",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        contents={
            "language_id": 71,
            "grading_mode": "equal_weight",
            "test_cases": [
                {"id": "t1", "label": "public", "stdin": "1 2\n", "expectedStdout": "3\n", "hidden": False, "weight": 1},
                {"id": "t2", "label": "hidden", "stdin": "5 7\n", "expectedStdout": "12\n", "hidden": True, "weight": 1},
            ],
            "time_limit_ms": 1000,
            "memory_limit_kb": 65536,
        },
        assignment_task_uuid="assignmenttask_attempts",
        creation_date=now,
        update_date=now,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    submission = AssignmentTaskSubmission(
        assignment_task_submission_uuid="assignmenttasksubmission_attempts",
        task_submission={"source_code": "print(1)", "language_id": 71},
        grade=0,
        task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.CODE,
        user_id=1,
        activity_id=activity.id,
        course_id=course.id,
        chapter_id=chapter.id,
        assignment_task_id=task.id,
        creation_date=now,
        update_date=now,
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return assignment, task, submission


@pytest.mark.asyncio
async def test_pending_attempt_is_updated_and_history_survives(
    db, org, course, chapter, activity
):
    assignment, task, submission = await _rows(db, org, course, chapter, activity)

    await _record_code_attempts_pending(db, assignment, 1, 1)
    pending = (await db.execute(select(AssignmentAttempt))).scalars().first()
    assert pending is not None
    assert pending.verdict == AssignmentAttemptVerdict.PENDING.value
    assert pending.attempt_number == 1

    details = {
        "grade": 100,
        "verdict": AssignmentAttemptVerdict.ACCEPTED.value,
        "passed_tests": 2,
        "total_tests": 2,
        "execution_time_ms": 10,
        "memory_kb": 2048,
        "results": [
            {"id": "t1", "label": "public", "passed": True, "status_id": 3, "status": "Accepted", "time_ms": 10, "memory_kb": 2048}
        ],
    }
    await _record_attempt_result(db, assignment, task, submission, 1, 1, details)
    await db.commit()
    await db.refresh(pending)
    assert pending.verdict == AssignmentAttemptVerdict.ACCEPTED.value
    assert pending.passed_tests == 2
    assert pending.total_tests == 2

    # The next attempt is a new row; the previous one is untouched.
    await _record_code_attempts_pending(db, assignment, 1, 2)
    await _record_attempt_result(
        db,
        assignment,
        task,
        submission,
        1,
        2,
        {**details, "verdict": AssignmentAttemptVerdict.WRONG_ANSWER.value, "passed_tests": 1, "grade": 50},
    )
    await db.commit()
    rows = (await db.execute(select(AssignmentAttempt).order_by(AssignmentAttempt.attempt_number))).scalars().all()
    assert [row.attempt_number for row in rows] == [1, 2]
    assert rows[0].verdict == AssignmentAttemptVerdict.ACCEPTED.value
    assert rows[1].verdict == AssignmentAttemptVerdict.WRONG_ANSWER.value


@pytest.mark.asyncio
async def test_submission_read_sanitizes_hidden_results(db, org, course, chapter, activity):
    _, task, submission = await _rows(db, org, course, chapter, activity)
    submission.task_submission = {
        "source_code": "print(1)",
        "language_id": 71,
        "results": [
            {"id": "t1", "label": "public", "passed": True, "expected_stdout": "3\n", "actual_stdout": "3\n"},
            {"id": "t2", "label": "hidden", "passed": False, "expected_stdout": "12\n", "actual_stdout": "11\n"},
        ],
    }
    read = AssignmentTaskSubmissionRead.model_validate(submission)
    safe = _sanitize_task_submission_for_learner(task, read)
    results = safe.task_submission["results"]
    assert results[0]["expected_stdout"] == "3\n"
    assert "expected_stdout" not in results[1]
    assert "actual_stdout" not in results[1]


@pytest.mark.asyncio
async def test_verdicts_and_results_do_not_contain_answer_key():
    task = _task(
        {
            "language_id": 71,
            "grading_mode": "equal_weight",
            "test_cases": [
                {"id": "t1", "label": "one", "stdin": "1", "expectedStdout": "1\n"},
                {"id": "t2", "label": "two", "stdin": "2", "expectedStdout": "2\n"},
            ],
        }
    )
    sub = _submission({"source_code": "print(1)", "language_id": 71})

    with _patch_judge0([_ok("1\n"), _ok("2\n")]):
        details = await _evaluate_code_task(task, sub)
    assert details["verdict"] == AssignmentAttemptVerdict.ACCEPTED.value
    assert details["passed_tests"] == 2
    assert all("expected" not in key and "stdout" not in key for row in details["results"] for key in row)

    with _patch_judge0([
        {"status": {"id": 6, "description": "Compilation Error"}, "stdout": None},
        {"status": {"id": 6, "description": "Compilation Error"}, "stdout": None},
    ]):
        details = await _evaluate_code_task(task, sub)
    assert details["verdict"] == AssignmentAttemptVerdict.COMPILATION_ERROR.value
    assert details["grade"] == 0

    with _patch_judge0([
        {"status": {"id": 5, "description": "Time Limit Exceeded"}, "stdout": None},
        {"status": {"id": 3, "description": "Accepted"}, "stdout": "2\n"},
    ]):
        details = await _evaluate_code_task(task, sub)
    assert details["verdict"] == AssignmentAttemptVerdict.TIME_LIMIT_EXCEEDED.value


def test_problem_task_snapshot_keeps_limits():
    problem = Problem(
        title="Limits",
        statement_md="x",
        org_id=1,
        tests=[{"id": "t1", "label": "x", "stdin": "", "expected_stdout": "x", "hidden": False, "weight": 1}],
        languages=[71, 54],
        time_limit_ms=1500,
        memory_limit_kb=65536,
    )
    contents = _problem_task_contents(problem)
    assert contents["time_limit_ms"] == 1500
    assert contents["memory_limit_kb"] == 65536
    assert contents["languages"] == [54, 71]


def test_attempt_read_model_exposes_history_fields():
    row = AssignmentAttempt(
        id=1,
        attempt_uuid="a",
        user_id=1,
        org_id=1,
        course_id=1,
        chapter_id=1,
        activity_id=1,
        assignment_id=1,
        assignment_task_id=1,
        attempt_number=2,
        source_code="code",
        language_id=71,
        verdict="WRONG_ANSWER",
        passed_tests=1,
        total_tests=2,
        execution_time_ms=10,
        memory_kb=1024,
        test_results=[],
        created_date="now",
        update_date="now",
    )
    read = AssignmentAttemptRead.model_validate(row)
    assert read.attempt_number == 2
    assert read.verdict == "WRONG_ANSWER"


@pytest.mark.asyncio
async def test_my_attempts_service_returns_only_current_user(db, org, course, chapter, activity):
    assignment, task, submission = await _rows(db, org, course, chapter, activity)
    now = str(datetime.now())
    db.add(
        AssignmentTaskSubmission(
            assignment_task_submission_uuid="assignmenttasksubmission_attempts_user2",
            task_submission={"source_code": "print(2)", "language_id": 71},
            grade=0,
            task_submission_grade_feedback="",
            assignment_type=AssignmentTaskTypeEnum.CODE,
            user_id=2,
            activity_id=activity.id,
            course_id=course.id,
            chapter_id=chapter.id,
            assignment_task_id=task.id,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()
    await _record_code_attempts_pending(db, assignment, 1, 1)
    await _record_code_attempts_pending(db, assignment, 2, 1)

    with patch(
        "src.services.courses.activities.assignments.authorize_assignment_access",
        new_callable=AsyncMock,
    ):
        rows = await read_my_assignment_attempts(
            SimpleNamespace(),
            "assignment_attempts",
            "assignmenttask_attempts",
            SimpleNamespace(id=1),
            db,
        )
    assert len(rows) == 1
    assert rows[0].user_id == 1


@pytest.mark.asyncio
async def test_unsupported_language_is_an_execution_error():
    task = _task(
        {
            "language_id": 71,
            "languages": [71],
            "grading_mode": "equal_weight",
            "test_cases": [{"id": "t1", "stdin": "", "expectedStdout": "1\n"}],
        }
    )
    sub = _submission({"source_code": "print(1)", "language_id": 54})
    with _patch_judge0([_ok("1\n")]) as _patches:
        details = await _evaluate_code_task(task, sub)
    assert details["verdict"] == AssignmentAttemptVerdict.EXECUTION_ERROR.value
    assert details["grade"] == 0


@pytest.mark.asyncio
async def test_code_grading_clamps_task_limits():
    task = _task(
        {
            "language_id": 71,
            "grading_mode": "equal_weight",
            "test_cases": [{"id": "t1", "stdin": "", "expectedStdout": "1\n"}],
            "time_limit_ms": 600_000,
            "memory_limit_kb": 10_000_000,
        }
    )
    sub = _submission({"source_code": "print(1)", "language_id": 71})
    submit = AsyncMock(return_value=_ok("1\n"))
    with patch.multiple(
        "src.routers.code_execution",
        _get_judge0_config=lambda: {"cfg": "fake"},
        _submit_single=submit,
    ):
        await _evaluate_code_task(task, sub)
    kwargs = submit.call_args.kwargs
    assert kwargs["cpu_time_limit"] == 10.0
    assert kwargs["memory_limit"] == 262144


@pytest.mark.asyncio
async def test_judge0_payload_forwards_limits(monkeypatch):
    captured: dict = {}

    class _Response:
        status_code = 200

        def json(self):
            return {"ok": True}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def post(self, _url, json, headers):
            captured.update(json)
            return _Response()

    monkeypatch.setattr(
        code_execution.httpx, "AsyncClient", lambda **_kwargs: _Client()
    )
    await code_execution._submit_single(
        SimpleNamespace(api_url="http://judge0", client_id=None, client_secret=None),
        71,
        "print(1)",
        "",
        cpu_time_limit=1.5,
        memory_limit=65536,
    )
    assert captured["cpu_time_limit"] == 1.5
    assert captured["memory_limit"] == 65536
    assert "wall_time_limit" not in captured
