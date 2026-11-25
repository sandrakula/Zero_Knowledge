"""Defense and contest records for the stats/КПД engine

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-11-22 00:00:00.000000

Two small tables:
- defense_record: an instructor-confirmed defense of a task (the verified
  signal of "solved and can explain it").
- contest_entry: a student's self-reported contest participation. Nobody
  verifies it, so the score gives it a small weight only.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "defense_record",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=True),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("confirmed_by", sa.Integer(), nullable=True),
        sa.Column("confirmed_at", sa.String(), nullable=False, server_default=""),
        sa.Column("note", sa.String(), nullable=False, server_default=""),
        sa.Column("creation_date", sa.String(), nullable=False, server_default=""),
        sa.Column("update_date", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["course.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["confirmed_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_defense_record_org_user", "defense_record", ["org_id", "user_id"]
    )
    op.create_index(
        "ix_defense_record_course_user", "defense_record", ["course_id", "user_id"]
    )

    op.create_table(
        "contest_entry",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("happened_on", sa.String(), nullable=False, server_default=""),
        sa.Column("creation_date", sa.String(), nullable=False, server_default=""),
        sa.Column("update_date", sa.String(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_contest_entry_org_user", "contest_entry", ["org_id", "user_id"]
    )
    op.create_index(
        "ix_contest_entry_org_date", "contest_entry", ["org_id", "happened_on"]
    )


def downgrade() -> None:
    op.drop_index("ix_contest_entry_org_date", table_name="contest_entry")
    op.drop_index("ix_contest_entry_org_user", table_name="contest_entry")
    op.drop_table("contest_entry")
    op.drop_index("ix_defense_record_course_user", table_name="defense_record")
    op.drop_index("ix_defense_record_org_user", table_name="defense_record")
    op.drop_table("defense_record")
