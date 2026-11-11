"""A learner's written/spoken explanation of their own CODE solution.

One row per (assignment task, learner). Re-submitting replaces the text and the
AI assessment but keeps ``attempt_count`` so teachers can see how often the
learner refined their explanation.
"""

from __future__ import annotations

from sqlalchemy import JSON, Column, ForeignKey, Index, Text
from sqlmodel import Field, SQLModel


class TaskExplanation(SQLModel, table=True):
    __tablename__ = "assignment_task_explanation"
    __table_args__ = (
        Index(
            "ix_task_explanation_task_user",
            "assignment_task_id",
            "user_id",
            unique=True,
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    explanation_uuid: str = Field(default="", index=True)

    org_id: int = Field(
        sa_column=Column("org_id", ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column("assignment_id", ForeignKey("assignment.id", ondelete="CASCADE"))
    )
    assignment_task_id: int = Field(
        sa_column=Column(
            "assignment_task_id",
            ForeignKey("assignmenttask.id", ondelete="CASCADE"),
        )
    )
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )

    explanation_text: str = Field(default="", sa_column=Column(Text))
    input_mode: str = Field(default="text", max_length=16)
    source_code: str = Field(default="", sa_column=Column(Text))
    language_id: int | None = None

    ai_score: int | None = Field(default=None, ge=0, le=100)
    ai_level: str | None = Field(default=None, max_length=16)
    ai_feedback: str | None = Field(default=None, sa_column=Column(Text))
    ai_strengths: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    ai_gaps: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    ai_model: str | None = Field(default=None, max_length=128)
    status: str = Field(default="PENDING", max_length=16)
    attempt_count: int = 0

    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class TaskExplanationRead(SQLModel):
    explanation_uuid: str
    explanation_text: str
    input_mode: str
    source_code: str
    language_id: int | None = None
    ai_score: int | None = None
    ai_level: str | None = None
    ai_feedback: str | None = None
    ai_strengths: list[str] = Field(default_factory=list)
    ai_gaps: list[str] = Field(default_factory=list)
    ai_model: str | None = None
    status: str
    attempt_count: int
    created_at: str
    updated_at: str
