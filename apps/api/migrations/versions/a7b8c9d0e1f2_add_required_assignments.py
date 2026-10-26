"""Add required-assignment flag

Revision ID: a7b8c9d0e1f2
Revises: c3d4e5f6a7b8
Create Date: 2026-10-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel  # noqa: F401
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assignment" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("assignment")}
    if "is_required" not in columns:
        op.add_column(
            "assignment",
            sa.Column(
                "is_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "assignment" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("assignment")}
    if "is_required" in columns:
        op.drop_column("assignment", "is_required")
