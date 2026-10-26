"""Add late-submission policy columns

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel  # noqa: F401
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "assignment" in tables:
        columns = {col["name"] for col in inspector.get_columns("assignment")}
        if "allow_late" not in columns:
            op.add_column(
                "assignment",
                sa.Column(
                    "allow_late",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    if "assignmentusersubmission" in tables:
        columns = {
            col["name"]
            for col in inspector.get_columns("assignmentusersubmission")
        }
        if "is_late" not in columns:
            op.add_column(
                "assignmentusersubmission",
                sa.Column(
                    "is_late",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "assignmentusersubmission" in tables:
        columns = {
            col["name"]
            for col in inspector.get_columns("assignmentusersubmission")
        }
        if "is_late" in columns:
            op.drop_column("assignmentusersubmission", "is_late")

    if "assignment" in tables:
        columns = {col["name"] for col in inspector.get_columns("assignment")}
        if "allow_late" in columns:
            op.drop_column("assignment", "allow_late")
