"""Enforce uniqueness for accounts and organization memberships

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-11-17 00:00:00.000000

E-mail uniqueness was only enforced in Python: two concurrent registrations
could both pass the "does this address exist" check and then insert. Usernames
had the same race, and nothing stopped the same user from being added to one
organization twice. These unique indexes make the database the authority.

Addresses are canonicalised to lower case first. A deployment that already
holds case-insensitive duplicates aborts with a clear error instead of
silently deleting one of the accounts.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _fail_on_duplicates(bind, sql: str, what: str) -> None:
    rows = bind.execute(sa.text(sql)).fetchall()
    if rows:
        sample = ", ".join(str(row[0]) for row in rows[:5])
        raise RuntimeError(
            f"Cannot add a unique index on {what}: duplicate rows exist ({sample}). "
            "Merge or remove them, then run the migration again."
        )


def upgrade() -> None:
    bind = op.get_bind()

    # Login lookups already compare lower-case addresses, so store them that
    # way before the functional index is built.
    op.execute('UPDATE "user" SET email = lower(email) WHERE email <> lower(email)')

    _fail_on_duplicates(
        bind,
        'SELECT lower(email) FROM "user" GROUP BY 1 HAVING count(*) > 1',
        "user.email",
    )
    _fail_on_duplicates(
        bind,
        'SELECT username FROM "user" GROUP BY 1 HAVING count(*) > 1',
        "user.username",
    )
    _fail_on_duplicates(
        bind,
        "SELECT user_id || '/' || org_id FROM userorganization "
        "GROUP BY user_id, org_id HAVING count(*) > 1",
        "userorganization(user_id, org_id)",
    )

    op.create_index(
        "uq_user_email_lower",
        "user",
        [sa.text("lower(email)")],
        unique=True,
    )
    op.create_index("uq_user_username", "user", ["username"], unique=True)

    # The old non-unique pair index is fully covered by the unique one.
    op.drop_index("ix_userorg_user_org", table_name="userorganization")
    op.create_index(
        "uq_userorganization_user_org",
        "userorganization",
        ["user_id", "org_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_userorganization_user_org", table_name="userorganization")
    op.create_index(
        "ix_userorg_user_org",
        "userorganization",
        ["user_id", "org_id"],
    )
    op.drop_index("uq_user_username", table_name="user")
    op.drop_index("uq_user_email_lower", table_name="user")
