"""Remove the Google Form (Chronicles) outbox

Revision ID: p8h9i0j1k2l3
Revises: o7g8h9i0j1k2
Create Date: 2026-11-24

The LMS computes statistics from ``informatics_submission`` itself, so the
Google Form relay is no longer part of the product. Drop the outbox, the two
Chronicles flags and the short TASK_XXXX mapping column.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p8h9i0j1k2l3"
down_revision: Union[str, None] = "o7g8h9i0j1k2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(
        "ix_informatics_chronicles_status",
        table_name="informatics_chronicles_outbox",
    )
    op.drop_table("informatics_chronicles_outbox")
    op.drop_column("informatics_submission", "chronicles_logged_at")
    op.drop_column("informatics_submission", "chronicles_logged")
    op.drop_column("informatics_task_map", "task_id")


def downgrade() -> None:
    op.add_column(
        "informatics_task_map",
        sa.Column(
            "task_id",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "informatics_submission",
        sa.Column(
            "chronicles_logged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "informatics_submission",
        sa.Column(
            "chronicles_logged_at",
            sa.String(),
            nullable=False,
            server_default="",
        ),
    )
    op.create_table(
        "informatics_chronicles_outbox",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submission_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("task_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("next_attempt_at", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("sent_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["submission_id"], ["informatics_submission.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "submission_id", name="uq_informatics_chronicles_submission"
        ),
    )
    op.create_index(
        "ix_informatics_chronicles_status",
        "informatics_chronicles_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
