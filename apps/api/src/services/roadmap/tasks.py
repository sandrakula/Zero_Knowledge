"""Convert roadmap task specs into the exact assignment-task ``contents``
shapes the server graders expect (see ``services/courses/activities/assignments``
and ``TaskCodeObject.tsx``)."""

from __future__ import annotations

from typing import List, Tuple
from uuid import uuid4

from src.services.courses.activities.quiz_modes import (
    GRADING_MODE_ALL_OR_NOTHING,
    RESPONSE_TYPE_MULTIPLE,
    count_correct_options,
)
from src.services.roadmap.schema import (
    RoadmapTaskSpec,
    RoadmapTaskType,
    resolve_language_id,
)

DEFAULT_TASKS_PER_LESSON = 4


def _quiz_contents(spec: RoadmapTaskSpec) -> dict:
    questions = []
    for question in spec.questions:
        options = [
            {
                "optionUUID": f"option_{uuid4()}",
                "text": option.text,
                "fileID": "",
                "type": "text",
                "assigned_right_answer": bool(option.correct),
            }
            for option in question.options
        ]
        response_type = question.response_type
        if count_correct_options(options) >= 2:
            response_type = RESPONSE_TYPE_MULTIPLE
        questions.append(
            {
                "questionUUID": f"question_{uuid4()}",
                "questionText": question.text,
                "response_type": response_type,
                "options": options,
            }
        )
    return {"questions": questions, "grading_mode": GRADING_MODE_ALL_OR_NOTHING}


def _form_contents(spec: RoadmapTaskSpec) -> dict:
    questions = []
    for question in spec.form_questions:
        blanks = []
        for blank in question.blanks:
            item = {
                "blankUUID": f"blank_{uuid4()}",
                "placeholder": blank.placeholder,
                "correctAnswer": blank.correct_answer,
            }
            if blank.hint:
                item["hint"] = blank.hint
            blanks.append(item)
        questions.append(
            {
                "questionUUID": f"question_{uuid4()}",
                "questionText": question.text,
                "blanks": blanks,
            }
        )
    return {"questions": questions}


def _short_answer_contents(spec: RoadmapTaskSpec) -> dict:
    contents = {
        "prompt": spec.description or spec.title,
        "correct_answers": spec.answers,
        "match_mode": spec.match_mode,
    }
    if spec.explanation:
        contents["explanation"] = spec.explanation
    return contents


def _number_answer_contents(spec: RoadmapTaskSpec) -> dict:
    contents = {
        "prompt": spec.description or spec.title,
        "correct_value": spec.value if spec.value is not None else 0,
        "tolerance": spec.tolerance,
    }
    if spec.unit:
        contents["unit"] = spec.unit
    if spec.explanation:
        contents["explanation"] = spec.explanation
    return contents


def _code_contents(spec: RoadmapTaskSpec) -> dict:
    language_id = spec.language_id or resolve_language_id(spec.language) or 71
    test_cases = [
        {
            "id": f"test_{uuid4()}",
            "label": test.label or f"Test {index + 1}",
            "stdin": test.stdin,
            "expectedStdout": test.expected_stdout,
            "hidden": bool(test.hidden),
            "weight": max(1, int(test.weight or 1)),
        }
        for index, test in enumerate(spec.tests)
    ]
    return {
        "language_id": language_id,
        "starter_code": spec.starter_code,
        "solution_code": spec.solution_code,
        "grading_mode": spec.grading_mode,
        "test_cases": test_cases,
        "allow_student_run": True,
        "show_test_details_on_fail": True,
        "show_hidden_test_count": True,
        "require_passing_to_submit": False,
    }


def task_contents(spec: RoadmapTaskSpec) -> dict:
    if spec.type == RoadmapTaskType.QUIZ:
        return _quiz_contents(spec)
    if spec.type == RoadmapTaskType.FORM:
        return _form_contents(spec)
    if spec.type == RoadmapTaskType.SHORT_ANSWER:
        return _short_answer_contents(spec)
    if spec.type == RoadmapTaskType.NUMBER_ANSWER:
        return _number_answer_contents(spec)
    if spec.type == RoadmapTaskType.CODE:
        return _code_contents(spec)
    return {}


def task_errors(spec: RoadmapTaskSpec) -> List[str]:
    """Reasons to reject a task, empty when it can be persisted and graded."""
    errors: List[str] = []
    if not spec.title.strip():
        errors.append("task title is required")
    if spec.type == RoadmapTaskType.QUIZ:
        if not spec.questions:
            errors.append("quiz needs at least one question")
        for index, question in enumerate(spec.questions, 1):
            if not question.options:
                errors.append(f"quiz question {index} has no options")
            elif not any(option.correct for option in question.options):
                errors.append(f"quiz question {index} has no correct option")
    elif spec.type == RoadmapTaskType.CODE:
        if resolve_language_id(spec.language_id or spec.language) is None:
            errors.append(f"unknown code language: {spec.language}")
        if not spec.tests:
            errors.append("code task needs at least one test case")
        for index, test in enumerate(spec.tests, 1):
            if not test.expected_stdout:
                errors.append(f"code test {index} has no expected output")
    elif spec.type == RoadmapTaskType.SHORT_ANSWER:
        if not any(answer.strip() for answer in spec.answers):
            errors.append("short-answer task needs at least one accepted answer")
    elif spec.type == RoadmapTaskType.NUMBER_ANSWER:
        if spec.value is None:
            errors.append("number-answer task needs a correct value")
    elif spec.type == RoadmapTaskType.FORM:
        if not spec.form_questions:
            errors.append("form task needs at least one question")
        if not any(
            blank.correct_answer.strip()
            for question in spec.form_questions
            for blank in question.blanks
        ):
            errors.append("form task needs at least one correct blank")
    return errors


def valid_tasks(specs: List[RoadmapTaskSpec]) -> Tuple[List[RoadmapTaskSpec], List[str]]:
    accepted: List[RoadmapTaskSpec] = []
    rejected: List[str] = []
    for spec in specs:
        errors = task_errors(spec)
        if errors:
            rejected.append(f"{spec.title or '(untitled)'}: {', '.join(errors)}")
        else:
            accepted.append(spec)
    return accepted, rejected


def summarize_task_for_ai(spec: RoadmapTaskSpec) -> str:
    """Student-safe summary (never includes answer keys) for assistant context."""
    header = f"[{spec.type.value}] {spec.title}"
    lines = [header]
    if spec.description:
        lines.append(spec.description.strip())
    if spec.type == RoadmapTaskType.QUIZ:
        for index, question in enumerate(spec.questions, 1):
            options = "; ".join(option.text for option in question.options)
            lines.append(f"  Q{index}: {question.text} ({options})")
    elif spec.type == RoadmapTaskType.CODE:
        lines.append(f"  language: {spec.language}")
        if spec.tests:
            lines.append(f"  visible tests: {len(spec.tests)}")
        if spec.starter_code:
            lines.append(f"  starter code:\n{spec.starter_code}")
    elif spec.type == RoadmapTaskType.SHORT_ANSWER:
        lines.append("  answer in your own words")
    elif spec.type == RoadmapTaskType.NUMBER_ANSWER:
        lines.append("  numeric answer")
    elif spec.type == RoadmapTaskType.FORM:
        lines.append(f"  {len(spec.form_questions)} fill-in-the-blank question(s)")
    return "\n".join(lines)
