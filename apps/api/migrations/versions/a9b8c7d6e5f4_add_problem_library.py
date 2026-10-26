"""Add the org-scoped problem library and task provenance columns

Creates ``problem`` (reusable statement + tests) and adds two nullable
provenance columns to ``assignmenttask``. Assignments keep a snapshot in
``assignmenttask.contents``; the columns only record which library row (and
version checksum) a task came from.

Revision ID: a9b8c7d6e5f4
Revises: e8f9a0b1c2d3
Create Date: 2026-10-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel  # noqa: F401
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "problem" not in tables:
        op.create_table(
            "problem",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("problem_uuid", sa.String(), nullable=False),
            sa.Column("org_id", sa.Integer(), nullable=False),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("statement_md", sa.Text(), nullable=False),
            sa.Column("input_format", sa.Text(), nullable=False),
            sa.Column("output_format", sa.Text(), nullable=False),
            sa.Column("constraints", sa.Text(), nullable=False),
            sa.Column("difficulty", sa.String(length=32), nullable=True),
            sa.Column("topics", sa.JSON(), nullable=False),
            sa.Column("languages", sa.JSON(), nullable=False),
            sa.Column("tests", sa.JSON(), nullable=False),
            sa.Column("time_limit_ms", sa.Integer(), nullable=True),
            sa.Column("memory_limit_kb", sa.Integer(), nullable=True),
            sa.Column("source_name", sa.String(length=200), nullable=True),
            sa.Column("source_url", sa.String(length=2000), nullable=True),
            sa.Column("source_id", sa.String(length=200), nullable=True),
            sa.Column("checksum", sa.String(length=64), nullable=False),
            sa.Column("is_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("creation_date", sa.String(), nullable=False),
            sa.Column("update_date", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "org_id", "source_name", "source_id", name="uq_problem_org_source"
            ),
        )
        op.create_index("ix_problem_problem_uuid", "problem", ["problem_uuid"], unique=False)
        op.create_index("ix_problem_org", "problem", ["org_id"], unique=False)
        op.create_index("ix_problem_checksum", "problem", ["checksum"], unique=False)

    if "assignmenttask" in tables:
        columns = {col["name"] for col in inspector.get_columns("assignmenttask")}
        if "problem_uuid" not in columns:
            op.add_column(
                "assignmenttask", sa.Column("problem_uuid", sa.String(length=255), nullable=True)
            )
            op.create_index(
                "ix_assignmenttask_problem_uuid",
                "assignmenttask",
                ["problem_uuid"],
                unique=False,
            )
        if "problem_checksum" not in columns:
            op.add_column(
                "assignmenttask",
                sa.Column("problem_checksum", sa.String(length=64), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "assignmenttask" in tables:
        columns = {col["name"] for col in inspector.get_columns("assignmenttask")}
        if "problem_checksum" in columns:
            op.drop_column("assignmenttask", "problem_checksum")
        if "problem_uuid" in columns:
            try:
                op.drop_index("ix_assignmenttask_problem_uuid", table_name="assignmenttask")
            except Exception:  # pragma: no cover - index may be absent
                pass
            op.drop_column("assignmenttask", "problem_uuid")

    if "problem" in tables:
        try:
            op.drop_index("ix_problem_checksum", table_name="problem")
            op.drop_index("ix_problem_org", table_name="problem")
            op.drop_index("ix_problem_problem_uuid", table_name="problem")
        except Exception:  # pragma: no cover
            pass
        op.drop_table("problem")
