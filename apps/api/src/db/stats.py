"""Statistics records: defenses/contests plus course KPI aggregates.

The raw events stay where they are (TrailStep, assignment submissions,
InformaticsSubmission, DefenseRecord, ContestEntry). Everything in this module
is a derived aggregate that can be rebuilt from those tables.
"""

from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel


class DefenseRecord(SQLModel, table=True):
    __tablename__ = "defense_record"
    __table_args__ = (
        Index("ix_defense_record_org_user", "org_id", "user_id"),
        Index("ix_defense_record_course_user", "course_id", "user_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="SET NULL"), nullable=True),
    )
    assignment_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("assignment.id", ondelete="SET NULL"), nullable=True
        ),
    )
    confirmed_by: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    confirmed_at: str = ""
    note: str = ""
    creation_date: str = ""
    update_date: str = ""


class ContestEntry(SQLModel, table=True):
    __tablename__ = "contest_entry"
    __table_args__ = (
        Index("ix_contest_entry_org_user", "org_id", "user_id"),
        Index("ix_contest_entry_org_date", "org_id", "happened_on"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    title: str = ""
    happened_on: str = ""
    creation_date: str = ""
    update_date: str = ""


# ── Learning programme ───────────────────────────────────────────────────────


class LearningProgram(SQLModel, table=True):
    """A sequence of courses assigned to a cohort."""

    __tablename__ = "learning_program"
    __table_args__ = (Index("ix_learning_program_org", "org_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    name: str = Field(default="", max_length=200)
    description: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    is_active: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True)
    )
    creation_date: str = Field(default="")
    update_date: str = Field(default="")


class ProgramCourse(SQLModel, table=True):
    """One course inside a programme, with its order, weight and unlock rule."""

    __tablename__ = "program_course"
    __table_args__ = (
        UniqueConstraint("program_id", "course_id", name="uq_program_course"),
        Index("ix_program_course_order", "program_id", "sequence_order"),
        Index("ix_program_course_course", "course_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    program_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("learning_program.id", ondelete="CASCADE"), nullable=False
        )
    )
    course_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False
        )
    )
    sequence_order: int = Field(default=1)
    weight: float = Field(default=1.0, sa_column=Column(Float, nullable=False, default=1.0))
    estimated_hours: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    volume: int = Field(default=0)
    unlock_after_course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="SET NULL"), nullable=True
        ),
    )
    unlock_kpi_threshold: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    include_in_global: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True)
    )
    kpi_formula: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    creation_date: str = Field(default="")
    update_date: str = Field(default="")


class ProgramEnrollment(SQLModel, table=True):
    __tablename__ = "program_enrollment"
    __table_args__ = (
        UniqueConstraint("program_id", "user_id", name="uq_program_enrollment"),
        Index("ix_program_enrollment_user", "user_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    program_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("learning_program.id", ondelete="CASCADE"), nullable=False
        )
    )
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    enrolled_at: str = Field(default="")
    status: str = Field(default="ACTIVE", max_length=32)


# ── Derived aggregates ───────────────────────────────────────────────────────


class UserCourseStat(SQLModel, table=True):
    """Current aggregate for one student in one course."""

    __tablename__ = "user_course_stat"
    __table_args__ = (
        UniqueConstraint("user_id", "program_id", "course_id", name="uq_user_course_stat"),
        Index("ix_user_course_stat_user", "user_id"),
        Index("ix_user_course_stat_program_course", "program_id", "course_id"),
        Index("ix_user_course_stat_course_kpi", "course_id", "course_kpi"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(default=0)
    program_id: int = Field(default=0)
    course_id: int = Field(default=0)
    enrolled_at: str = Field(default="")
    last_activity_at: str = Field(default="")
    course_status: str = Field(default="available", max_length=24)
    included_in_global: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True)
    )
    weight: float = Field(default=1.0, sa_column=Column(Float, nullable=False, default=1.0))

    activities_total: int = Field(default=0)
    activities_completed: int = Field(default=0)
    assignments_total: int = Field(default=0)
    assignments_graded: int = Field(default=0)
    tasks_total: int = Field(default=0)
    tasks_solved: int = Field(default=0)
    tasks_attempted: int = Field(default=0)
    grade_sum: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    grade_max_sum: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    grade_percent: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    defense_count: int = Field(default=0)
    contest_count: int = Field(default=0)
    informatics_attempts: int = Field(default=0)
    informatics_solved: int = Field(default=0)
    informatics_accepted: int = Field(default=0)
    informatics_avg_score: Optional[float] = Field(
        default=None, sa_column=Column(Float, nullable=True)
    )
    active_weeks: int = Field(default=0)
    total_weeks: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    active_days: int = Field(default=0)
    course_percent: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    course_kpi: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    computed_at: str = Field(default="")


class UserGlobalStat(SQLModel, table=True):
    __tablename__ = "user_global_stat"
    __table_args__ = (
        UniqueConstraint("user_id", "program_id", name="uq_user_global_stat"),
        Index("ix_user_global_stat_program", "program_id", "global_kpi"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(default=0)
    program_id: int = Field(default=0)
    global_kpi: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    weighted_kpi_sum: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    weight_sum: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    coverage: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    active_days: int = Field(default=0)
    courses_included: int = Field(default=0)
    courses_started: int = Field(default=0)
    courses_completed: int = Field(default=0)
    courses_locked: int = Field(default=0)
    computed_at: str = Field(default="")


class CourseStat(SQLModel, table=True):
    __tablename__ = "course_stat"
    __table_args__ = (
        UniqueConstraint("program_id", "course_id", name="uq_course_stat"),
        Index("ix_course_stat_program", "program_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    program_id: int = Field(default=0)
    course_id: int = Field(default=0)
    org_id: int = Field(default=0)
    students_total: int = Field(default=0)
    students_started: int = Field(default=0)
    students_completed: int = Field(default=0)
    avg_kpi: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    median_kpi: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    p25_kpi: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    p75_kpi: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    avg_percent: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    avg_grade_percent: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    informatics_attempts: int = Field(default=0)
    informatics_solved: int = Field(default=0)
    informatics_accepted: int = Field(default=0)
    computed_at: str = Field(default="")


class StatSnapshot(SQLModel, table=True):
    __tablename__ = "stat_snapshot"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "program_id",
            "scope_type",
            "scope_id",
            "period_kind",
            "period_start",
            name="uq_stat_snapshot",
        ),
        Index("ix_stat_snapshot_lookup", "user_id", "program_id", "scope_type", "period_kind"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=0)
    user_id: int = Field(default=0)
    program_id: int = Field(default=0)
    scope_type: str = Field(default="course", max_length=24)
    scope_id: int = Field(default=0)
    period_kind: str = Field(default="all", max_length=16)
    period_start: str = Field(default="")
    period_end: str = Field(default="")
    metrics: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    kpi: float = Field(default=0.0, sa_column=Column(Float, nullable=False, default=0.0))
    computed_at: str = Field(default="")


class InformaticsProblemStat(SQLModel, table=True):
    __tablename__ = "informatics_problem_stat"
    __table_args__ = (
        Index("ix_informatics_problem_stat_solved", "solved_users"),
    )

    problem_id: int = Field(primary_key=True)
    attempts: int = Field(default=0)
    solved_users: int = Field(default=0)
    accepted_attempts: int = Field(default=0)
    avg_score: float = Field(
        default=0.0, sa_column=Column(Float, nullable=False, default=0.0)
    )
    avg_time_ms: int = Field(default=0)
    avg_memory_kb: int = Field(default=0)
    last_attempt_at: str = Field(default="")
