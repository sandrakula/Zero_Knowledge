"""Database models for roadmap imports and per-lesson learner feedback.

A roadmap import is persisted as one ``RoadmapImportJob`` row: the normalized
plan, the per-activity work items and their progress. The course structure is
created synchronously; lecture/task generation continues in the background and
updates the job row, so the dashboard can poll progress without a websocket.

``LessonFeedback`` is the learner's comment on a single lesson (activity). One
row per learner per activity, editable by its author; instructors read every row
for their course and may resolve it.
"""

from enum import Enum
from typing import List, Optional

from sqlalchemy import Column, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class RoadmapJobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class RoadmapItemKind(str, Enum):
    LECTURE = "LECTURE"
    TASKS = "TASKS"


class RoadmapItemState(str, Enum):
    PENDING = "PENDING"
    GENERATING = "GENERATING"
    READY = "READY"
    SKIPPED = "SKIPPED"
    FAILED = "FAILED"


class FeedbackStatus(str, Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class RoadmapImportJobBase(SQLModel):
    status: RoadmapJobStatus = RoadmapJobStatus.PENDING
    # Normalized roadmap that was imported, kept for retries and auditing.
    plan: dict = Field(default_factory=dict, sa_column=Column(JSONB))
    # [{"key", "kind", "activity_uuid", "activity_id", "state", "error"}]
    items: List[dict] = Field(default_factory=list, sa_column=Column(JSONB))
    total: int = 0
    completed: int = 0
    failed: int = 0
    error: Optional[str] = Field(default=None, sa_column=Column(Text))


class RoadmapImportJob(RoadmapImportJobBase, table=True):
    __tablename__ = "roadmap_import_job"
    __table_args__ = (
        Index("ix_roadmap_job_org", "org_id"),
        Index("ix_roadmap_job_course", "course_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    job_uuid: str = Field(default="", index=True)
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
    user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
        ),
    )
    creation_date: str = ""
    update_date: str = ""


class RoadmapImportJobRead(RoadmapImportJobBase):
    id: int
    job_uuid: str
    org_id: int
    course_id: int
    user_id: Optional[int] = None
    creation_date: str
    update_date: str


class LessonFeedbackBase(SQLModel):
    # 1..5, optional: a learner may leave only a comment.
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    content: str = Field(default="", sa_column=Column(Text))
    status: FeedbackStatus = FeedbackStatus.OPEN


class LessonFeedback(LessonFeedbackBase, table=True):
    __tablename__ = "lesson_feedback"
    __table_args__ = (
        UniqueConstraint("user_id", "activity_id", name="uq_lesson_feedback_user_activity"),
        Index("ix_lesson_feedback_course", "course_id"),
        Index("ix_lesson_feedback_activity", "activity_id"),
        Index("ix_lesson_feedback_status", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    feedback_uuid: str = Field(default="", index=True)
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
        sa_column=Column(
            Integer, ForeignKey("chapter.id", ondelete="SET NULL"), nullable=True
        ),
    )
    activity_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False
        )
    )
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    creation_date: str = ""
    update_date: str = ""


class LessonFeedbackRead(LessonFeedbackBase):
    id: int
    feedback_uuid: str
    org_id: int
    course_id: int
    chapter_id: Optional[int] = None
    activity_id: int
    activity_uuid: Optional[str] = None
    activity_name: Optional[str] = None
    chapter_name: Optional[str] = None
    user_id: int
    username: Optional[str] = None
    creation_date: str
    update_date: str


class LessonFeedbackUpsert(SQLModel):
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    content: str = ""
