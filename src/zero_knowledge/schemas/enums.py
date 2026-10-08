"""Перечисления (enums) схем данных платформы Zero Knowledge.

Все значения зафиксированы строковыми литералами (``str, Enum``), поэтому
они стабильно сериализуются в JSON и обратно. Значения соответствуют
нумерации пунктов спецификации проекта (см. ``docs/project_spec.md``).
"""

from __future__ import annotations

from enum import Enum


class Discipline(str, Enum):
    """Предметные направления платформы (п. 2 спецификации)."""

    MACHINE_LEARNING = "machine_learning"
    PROGRAMMING = "programming"
    ALGORITHMS = "algorithms"
    COMPETITIVE_PROGRAMMING = "competitive_programming"
    MATHEMATICS = "mathematics"
    STATISTICS = "statistics"


class TaskType(str, Enum):
    """Типы заданий, используемых в диагностике и практике (п. 5, 11–13)."""

    QUESTION = "question"                # вопрос
    SHORT_TASK = "short_task"            # небольшая задача
    PRACTICAL = "practical"              # практическое задание
    PROGRAMMING = "programming"          # программирование
    EXPLANATION = "explanation"          # задание на объяснение
    TRANSFER = "transfer"                # задача на перенос
    COMPARISON = "comparison"            # сравнение вариантов решения
    DEBUGGING = "debugging"              # поиск ошибки в готовом коде
    PROJECT = "project"                  # комплексный проект


class Difficulty(str, Enum):
    """Уровень сложности задания (п. 5, 6)."""

    TRIVIAL = "trivial"
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EXPERT = "expert"


class CognitiveDepth(str, Enum):
    """Глубина понимания — уровни по таксономии Блума (п. 14)."""

    RECOGNITION = "recognition"          # узнавание
    COMPREHENSION = "comprehension"      # понимание
    APPLICATION = "application"          # применение
    ANALYSIS = "analysis"                # анализ
    EVALUATION = "evaluation"            # оценка / сравнение
    CREATION = "creation"                # создание собственного решения


class HintLevel(str, Enum):
    """Уровни подсказки: от намёка до полного объяснения (п. 8)."""

    NUDGE = "nudge"                      # намёк
    QUESTION = "question"                # вопрос
    DIRECTION = "direction"              # указание направления
    IDEA = "idea"                        # объяснение конкретной идеи
    STEP = "step"                        # разбор шага
    FULL_EXPLANATION = "full_explanation"  # полное объяснение


class AnswerFormat(str, Enum):
    """Формат ответа студента (п. 5)."""

    TEXT = "text"
    CODE = "code"
    CHOICE = "choice"
    NUMERIC = "numeric"
    EXPLANATION = "explanation"


class AnswerStatus(str, Enum):
    """Статус проверки ответа (п. 11)."""

    PENDING = "pending"
    CORRECT = "correct"
    PARTIALLY_CORRECT = "partially_correct"
    INCORRECT = "incorrect"


class ConfidenceLevel(str, Enum):
    """Самооценка уверенности студента (п. 19, метакогнитивный слой)."""

    VERY_LOW = "very_low"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


class MasteryLevel(str, Enum):
    """Степень освоения навыка — измерение ``mastery`` (п. 25)."""

    UNKNOWN = "unknown"
    NOVICE = "novice"
    DEVELOPING = "developing"
    PROFICIENT = "proficient"
    EXPERT = "expert"


class MisconceptionCause(str, Enum):
    """Определённая причина ошибки / заблуждения (п. 9)."""

    MISSING_RULE = "missing_rule"                # не знает правило
    MISUNDERSTOOD_CONCEPT = "misunderstood_concept"  # неверно понял концепцию
    CANNOT_APPLY = "cannot_apply"                # знает, но не умеет применять
    WRONG_STRATEGY = "wrong_strategy"            # неверная стратегия решения
    CARELESS_ERROR = "careless_error"            # невнимательная ошибка
    CONFUSED_CONCEPTS = "confused_concepts"      # перепутал похожие понятия
    ROTE_MEMORIZATION = "rote_memorization"      # механически заучил решение
    TRANSFER_FAILURE = "transfer_failure"        # не перенёс знание в новый контекст


class MisconceptionStatus(str, Enum):
    """Жизненный цикл устойчивого заблуждения (п. 9)."""

    ACTIVE = "active"
    IN_CORRECTION = "in_correction"
    RESOLVED = "resolved"


class RoadmapStepType(str, Enum):
    """Тип шага персонального пути обучения (п. 6–7)."""

    STUDY = "study"                      # изучение теории / примеров
    PRACTICE = "practice"                # практика
    REVIEW = "review"                    # повторение
    TRANSFER = "transfer"                # задача на перенос
    ASSESSMENT = "assessment"            # проверка понимания
    PROJECT = "project"                  # комплексная работа / проект


class RoadmapStepStatus(str, Enum):
    """Статус шага roadmap (п. 27)."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class LearningGoalStatus(str, Enum):
    """Статус цели обучения (п. 27, шаг 1)."""

    DEFINED = "defined"
    DIAGNOSING = "diagnosing"
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    ACHIEVED = "achieved"
    ARCHIVED = "archived"


class TaskSetPurpose(str, Enum):
    """Назначение набора задач (диагностика / проверка)."""

    DIAGNOSTIC = "diagnostic"            # начальная диагностика (п. 5)
    CHECKPOINT = "checkpoint"            # промежуточная проверка понимания
    FINAL = "final"                      # итоговая оценка
