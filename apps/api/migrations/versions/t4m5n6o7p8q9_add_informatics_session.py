"""Store an encrypted MoodleSession for Google-only Informatics accounts

Revision ID: t4m5n6o7p8q9
Revises: r1j2k3l4m5n6
Create Date: 2026-11-25

Informatics accounts created through Google have no local password. The
profile accepts the learner's MoodleSession cookie once, validates it, and
stores it encrypted so the worker can submit code and poll verdicts without a
password.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "t4m5n6o7p8q9"
down_revision: Union[str, None] = "r1j2k3l4m5n6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "informatics_account",
        sa.Column("session_encrypted", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("informatics_account", "session_encrypted")
