"""Tests for roadmap parsing, conversion and import/merge behaviour."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.services.roadmap.importer import import_roadmap
from src.services.roadmap.markdown import markdown_to_prosemirror
from src.services.roadmap.schema import RoadmapSpec
from src.services.roadmap.tasks import task_contents, task_errors
from src.services.roadmap import generation

pytestmark = pytest.mark.asyncio


SAMPLE = {
    "name": "Python",
    "description": "Backend course",
    "chapters": [
        {
            "name": "Basics",
            "lessons": [
                {
                    "name": "Variables",
                    "description": "Values",
                    "material": "# Variables\n\nA name bound to a value.\n\n- int\n- str\n",
                    "tasks": [
                        {
                            "type": "quiz",
                            "title": "Types",
                            "description": "Pick one",
                            "questions": [
                                {
                                    "text": "2 + 2?",
                                    "options": [
                                        {"text": "4", "correct": True},
                                        {"text": "5", "correct": False},
                                    ],
                                }
                            ],
                        },
                        {
                            "type": "code",
                            "title": "Sum",
                            "description": "Read two ints and print the sum",
                            "language": "python",
                            "starter_code": "a, b = map(int, input().split())\n",
                            "tests": [
                                {"stdin": "1 2\n", "expected_stdout": "3\n"},
                            ],
                        },
                    ],
                }
            ],
        }
    ],
}


def test_alias_normalization_and_code_contents():
    plan = RoadmapSpec(**SAMPLE)
    lesson = plan.chapters[0].lessons[0]
    assert lesson.title == "Variables"
    assert lesson.tasks[0].type.value == "QUIZ"
    assert lesson.tasks[0].questions[0].options[0].correct is True
    code = task_contents(lesson.tasks[1])
    assert code["language_id"] == 71
    assert code["test_cases"][0]["expectedStdout"] == "3\n"
    assert task_errors(lesson.tasks[1]) == []


def test_invalid_quiz_without_correct_option_is_rejected():
    plan = RoadmapSpec(
        title="T",
        chapters=[
            {
                "title": "C",
                "lessons": [
                    {
                        "title": "L",
                        "tasks": [
                            {
                                "type": "quiz",
                                "title": "Q",
                                "questions": [
                                    {"text": "Q?", "options": [{"text": "A"}]}
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    )
    errors = task_errors(plan.chapters[0].lessons[0].tasks[0])
    assert any("no correct option" in error for error in errors)


def test_markdown_to_prosemirror_shapes():
    document = markdown_to_prosemirror(
        "# Title\n\nHello **world**.\n\n- one\n- two\n\n```python\nprint(1)\n```\n"
    )
    types = [node["type"] for node in document["content"]]
    assert types == ["heading", "paragraph", "bulletList", "codeBlock"]
    paragraph = document["content"][1]
    assert paragraph["content"][1]["marks"] == [{"type": "bold"}]


async def test_import_creates_structure_and_tasks(db, org, admin_user, mock_request):
    plan = RoadmapSpec(**SAMPLE)
    with patch(
        "src.services.courses.courses.check_limits_with_usage",
        new_callable=AsyncMock,
    ), patch(
        "src.services.courses.courses.increase_feature_usage",
        new_callable=AsyncMock,
    ):
        course, pending, created, _updated, _skipped = await import_roadmap(
            request=mock_request,
            spec=plan,
            org_id=org.id,
            course_uuid=None,
            current_user=admin_user,
            db=db,
            generate_missing=False,
            publish=False,
        )

    assert course.name == "Python"
    assert pending == []
    assert created >= 3  # course, chapter, two activities

    chapter = (
        await db.execute(select(Chapter).where(Chapter.course_id == course.id))
    ).scalars().first()
    assert chapter is not None

    activities = (
        await db.execute(select(Activity).where(Activity.course_id == course.id))
    ).scalars().all()
    lecture = next(item for item in activities if item.name == "Variables")
    practice = next(item for item in activities if "Practice" in item.name)
    assert lecture.content["type"] == "doc"
    assert lecture.content["content"]
    assert practice.activity_type.value == "TYPE_ASSIGNMENT"

    assignment = (
        await db.execute(select(Assignment).where(Assignment.activity_id == practice.id))
    ).scalars().first()
    assert assignment is not None
    tasks = (
        await db.execute(
            select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id)
        )
    ).scalars().all()
    assert {task.assignment_type.value for task in tasks} == {"QUIZ", "CODE"}


async def test_import_merge_skips_existing_content(db, org, admin_user, mock_request):
    plan = RoadmapSpec(**SAMPLE)
    with patch(
        "src.services.courses.courses.check_limits_with_usage",
        new_callable=AsyncMock,
    ), patch(
        "src.services.courses.courses.increase_feature_usage",
        new_callable=AsyncMock,
    ):
        course, _, _, _, _ = await import_roadmap(
            request=mock_request,
            spec=plan,
            org_id=org.id,
            course_uuid=None,
            current_user=admin_user,
            db=db,
            generate_missing=False,
            publish=False,
        )
        same_course, pending, created, _updated, skipped = await import_roadmap(
            request=mock_request,
            spec=plan,
            org_id=org.id,
            course_uuid=course.course_uuid,
            current_user=admin_user,
            db=db,
            generate_missing=False,
            publish=False,
        )

    assert same_course.id == course.id
    assert pending == []
    assert created == 0
    assert skipped >= 2


async def test_generated_lecture_is_markdown():
    with patch.object(
        generation,
        "generate",
        new_callable=AsyncMock,
        return_value="```markdown\n# Title\n\nBody\n```",
    ):
        markdown = await generation.generate_lecture_markdown(
            course_name="C",
            course_description="D",
            chapter_name="Ch",
            chapter_description="",
            lesson_title="L",
            lesson_summary="S",
            material=None,
            language="en",
            model_name="test",
        )
    assert markdown == "# Title\n\nBody"
    assert markdown_to_prosemirror(markdown)["content"][0]["type"] == "heading"


async def test_generated_tasks_are_validated_and_converted():
    plan = generation.AILessonTasksPlan(
        tasks=[
            generation.AILessonTask(
                kind="quiz",
                title="Quiz",
                description="Pick",
                quiz_questions=[
                    generation.AIQuizQuestion(
                        text="2+2?", options=["4", "5"], correct_indices=[0]
                    )
                ],
            ),
            generation.AILessonTask(
                kind="code",
                title="Sum",
                description="Add",
                language="python",
                solution_code="print(a+b)",
                code_tests=[
                    generation.AICodeTest(stdin="1 2\n", expected_stdout="3\n"),
                ],
            ),
        ]
    )
    with patch.object(
        generation, "generate", new_callable=AsyncMock, return_value=plan
    ):
        specs = await generation.generate_lesson_tasks(
            course_name="C",
            chapter_name="Ch",
            lesson_title="L",
            lesson_summary="S",
            material=None,
            language="en",
            model_name="test",
        )
    assert [spec.type.value for spec in specs] == ["QUIZ", "CODE"]
    assert task_contents(specs[1])["language_id"] == 71
