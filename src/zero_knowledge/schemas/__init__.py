"""Схемы данных платформы Zero Knowledge (Pydantic v2).

Публичный интерфейс пакета — все модели и перечисления импортируются
единообразно:

.. code-block:: python

    from zero_knowledge.schemas import Task, Answer, KnowledgeProfile, Roadmap
"""

from __future__ import annotations

from .answer import Answer
from .common import BaseSchema, Identified, Timestamped
from .enums import (
    AnswerFormat,
    AnswerStatus,
    CognitiveDepth,
    ConfidenceLevel,
    Difficulty,
    Discipline,
    HintLevel,
    LearningGoalStatus,
    MasteryLevel,
    MisconceptionCause,
    MisconceptionStatus,
    RoadmapStepStatus,
    RoadmapStepType,
    SolutionQuestionKind,
    TaskSetPurpose,
    TaskType,
)
from .hint import Hint
from .profile import KnowledgeProfile, Misconception, SkillAssessment
from .roadmap import Recommendation, Roadmap, RoadmapStep
from .solution import ReferenceSolution, SolutionStep
from .solution_review import (
    HintUsage,
    SolutionQuestion,
    SolutionQuestionnaire,
    SolutionReview,
    UnderstandingAssessment,
)
from .task import Task
from .task_set import TaskSet, TaskSetItem
from .testcase import TestCase

__all__ = [
    # Базовые модели
    "BaseSchema",
    "Identified",
    "Timestamped",
    # Задача и связанные сущности
    "Task",
    "Answer",
    "Hint",
    "ReferenceSolution",
    "SolutionStep",
    "TestCase",
    "TaskSet",
    "TaskSetItem",
    # Профиль знаний
    "KnowledgeProfile",
    "SkillAssessment",
    "Misconception",
    # Roadmap
    "Roadmap",
    "RoadmapStep",
    "Recommendation",
    # Разбор решения и оценка понимания
    "SolutionQuestion",
    "SolutionQuestionnaire",
    "HintUsage",
    "UnderstandingAssessment",
    "SolutionReview",
    # Перечисления
    "Discipline",
    "TaskType",
    "Difficulty",
    "CognitiveDepth",
    "HintLevel",
    "AnswerFormat",
    "AnswerStatus",
    "ConfidenceLevel",
    "MasteryLevel",
    "MisconceptionCause",
    "MisconceptionStatus",
    "RoadmapStepType",
    "RoadmapStepStatus",
    "LearningGoalStatus",
    "TaskSetPurpose",
    "SolutionQuestionKind",
]
