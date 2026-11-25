"""Adaptive practice: attempts, topic mastery and item calibration

Revision ID: r1j2k3l4m5n6
Revises: q9i0j1k2l3m4
Create Date: 2026-11-24

Adds the learning layer on top of the existing course model. The course,
chapter, activity and assignment tables are untouched; these tables only store
what learners did and how well they did it, so the adaptive feed can pick the
next task without rewriting grades.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "r1j2k3l4m5n6"
down_revision: Union[str, None] = "q9i0j1k2l3m4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practice_attempt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("topic_key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("task_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("activity_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("assignment_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("task_type", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="assignment"),
        sa.Column("source_uuid", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("tests_passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tests_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("graded_at", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["course.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapter.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["task_id"], ["assignmenttask.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "source_uuid", name="uq_practice_attempt_source"),
    )
    op.create_index(
        "ix_practice_attempt_user_topic",
        "practice_attempt",
        ["user_id", "topic_key"],
    )
    op.create_index(
        "ix_practice_attempt_org_created",
        "practice_attempt",
        ["org_id", "created_at"],
    )
    op.create_index("ix_practice_attempt_task", "practice_attempt", ["task_uuid"])
    op.create_index("ix_practice_attempt_course", "practice_attempt", ["course_id"])

    op.create_table(
        "user_topic_mastery",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("topic_key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("topic_name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("mastery", sa.Float(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.String(), nullable=False, server_default=""),
        sa.Column("next_review_at", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["course.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "org_id",
            "course_id",
            "topic_key",
            name="uq_user_topic_mastery",
        ),
    )
    op.create_index(
        "ix_user_topic_mastery_user_course",
        "user_topic_mastery",
        ["user_id", "course_id"],
    )
    op.create_index(
        "ix_user_topic_mastery_org_topic",
        "user_topic_mastery",
        ["org_id", "topic_key"],
    )
    op.create_index(
        "ix_user_topic_mastery_review",
        "user_topic_mastery",
        ["user_id", "next_review_at"],
    )

    op.create_table(
        "item_calibration",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("task_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("difficulty", sa.Float(), nullable=False, server_default="0"),
        sa.Column("median_elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "task_uuid", name="uq_item_calibration_task"),
    )
    op.create_index("ix_item_calibration_org", "item_calibration", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_item_calibration_org", table_name="item_calibration")
    op.drop_table("item_calibration")

    op.drop_index("ix_user_topic_mastery_review", table_name="user_topic_mastery")
    op.drop_index("ix_user_topic_mastery_org_topic", table_name="user_topic_mastery")
    op.drop_index("ix_user_topic_mastery_user_course", table_name="user_topic_mastery")
    op.drop_table("user_topic_mastery")

    op.drop_index("ix_practice_attempt_course", table_name="practice_attempt")
    op.drop_index("ix_practice_attempt_task", table_name="practice_attempt")
    op.drop_index("ix_practice_attempt_org_created", table_name="practice_attempt")
    op.drop_index("ix_practice_attempt_user_topic", table_name="practice_attempt")
    op.drop_table("practice_attempt")
