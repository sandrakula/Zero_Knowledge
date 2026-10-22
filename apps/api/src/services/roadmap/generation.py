"""AI generation used by roadmap imports.

Lectures are generated as Markdown and converted to ProseMirror locally (cheap,
deterministic, no schema-guessing by the model). Tasks are generated as
structured JSON, validated, then converted into assignment-task contents by
``services/roadmap/tasks``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.roadmaps import (
    RoadmapImportJob,
    RoadmapItemKind,
    RoadmapItemState,
    RoadmapJobStatus,
)
from src.services.ai.llm import generate, resolve_model_for_org
from src.services.ai.schemas.limits import AI_CONTEXT_MAX_CHARS
from src.services.roadmap.schema import (
    CodeTestInput,
    QuizOptionInput,
    QuizQuestionInput,
    RoadmapSpec,
    RoadmapTaskSpec,
    RoadmapTaskType,
)
from src.services.roadmap.tasks import valid_tasks
from src.security.features_utils.usage import reserve_ai_credit, refund_ai_credit

logger = logging.getLogger(__name__)

MAX_LESSONS_PER_JOB = 60
DEFAULT_TASKS_PER_LESSON = 4


class AICodeTest(BaseModel):
    stdin: str = ""
    expected_stdout: str = ""
    hidden: bool = False
    label: str = ""


class AIQuizQuestion(BaseModel):
    text: str
    options: List[str] = Field(default_factory=list)
    correct_indices: List[int] = Field(default_factory=list)


class AILessonTask(BaseModel):
    kind: Literal["quiz", "code", "short_answer", "number_answer"]
    title: str
    description: str = ""
    hint: str = ""
    quiz_questions: List[AIQuizQuestion] = Field(default_factory=list)
    language: str = "python"
    starter_code: str = ""
    solution_code: str = ""
    code_tests: List[AICodeTest] = Field(default_factory=list)
    accepted_answers: List[str] = Field(default_factory=list)
    correct_value: Optional[float] = None
    tolerance: float = 0
    unit: Optional[str] = None


class AILessonTasksPlan(BaseModel):
    tasks: List[AILessonTask] = Field(default_factory=list)


_LECTURE_SYSTEM = """You are an expert teacher writing a lecture for an online course.
Write the lecture in Markdown, in the requested language. Structure it as:
- a short intro,
- 2-5 sections with headings,
- concrete examples,
- a short recap.
Do NOT include exercises, quizzes or assignments: those are separate.
Do not mention that you are an AI. Do not wrap the whole answer in a code fence."""

_TASKS_SYSTEM = """You are an expert instructional designer creating graded practice for one lesson.
Return a plan with exactly the requested number of tasks.
Use a mix of task kinds. For programming lessons include at least one "code" task
(and usually one "quiz"). For non-programming lessons use quiz, short_answer and
number_answer instead of code.
Rules:
- Every quiz question has at least one correct option; correct_indices are 0-based.
- Code tasks must include at least two test cases (stdin + exact expected stdout),
  starter_code with a skeleton, and solution_code that passes every test.
- Tests must be deterministic: no randomness, no time, no network.
- Write everything in the requested language."""


def _language_name(code: str) -> str:
    return {
        "ru": "Russian",
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "it": "Italian",
        "pl": "Polish",
        "uk": "Ukrainian",
        "kk": "Kazakh",
        "tr": "Turkish",
        "zh": "Chinese",
        "ja": "Japanese",
        "ko": "Korean",
        "ar": "Arabic",
        "hi": "Hindi",
    }.get((code or "en").lower(), "English")


async def generate_lecture_markdown(
    *,
    course_name: str,
    course_description: str,
    chapter_name: str,
    chapter_description: str,
    lesson_title: str,
    lesson_summary: str,
    material: Optional[str],
    language: str,
    model_name: str,
) -> str:
    material_part = ""
    if material and material.strip():
        material_part = (
            "\nUse this teacher-provided material as the source of truth. Keep its facts, "
            "expand it into a complete lecture, and do not contradict it:\n"
            f"<material>\n{material[:AI_CONTEXT_MAX_CHARS]}\n</material>\n"
        )
    prompt = (
        f"Course: {course_name}\nCourse description: {course_description}\n"
        f"Chapter: {chapter_name}\nChapter description: {chapter_description}\n"
        f"Lesson: {lesson_title}\nLesson goal: {lesson_summary}\n"
        f"{material_part}\n"
        f"Write the lecture in {_language_name(language)}. Return Markdown only."
    )
    output = await generate(
        model_name=model_name,
        user_prompt=prompt,
        system_prompt=_LECTURE_SYSTEM,
        temperature=0.6,
        timeout=180.0,
    )
    text = str(output or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _to_task_specs(plan: AILessonTasksPlan) -> List[RoadmapTaskSpec]:
    specs: List[RoadmapTaskSpec] = []
    for task in plan.tasks:
        if task.kind == "quiz":
            questions = []
            for question in task.quiz_questions:
                if not question.options:
                    continue
                correct = set(question.correct_indices)
                questions.append(
                    QuizQuestionInput(
                        text=question.text,
                        response_type="multiple" if len(correct) > 1 else "single",
                        options=[
                            QuizOptionInput(text=option, correct=index in correct)
                            for index, option in enumerate(question.options)
                        ],
                    )
                )
            specs.append(
                RoadmapTaskSpec(
                    type=RoadmapTaskType.QUIZ,
                    title=task.title,
                    description=task.description,
                    hint=task.hint,
                    questions=questions,
                )
            )
        elif task.kind == "code":
            specs.append(
                RoadmapTaskSpec(
                    type=RoadmapTaskType.CODE,
                    title=task.title,
                    description=task.description,
                    hint=task.hint,
                    language=task.language or "python",
                    starter_code=task.starter_code,
                    solution_code=task.solution_code,
                    tests=[
                        CodeTestInput(
                            stdin=test.stdin,
                            expected_stdout=test.expected_stdout,
                            hidden=test.hidden,
                            label=test.label,
                        )
                        for test in task.code_tests
                    ],
                )
            )
        elif task.kind == "short_answer":
            specs.append(
                RoadmapTaskSpec(
                    type=RoadmapTaskType.SHORT_ANSWER,
                    title=task.title,
                    description=task.description,
                    hint=task.hint,
                    answers=task.accepted_answers,
                )
            )
        elif task.kind == "number_answer" and task.correct_value is not None:
            specs.append(
                RoadmapTaskSpec(
                    type=RoadmapTaskType.NUMBER_ANSWER,
                    title=task.title,
                    description=task.description,
                    hint=task.hint,
                    value=task.correct_value,
                    tolerance=task.tolerance,
                    unit=task.unit,
                )
            )
    return specs


async def generate_lesson_tasks(
    *,
    course_name: str,
    chapter_name: str,
    lesson_title: str,
    lesson_summary: str,
    material: Optional[str],
    language: str,
    model_name: str,
    num_tasks: int = DEFAULT_TASKS_PER_LESSON,
) -> List[RoadmapTaskSpec]:
    prompt = (
        f"Course: {course_name}\nChapter: {chapter_name}\nLesson: {lesson_title}\n"
        f"Lesson goal: {lesson_summary}\n"
        f"Create exactly {num_tasks} practice tasks for this lesson in "
        f"{_language_name(language)}.\n"
    )
    if material and material.strip():
        prompt += f"Lesson material:\n<material>\n{material[:AI_CONTEXT_MAX_CHARS]}\n</material>\n"
    prompt += "Return the structured plan."

    plan: AILessonTasksPlan = await generate(
        model_name=model_name,
        user_prompt=prompt,
        system_prompt=_TASKS_SYSTEM,
        output_type=AILessonTasksPlan,
        temperature=0.4,
        timeout=180.0,
    )
    specs, rejected = valid_tasks(_to_task_specs(plan))
    if rejected:
        logger.warning("Dropped invalid generated roadmap tasks: %s", rejected)
    return specs[: max(1, num_tasks)]


def _find_lesson(plan: RoadmapSpec, key: str):
    try:
        chapter_index, lesson_index = (int(part) for part in key.split(":", 1))
        chapter = plan.chapters[chapter_index]
        return chapter, chapter.lessons[lesson_index]
    except (ValueError, IndexError):
        return None, None


async def _update_item(
    db: AsyncSession,
    job: RoadmapImportJob,
    index: int,
    *,
    state: RoadmapItemState,
    error: Optional[str] = None,
) -> None:
    items = list(job.items or [])
    if 0 <= index < len(items):
        items[index] = {**items[index], "state": state.value}
        if error:
            items[index]["error"] = error[:2000]
        else:
            items[index].pop("error", None)
        job.items = items
        job.completed = sum(1 for item in items if item.get("state") == RoadmapItemState.READY.value)
        job.failed = sum(1 for item in items if item.get("state") == RoadmapItemState.FAILED.value)
        job.update_date = datetime.now().isoformat()
        db.add(job)
        await db.commit()


async def run_import_job(job_uuid: str) -> None:
    """Process one import job. Runs in a background task with its own session."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from src.core.events.database import engine

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        job = (
            await db.execute(
                select(RoadmapImportJob).where(RoadmapImportJob.job_uuid == job_uuid)
            )
        ).scalars().first()
        if not job:
            return
        if job.status in (RoadmapJobStatus.COMPLETED, RoadmapJobStatus.PARTIAL):
            return

        job.status = RoadmapJobStatus.RUNNING
        db.add(job)
        await db.commit()

        try:
            plan = RoadmapSpec(**job.plan)
        except Exception as exc:
            job.status = RoadmapJobStatus.FAILED
            job.error = f"Stored plan is invalid: {exc}"
            db.add(job)
            await db.commit()
            return

        # Local imports avoid a cycle: importer imports generation helpers.
        from src.services.roadmap.importer import apply_generated_lecture, apply_generated_tasks

        try:
            model_name = await resolve_model_for_org(job.org_id, db, purpose="planning")
        except Exception as exc:
            logger.warning("Roadmap job %s: AI not configured: %s", job_uuid, exc)
            for index, item in enumerate(job.items or []):
                if item.get("state") == RoadmapItemState.PENDING.value:
                    await _update_item(
                        db,
                        job,
                        index,
                        state=RoadmapItemState.FAILED,
                        error="AI is not configured for this organization",
                    )
            job.status = RoadmapJobStatus.FAILED
            job.error = "AI is not configured for this organization"
            db.add(job)
            await db.commit()
            return

        for index, item in enumerate(job.items or []):
            state = item.get("state")
            if state not in (RoadmapItemState.PENDING.value, RoadmapItemState.GENERATING.value):
                continue
            chapter, lesson = _find_lesson(plan, item.get("key", ""))
            if not chapter or not lesson:
                await _update_item(
                    db, job, index, state=RoadmapItemState.FAILED,
                    error="Lesson not found in stored plan",
                )
                continue
            await _update_item(db, job, index, state=RoadmapItemState.GENERATING)
            try:
                try:
                    await reserve_ai_credit(job.org_id, db, amount=1)
                except Exception as exc:
                    raise RuntimeError(f"AI credits unavailable: {exc}") from exc
                try:
                    if item.get("kind") == RoadmapItemKind.LECTURE.value:
                        markdown = await generate_lecture_markdown(
                            course_name=plan.title,
                            course_description=plan.description,
                            chapter_name=chapter.title,
                            chapter_description=chapter.description,
                            lesson_title=lesson.title,
                            lesson_summary=lesson.summary,
                            material=lesson.material,
                            language=plan.language,
                            model_name=model_name,
                        )
                        if not markdown.strip():
                            raise RuntimeError("The model returned an empty lecture")
                        await apply_generated_lecture(
                            db, job.course_id, item["activity_id"], markdown
                        )
                    else:
                        specs = await generate_lesson_tasks(
                            course_name=plan.title,
                            chapter_name=chapter.title,
                            lesson_title=lesson.title,
                            lesson_summary=lesson.summary,
                            material=lesson.material,
                            language=plan.language,
                            model_name=model_name,
                            num_tasks=len(lesson.tasks) or DEFAULT_TASKS_PER_LESSON,
                        )
                        if not specs:
                            raise RuntimeError("The model returned no valid tasks")
                        await apply_generated_tasks(
                            db, job.course_id, item["activity_id"], specs,
                            published=bool(item.get("published")),
                        )
                except Exception:
                    refund_ai_credit(job.org_id, 1)
                    raise
                await _update_item(db, job, index, state=RoadmapItemState.READY)
            except Exception as exc:
                logger.exception("Roadmap job %s item %s failed", job_uuid, index)
                await _update_item(
                    db, job, index, state=RoadmapItemState.FAILED, error=str(exc)
                )

        remaining = [
            item for item in (job.items or [])
            if item.get("state") in (RoadmapItemState.PENDING.value, RoadmapItemState.GENERATING.value)
        ]
        failed = [
            item for item in (job.items or [])
            if item.get("state") == RoadmapItemState.FAILED.value
        ]
        if remaining:
            job.status = RoadmapJobStatus.PARTIAL
        elif failed:
            job.status = RoadmapJobStatus.PARTIAL
        else:
            job.status = RoadmapJobStatus.COMPLETED
        job.update_date = datetime.now().isoformat()
        db.add(job)
        await db.commit()
