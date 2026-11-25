"""Adaptive practice state: attempts, topic mastery and item calibration.

The course model itself is untouched. These tables are the learning layer on
top of it:

* ``practice_attempt`` — one row per graded submission (latest state of that
  submission, keyed by its uuid), so a re-grade updates the row instead of
  inflating history;
* ``user_topic_mastery`` — the projected 0..1 mastery for one learner and one
  topic (a chapter uuid by default);
* ``item_calibration`` — how hard a task turned out to be, aggregated over the
  whole organization.

Every row carries ``org_id`` so the usual tenant boundary applies.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel


class PracticeAttempt(SQLModel, table=True):
    """The latest graded state of one submission.

    ``source_uuid`` is the natural key of the attempt inside its source:
    ``assignment_task_submission_uuid`` for LMS assignments, a generated uuid
    for any future source. ``(user_id, source_uuid)`` is unique so replaying a
    grade is idempotent.
    """

    __tablename__ = "practice_attempt"
    __table_args__ = (
        UniqueConstraint("user_id", "source_uuid", name="uq_practice_attempt_source"),
        Index("ix_practice_attempt_user_topic", "user_id", "topic_key"),
        Index("ix_practice_attempt_org_created", "org_id", "created_at"),
        Index("ix_practice_attempt_task", "task_uuid"),
        Index("ix_practice_attempt_course", "course_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    course_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False
        )
    )
    chapter_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("chapter.id", ondelete="SET NULL")),
    )
    task_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("assignmenttask.id", ondelete="SET NULL")),
    )
    topic_key: str = Field(default="", max_length=128)
    task_uuid: str = Field(default="", max_length=64)
    activity_uuid: str = Field(default="", max_length=64)
    assignment_uuid: str = Field(default="", max_length=64)
    task_type: str = Field(default="", max_length=32)
    source: str = Field(default="assignment", max_length=32)
    source_uuid: str = Field(default="", max_length=128)
    level: int = Field(default=1)
    score: float = Field(default=0.0)
    passed: bool = Field(default=False, sa_column=Column(Boolean, nullable=False))
    tests_passed: int = Field(default=0)
    tests_total: int = Field(default=0)
    elapsed_ms: int = Field(default=0)
    graded_at: str = Field(default="")
    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class UserTopicMastery(SQLModel, table=True):
    """Projected mastery for one learner in one topic of one course."""

    __tablename__ = "user_topic_mastery"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "org_id", "course_id", "topic_key",
            name="uq_user_topic_mastery",
        ),
        Index("ix_user_topic_mastery_user_course", "user_id", "course_id"),
        Index("ix_user_topic_mastery_org_topic", "org_id", "topic_key"),
        Index("ix_user_topic_mastery_review", "user_id", "next_review_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    course_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False
        )
    )
    topic_key: str = Field(default="", max_length=128)
    topic_name: str = Field(default="", max_length=300)
    mastery: float = Field(default=0.0)
    confidence: float = Field(default=0.0)
    attempts: int = Field(default=0)
    passed: int = Field(default=0)
    last_attempt_at: str = Field(default="")
    next_review_at: str = Field(default="")
    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class ItemCalibration(SQLModel, table=True):
    """Aggregated difficulty of a task inside one organization."""

    __tablename__ = "item_calibration"
    __table_args__ = (
        UniqueConstraint("org_id", "task_uuid", name="uq_item_calibration_task"),
        Index("ix_item_calibration_org", "org_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    task_uuid: str = Field(default="", max_length=64)
    attempts: int = Field(default=0)
    passes: int = Field(default=0)
    difficulty: float = Field(default=0.0)
    median_elapsed_ms: int = Field(default=0)
    updated_at: str = Field(default="")
