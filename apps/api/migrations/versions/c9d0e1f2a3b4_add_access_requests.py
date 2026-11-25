"""Add access-request gating and retire the Maintainer role

Revision ID: c9d0e1f2a3b4
Revises: f5a8b3d0c2e4
Create Date: 2026-11-16 00:00:00.000000

Accounts now require an organization administrator's approval before a
session can be minted. Existing rows are backfilled as ``approved`` so no
current deployment is locked out by the migration.

The retired Maintainer role (id 2) is deleted only when no membership still
references it; a deployment that still uses it keeps the row and can migrate
those members manually.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "f5a8b3d0c2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "access_status",
            sa.String(length=16),
            nullable=False,
            server_default="approved",
        ),
    )
    op.add_column("user", sa.Column("access_requested_at", sa.String(length=64), nullable=True))
    op.add_column("user", sa.Column("access_decided_at", sa.String(length=64), nullable=True))
    op.add_column("user", sa.Column("access_decided_by", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_user_access_decided_by",
        "user",
        "user",
        ["access_decided_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_user_access_status", "user", ["access_status"])

    op.execute(
        """
        DELETE FROM role
        WHERE id = 2
          AND role_uuid = 'role_global_maintainer'
          AND NOT EXISTS (
              SELECT 1 FROM userorganization WHERE role_id = 2
          )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_user_access_status", table_name="user")
    op.drop_constraint("fk_user_access_decided_by", "user", type_="foreignkey")
    op.drop_column("user", "access_decided_by")
    op.drop_column("user", "access_decided_at")
    op.drop_column("user", "access_requested_at")
    op.drop_column("user", "access_status")

