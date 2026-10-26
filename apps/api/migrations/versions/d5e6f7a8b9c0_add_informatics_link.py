"""Add the per-user Informatics account binding table.

Revision ID: d5e6f7a8b9c0
Revises: a7b8c9d0e1f2
Create Date: 2026-10-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "informatics_link",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_cookie", sa.String(), nullable=False),
        sa.Column("informatics_user_id", sa.Integer(), nullable=False),
        sa.Column("informatics_username", sa.String(), nullable=False),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("informatics_link")
