"""Add roadmap import jobs and lesson feedback

Creates ``roadmap_import_job`` (normalized plan + per-activity generation work
items/progress) and ``lesson_feedback`` (one comment per learner per lesson,
readable by course instructors in the dashboard).

Revision ID: r0a1d2m3p4q5
Revises: e8f9a0b1c2d3
Create Date: 2026-10-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel  # noqa: F401
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "r0a1d2m3p4q5"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "roadmap_import_job" not in tables:
        op.create_table(
            "roadmap_import_job",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("job_uuid", sa.String(), nullable=False),
            sa.Column("org_id", sa.Integer(), nullable=False),
            sa.Column("course_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("plan", _json_type(), nullable=True),
            sa.Column("items", _json_type(), nullable=True),
            sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("creation_date", sa.String(), nullable=True),
            sa.Column("update_date", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(
                ["org_id"], ["organization.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["course_id"], ["course.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_roadmap_import_job_job_uuid", "roadmap_import_job", ["job_uuid"]
        )
        op.create_index("ix_roadmap_job_org", "roadmap_import_job", ["org_id"])
        op.create_index("ix_roadmap_job_course", "roadmap_import_job", ["course_id"])

    if "lesson_feedback" not in tables:
        op.create_table(
            "lesson_feedback",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("feedback_uuid", sa.String(), nullable=False),
            sa.Column("org_id", sa.Integer(), nullable=False),
            sa.Column("course_id", sa.Integer(), nullable=False),
            sa.Column("chapter_id", sa.Integer(), nullable=True),
            sa.Column("activity_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("rating", sa.Integer(), nullable=True),
            sa.Column("content", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("creation_date", sa.String(), nullable=True),
            sa.Column("update_date", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(
                ["org_id"], ["organization.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["course_id"], ["course.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["chapter_id"], ["chapter.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["activity_id"], ["activity.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id", "activity_id", name="uq_lesson_feedback_user_activity"
            ),
        )
        op.create_index(
            "ix_lesson_feedback_feedback_uuid", "lesson_feedback", ["feedback_uuid"]
        )
        op.create_index("ix_lesson_feedback_course", "lesson_feedback", ["course_id"])
        op.create_index(
            "ix_lesson_feedback_activity", "lesson_feedback", ["activity_id"]
        )
        op.create_index("ix_lesson_feedback_status", "lesson_feedback", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "lesson_feedback" in tables:
        op.drop_table("lesson_feedback")
    if "roadmap_import_job" in tables:
        op.drop_table("roadmap_import_job")
