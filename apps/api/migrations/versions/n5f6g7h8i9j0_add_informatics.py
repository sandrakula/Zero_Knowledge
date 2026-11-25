"""Add Informatics account binding and verdict log

Revision ID: n5f6g7h8i9j0
Revises: e2f3a4b5c6d7
Create Date: 2026-11-24

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n5f6g7h8i9j0"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "informatics_account",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("informatics_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ingest_token_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("token_created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("last_seen_at", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "ix_informatics_account_token",
        "informatics_account",
        ["ingest_token_hash"],
        unique=False,
    )

    op.create_table(
        "informatics_submission",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("ejudge_status", sa.Integer(), nullable=False),
        sa.Column("tests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("solved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="userscript"),
        sa.Column("created_at", sa.String(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "run_id", name="uq_informatics_user_run"),
    )
    op.create_index(
        "ix_informatics_submission_user",
        "informatics_submission",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_informatics_submission_problem",
        "informatics_submission",
        ["problem_id"],
        unique=False,
    )
    op.create_index(
        "ix_informatics_user_problem",
        "informatics_submission",
        ["user_id", "problem_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_informatics_user_problem", table_name="informatics_submission")
    op.drop_index("ix_informatics_submission_problem", table_name="informatics_submission")
    op.drop_index("ix_informatics_submission_user", table_name="informatics_submission")
    op.drop_table("informatics_submission")
    op.drop_index("ix_informatics_account_token", table_name="informatics_account")
    op.drop_table("informatics_account")
