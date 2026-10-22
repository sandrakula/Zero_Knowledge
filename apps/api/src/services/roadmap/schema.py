"""Schemas for roadmap import and the roadmap AI assistant.

The import format is deliberately forgiving: a teacher may hand-write JSON or
YAML with ``name`` instead of ``title``, ``lessons`` instead of ``activities``,
uppercase or lowercase task types, and either ``correct``/``is_correct`` on a
quiz option. Everything is normalized into the model below before a single row
is written, so the importer never has to guess.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RoadmapTaskType(str, Enum):
    QUIZ = "QUIZ"
    CODE = "CODE"
    SHORT_ANSWER = "SHORT_ANSWER"
    NUMBER_ANSWER = "NUMBER_ANSWER"
    FORM = "FORM"
    FILE_SUBMISSION = "FILE_SUBMISSION"


# Judge0 language ids used by the code task editor (mirrors
# apps/web/components/Objects/Editor/Extensions/CodePlayground/languages.ts).
CODE_LANGUAGES: Dict[str, int] = {
    "python": 71,
    "python3": 71,
    "javascript": 63,
    "node": 63,
    "typescript": 74,
    "java": 62,
    "cpp": 54,
    "c++": 54,
    "c": 50,
    "rust": 73,
    "go": 60,
    "php": 68,
    "ruby": 72,
    "kotlin": 78,
    "swift": 83,
    "csharp": 51,
    "c#": 51,
}


def resolve_language_id(value: Any) -> Optional[int]:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    key = value.strip().lower()
    if key.isdigit():
        return int(key)
    return CODE_LANGUAGES.get(key)


class QuizOptionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    text: str
    correct: bool = False

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, str):
            return {"text": data, "correct": False}
        if isinstance(data, dict):
            data = dict(data)
            if "correct" not in data:
                for key in ("is_correct", "isCorrect", "right", "assigned_right_answer"):
                    if key in data:
                        data["correct"] = data[key]
                        break
        return data


class QuizQuestionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    text: str
    options: List[QuizOptionInput] = Field(default_factory=list)
    response_type: Literal["single", "multiple"] = "single"

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, str):
            return {"text": data, "options": []}
        if isinstance(data, dict):
            data = dict(data)
            if "text" not in data:
                for key in ("question_text", "questionText", "prompt", "title"):
                    if key in data:
                        data["text"] = data[key]
                        break
        return data


class FormBlankInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    placeholder: str = ""
    correct_answer: str = ""
    hint: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, str):
            return {"placeholder": "", "correct_answer": data}
        if isinstance(data, dict):
            data = dict(data)
            if "correct_answer" not in data:
                for key in ("correctAnswer", "answer", "value"):
                    if key in data:
                        data["correct_answer"] = data[key]
                        break
        return data


class FormQuestionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    text: str = ""
    blanks: List[FormBlankInput] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if "text" not in data:
                for key in ("question_text", "questionText", "prompt"):
                    if key in data:
                        data["text"] = data[key]
                        break
        return data


class CodeTestInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    stdin: str = ""
    expected_stdout: str = ""
    hidden: bool = False
    label: str = ""
    weight: int = 1

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if "expected_stdout" not in data:
                for key in ("expectedStdout", "stdout", "expected", "output"):
                    if key in data:
                        data["expected_stdout"] = data[key]
                        break
        return data


class RoadmapTaskSpec(BaseModel):
    """One graded task. Only the fields belonging to ``type`` are used."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    type: RoadmapTaskType
    title: str
    description: str = ""
    hint: str = ""

    # QUIZ
    questions: List[QuizQuestionInput] = Field(default_factory=list)
    # CODE
    language: str = "python"
    language_id: Optional[int] = None
    starter_code: str = ""
    solution_code: str = ""
    tests: List[CodeTestInput] = Field(default_factory=list)
    grading_mode: Literal["equal_weight", "binary", "custom_weights"] = "equal_weight"
    # SHORT_ANSWER
    answers: List[str] = Field(default_factory=list)
    match_mode: Literal["exact", "case_insensitive", "contains", "regex"] = "case_insensitive"
    # NUMBER_ANSWER
    value: Optional[float] = None
    tolerance: float = 0
    unit: Optional[str] = None
    # FORM
    # (questions above reuse the quiz list shape only for quizzes; forms get
    # their own list to keep the two unambiguous)
    form_questions: List[FormQuestionInput] = Field(default_factory=list)
    # Optional explanation shown after grading (short/number answers).
    explanation: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        raw_type = data.get("type") or data.get("assignment_type") or data.get("kind")
        if isinstance(raw_type, str):
            key = raw_type.strip().upper()
            aliases = {
                "TEST": "QUIZ",
                "TESTS": "QUIZ",
                "MULTIPLE_CHOICE": "QUIZ",
                "CODE_TASK": "CODE",
                "PROGRAMMING": "CODE",
                "SHORT": "SHORT_ANSWER",
                "TEXT": "SHORT_ANSWER",
                "NUMBER": "NUMBER_ANSWER",
                "NUMERIC": "NUMBER_ANSWER",
                "FILL_IN_THE_BLANK": "FORM",
                "FILE": "FILE_SUBMISSION",
                "UPLOAD": "FILE_SUBMISSION",
            }
            data["type"] = aliases.get(key, key)
        if "assignment_type" in data and "type" not in data:
            data["type"] = data["assignment_type"]
        if "test_cases" in data and "tests" not in data:
            data["tests"] = data["test_cases"]
        if "questions" in data and isinstance(data["questions"], list):
            if data.get("type") == "FORM" and "form_questions" not in data:
                data["form_questions"] = data["questions"]
                data["questions"] = []
        if "correct_answers" in data and "answers" not in data:
            data["answers"] = data["correct_answers"]
        if "correct_value" in data and "value" not in data:
            data["value"] = data["correct_value"]
        return data


class RoadmapLessonSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    title: str
    summary: str = ""
    material: Optional[str] = None
    tasks: List[RoadmapTaskSpec] = Field(default_factory=list)
    generate: bool = True

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, str):
            return {"title": data}
        if isinstance(data, dict):
            data = dict(data)
            if "title" not in data:
                for key in ("name", "lesson", "lesson_title"):
                    if key in data:
                        data["title"] = data[key]
                        break
            if "summary" not in data:
                for key in ("description", "goal", "outcome"):
                    if key in data:
                        data["summary"] = data[key]
                        break
            if "material" not in data:
                for key in ("content", "lecture", "text", "material_markdown"):
                    if key in data:
                        data["material"] = data[key]
                        break
            tasks = data.get("tasks") or data.get("exercises") or data.get("assignments")
            if "tasks" not in data and tasks is not None:
                data["tasks"] = tasks
        return data


class RoadmapChapterSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    title: str
    description: str = ""
    lessons: List[RoadmapLessonSpec] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if isinstance(data, str):
            return {"title": data}
        if isinstance(data, dict):
            data = dict(data)
            if "title" not in data:
                for key in ("name", "chapter", "module"):
                    if key in data:
                        data["title"] = data[key]
                        break
            if "description" not in data:
                for key in ("summary", "about"):
                    if key in data:
                        data["description"] = data[key]
                        break
            lessons = data.get("lessons") or data.get("activities") or data.get("modules")
            if "lessons" not in data and lessons is not None:
                data["lessons"] = lessons
        return data


class RoadmapSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    title: str
    description: str = ""
    language: str = "en"
    tags: List[str] = Field(default_factory=list)
    chapters: List[RoadmapChapterSpec] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        if "title" not in data:
            for key in ("name", "course", "course_name"):
                if key in data:
                    data["title"] = data[key]
                    break
        if "description" not in data:
            for key in ("summary", "about"):
                if key in data:
                    data["description"] = data[key]
                    break
        if "chapters" not in data:
            for key in ("modules", "sections", "roadmap"):
                if key in data:
                    data["chapters"] = data[key]
                    break
        if "tags" in data:
            value = data["tags"]
            if isinstance(value, str):
                data["tags"] = [t.strip() for t in value.replace("|", ",").split(",") if t.strip()]
        return data

    def iter_lessons(self):
        for chapter in self.chapters:
            for lesson in chapter.lessons:
                yield chapter, lesson


class ImportRoadmapRequest(BaseModel):
    org_id: int
    plan: RoadmapSpec
    # Apply the roadmap to an existing course instead of creating a new one.
    course_uuid: Optional[str] = None
    generate_missing: bool = True
    publish: bool = False


class RoadmapOperation(BaseModel):
    """A single assistant-proposed change, applied by the instructor."""

    model_config = ConfigDict(extra="ignore")

    action: Literal[
        "add_chapter",
        "update_chapter",
        "delete_chapter",
        "add_lesson",
        "update_lesson",
        "delete_lesson",
        "generate_lesson",
        "add_task",
        "generate_tasks",
    ]
    chapter_uuid: Optional[str] = None
    activity_uuid: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    material: Optional[str] = None
    task: Optional[RoadmapTaskSpec] = None


class RoadmapAssistantRequest(BaseModel):
    message: str
    activity_uuid: Optional[str] = None
    assignment_task_uuid: Optional[str] = None


class RoadmapAssistantResponse(BaseModel):
    reply: str
    operations: List[RoadmapOperation] = Field(default_factory=list)


class ApplyRoadmapOperationsRequest(BaseModel):
    operations: List[RoadmapOperation]


class AppliedOperation(BaseModel):
    action: str
    status: Literal["applied", "failed"]
    detail: str = ""


class ApplyRoadmapOperationsResponse(BaseModel):
    applied: List[AppliedOperation] = Field(default_factory=list)


class RoadmapImportResponse(BaseModel):
    course_uuid: str
    course_id: int
    job_uuid: Optional[str] = None
    job_status: Optional[str] = None
    created: int = 0
    updated: int = 0
    skipped: int = 0
