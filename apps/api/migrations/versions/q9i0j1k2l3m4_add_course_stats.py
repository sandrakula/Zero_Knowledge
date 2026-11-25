"""Course KPI aggregates, programmes and statistics snapshots

Revision ID: q9i0j1k2l3m4
Revises: p8h9i0j1k2l3
Create Date: 2026-11-24

Raw events stay in TrailStep / assignment submissions / InformaticsSubmission.
These tables store derived, rebuildable aggregates and the programme sequence
that gives each course its weight and unlock rule.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q9i0j1k2l3m4"
down_revision: Union[str, None] = "p8h9i0j1k2l3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "learning_program",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("creation_date", sa.String(), nullable=False, server_default=""),
        sa.Column("update_date", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_program_org", "learning_program", ["org_id"])

    op.create_table(
        "program_course",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("sequence_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("estimated_hours", sa.Float(), nullable=False, server_default="0"),
        sa.Column("volume", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unlock_after_course_id", sa.Integer(), nullable=True),
        sa.Column("unlock_kpi_threshold", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "include_in_global", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("kpi_formula", sa.JSON(), nullable=True),
        sa.Column("creation_date", sa.String(), nullable=False, server_default=""),
        sa.Column("update_date", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["program_id"], ["learning_program.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["course_id"], ["course.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["unlock_after_course_id"], ["course.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("program_id", "course_id", name="uq_program_course"),
    )
    op.create_index(
        "ix_program_course_order", "program_course", ["program_id", "sequence_order"]
    )
    op.create_index("ix_program_course_course", "program_course", ["course_id"])

    op.create_table(
        "program_enrollment",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("enrolled_at", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ACTIVE"),
        sa.ForeignKeyConstraint(
            ["program_id"], ["learning_program.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("program_id", "user_id", name="uq_program_enrollment"),
    )
    op.create_index("ix_program_enrollment_user", "program_enrollment", ["user_id"])

    op.create_table(
        "user_course_stat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("program_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("course_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enrolled_at", sa.String(), nullable=False, server_default=""),
        sa.Column("last_activity_at", sa.String(), nullable=False, server_default=""),
        sa.Column(
            "course_status", sa.String(length=24), nullable=False, server_default="available"
        ),
        sa.Column(
            "included_in_global", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("weight", sa.Float(), nullable=False, server_default="1"),
        sa.Column("activities_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("activities_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assignments_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assignments_graded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tasks_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tasks_solved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tasks_attempted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("grade_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("grade_max_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("grade_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("defense_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("contest_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_solved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_accepted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_avg_score", sa.Float(), nullable=True),
        sa.Column("active_weeks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_weeks", sa.Float(), nullable=False, server_default="0"),
        sa.Column("active_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("course_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("course_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "program_id", "course_id", name="uq_user_course_stat"
        ),
    )
    op.create_index("ix_user_course_stat_user", "user_course_stat", ["user_id"])
    op.create_index(
        "ix_user_course_stat_program_course",
        "user_course_stat",
        ["program_id", "course_id"],
    )
    op.create_index(
        "ix_user_course_stat_course_kpi", "user_course_stat", ["course_id", "course_kpi"]
    )

    op.create_table(
        "user_global_stat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("program_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("global_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("weighted_kpi_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("weight_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("coverage", sa.Float(), nullable=False, server_default="0"),
        sa.Column("active_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("courses_included", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("courses_started", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("courses_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("courses_locked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "program_id", name="uq_user_global_stat"),
    )
    op.create_index(
        "ix_user_global_stat_program", "user_global_stat", ["program_id", "global_kpi"]
    )

    op.create_table(
        "course_stat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("course_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("org_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("students_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("students_started", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("students_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("median_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("p25_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("p75_kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_grade_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("informatics_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_solved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("informatics_accepted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.String(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("program_id", "course_id", name="uq_course_stat"),
    )
    op.create_index("ix_course_stat_program", "course_stat", ["program_id"])

    op.create_table(
        "stat_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("program_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "scope_type", sa.String(length=24), nullable=False, server_default="course"
        ),
        sa.Column("scope_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "period_kind", sa.String(length=16), nullable=False, server_default="all"
        ),
        sa.Column("period_start", sa.String(), nullable=False, server_default=""),
        sa.Column("period_end", sa.String(), nullable=False, server_default=""),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("kpi", sa.Float(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.String(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "program_id",
            "scope_type",
            "scope_id",
            "period_kind",
            "period_start",
            name="uq_stat_snapshot",
        ),
    )
    op.create_index(
        "ix_stat_snapshot_lookup",
        "stat_snapshot",
        ["user_id", "program_id", "scope_type", "period_kind"],
    )

    op.create_table(
        "informatics_problem_stat",
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("solved_users", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_time_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_memory_kb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.String(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("problem_id"),
    )
    op.create_index(
        "ix_informatics_problem_stat_solved",
        "informatics_problem_stat",
        ["solved_users"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_informatics_problem_stat_solved",
        table_name="informatics_problem_stat",
    )
    op.drop_table("informatics_problem_stat")
    op.drop_index("ix_stat_snapshot_lookup", table_name="stat_snapshot")
    op.drop_table("stat_snapshot")
    op.drop_index("ix_course_stat_program", table_name="course_stat")
    op.drop_table("course_stat")
    op.drop_index("ix_user_global_stat_program", table_name="user_global_stat")
    op.drop_table("user_global_stat")
    op.drop_index("ix_user_course_stat_course_kpi", table_name="user_course_stat")
    op.drop_index(
        "ix_user_course_stat_program_course", table_name="user_course_stat"
    )
    op.drop_index("ix_user_course_stat_user", table_name="user_course_stat")
    op.drop_table("user_course_stat")
    op.drop_index("ix_program_enrollment_user", table_name="program_enrollment")
    op.drop_table("program_enrollment")
    op.drop_index("ix_program_course_course", table_name="program_course")
    op.drop_index("ix_program_course_order", table_name="program_course")
    op.drop_table("program_course")
    op.drop_index("ix_learning_program_org", table_name="learning_program")
    op.drop_table("learning_program")
