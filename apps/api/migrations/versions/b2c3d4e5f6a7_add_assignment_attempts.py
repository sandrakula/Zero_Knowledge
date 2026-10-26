"""Add durable CODE-task attempt history

Revision ID: b2c3d4e5f6a7
Revises: a9b8c7d6e5f4
Create Date: 2026-10-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel  # noqa: F401
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a9b8c7d6e5f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assignmentattempt" in set(inspector.get_table_names()):
        return

    op.create_table(
        "assignmentattempt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("attempt_uuid", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column("activity_id", sa.Integer(), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("assignment_task_id", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_code", sa.Text(), nullable=False),
        sa.Column("language_id", sa.Integer(), nullable=False),
        sa.Column(
            "verdict",
            sa.String(),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column("passed_tests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("memory_kb", sa.Integer(), nullable=True),
        sa.Column("test_results", sa.JSON(), nullable=False),
        sa.Column("created_date", sa.String(), nullable=False),
        sa.Column("update_date", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["org_id"], ["organization.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["course_id"], ["course.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["activity_id"], ["activity.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["assignment_id"], ["assignment.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["assignment_task_id"], ["assignmenttask.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "assignment_task_id",
            "attempt_number",
            name="uq_assignmentattempt_user_task_attempt",
        ),
    )
    op.create_index(
        "ix_assignmentattempt_attempt_uuid",
        "assignmentattempt",
        ["attempt_uuid"],
        unique=False,
    )
    op.create_index(
        "ix_assignmentattempt_user_assignment",
        "assignmentattempt",
        ["user_id", "assignment_id"],
        unique=False,
    )
    op.create_index(
        "ix_assignmentattempt_task",
        "assignmentattempt",
        ["assignment_task_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assignmentattempt" not in set(inspector.get_table_names()):
        return
    try:
        op.drop_index("ix_assignmentattempt_task", table_name="assignmentattempt")
        op.drop_index(
            "ix_assignmentattempt_user_assignment", table_name="assignmentattempt"
        )
        op.drop_index(
            "ix_assignmentattempt_attempt_uuid", table_name="assignmentattempt"
        )
    except Exception:  # pragma: no cover - indexes may be absent
        pass
    op.drop_table("assignmentattempt")
