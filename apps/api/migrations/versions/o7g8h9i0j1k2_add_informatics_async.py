"""Informatics server-side submissions, history and Chronicles outbox

Revision ID: o7g8h9i0j1k2
Revises: n5f6g7h8i9j0
Create Date: 2026-11-24

The userscript tables stay in place. This revision adds the columns and tables
needed by the server-side path: the encrypted Informatics password, append-only
attempts, verdict/status metadata, an event log, the problem catalog cache, and
the Chronicles outbox.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o7g8h9i0j1k2"
down_revision: Union[str, None] = "n5f6g7h8i9j0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_column(table: str, column: sa.Column) -> None:
    op.add_column(table, column)


def upgrade() -> None:
    # ── informatics_account: server-side credentials + status ────────────────
    _add_column(
        "informatics_account",
        sa.Column("email", sa.String(length=320), nullable=False, server_default=""),
    )
    _add_column(
        "informatics_account",
        sa.Column("password_encrypted", sa.Text(), nullable=False, server_default=""),
    )
    _add_column(
        "informatics_account",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="UNVERIFIED",
        ),
    )
    _add_column(
        "informatics_account",
        sa.Column("last_verified_at", sa.String(), nullable=False, server_default=""),
    )
    _add_column(
        "informatics_account",
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_informatics_account_informatics_user",
        "informatics_account",
        ["informatics_user_id"],
        unique=False,
    )

    # ── informatics_submission: append-only attempt metadata ────────────────
    submission_columns = [
        sa.Column("submission_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("client_request_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("assignment_task_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("assignment_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("activity_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("language_our_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("language_informatics_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_sha256", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("source_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempt_no", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="QUEUED"),
        sa.Column("verdict", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("tests_passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tests_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("time_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("memory_kb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("compile_output", sa.Text(), nullable=False, server_default=""),
        sa.Column("stderr", sa.Text(), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("raw_verdict", sa.JSON(), nullable=True),
        sa.Column("last_http_status", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_poll_at", sa.String(), nullable=False, server_default=""),
        sa.Column("lease_owner", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("lease_expires_at", sa.String(), nullable=False, server_default=""),
        sa.Column("credited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("credited_at", sa.String(), nullable=False, server_default=""),
        sa.Column("chronicles_logged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("chronicles_logged_at", sa.String(), nullable=False, server_default=""),
        sa.Column("finished_at", sa.String(), nullable=False, server_default=""),
    ]
    for column in submission_columns:
        op.add_column("informatics_submission", column)

    # Existing userscript rows are already final verdicts. New rows start QUEUED.
    op.execute(
        "UPDATE informatics_submission SET submission_uuid = 'legacy_' || CAST(id AS TEXT) "
        "WHERE submission_uuid = ''"
    )
    op.execute("UPDATE informatics_submission SET status = 'FINAL'")
    op.execute(
        "UPDATE informatics_submission SET verdict = 'ACCEPTED' "
        "WHERE solved = TRUE AND verdict = ''"
    )
    op.execute(
        "UPDATE informatics_submission SET verdict = 'UNKNOWN' "
        "WHERE solved = FALSE AND verdict = ''"
    )
    op.execute("UPDATE informatics_submission SET attempt_no = 1 WHERE attempt_no = 0")

    op.alter_column(
        "informatics_submission",
        "run_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.alter_column(
        "informatics_submission",
        "ejudge_status",
        existing_type=sa.Integer(),
        nullable=True,
    )

    op.create_index(
        "ix_informatics_submission_uuid",
        "informatics_submission",
        ["submission_uuid"],
        unique=True,
        postgresql_where=sa.text("submission_uuid <> ''"),
    )
    op.create_index(
        "uq_informatics_user_client_request",
        "informatics_submission",
        ["user_id", "client_request_id"],
        unique=True,
        postgresql_where=sa.text("client_request_id <> ''"),
    )
    op.create_index(
        "ix_informatics_submission_status_poll",
        "informatics_submission",
        ["status", "next_poll_at"],
        unique=False,
    )
    op.create_index(
        "ix_informatics_submission_task",
        "informatics_submission",
        ["assignment_task_uuid"],
        unique=False,
    )
    op.create_index(
        "ix_informatics_submission_run",
        "informatics_submission",
        ["run_id"],
        unique=False,
    )

    # ── event log ───────────────────────────────────────────────────────────
    op.create_table(
        "informatics_submission_event",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submission_id", sa.Integer(), nullable=False),
        sa.Column("at", sa.String(), nullable=False, server_default=""),
        sa.Column("phase", sa.String(length=48), nullable=False, server_default=""),
        sa.Column("level", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("http_status", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["submission_id"], ["informatics_submission.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_informatics_event_submission",
        "informatics_submission_event",
        ["submission_id"],
        unique=False,
    )
    op.create_index(
        "ix_informatics_event_at",
        "informatics_submission_event",
        ["at"],
        unique=False,
    )

    # ── problem catalog cache ───────────────────────────────────────────────
    op.create_table(
        "informatics_problem",
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("statement_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("languages", sa.JSON(), nullable=True),
        sa.Column("time_limit_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("memory_limit_kb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw", sa.JSON(), nullable=True),
        sa.Column("fetched_at", sa.String(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("problem_id"),
    )

    # ── problem → TASK_XXXX / Chronicles category ───────────────────────────
    op.create_table(
        "informatics_task_map",
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("problem_id"),
    )

    # ── Chronicles outbox ───────────────────────────────────────────────────
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


def downgrade() -> None:
    op.drop_index(
        "ix_informatics_chronicles_status",
        table_name="informatics_chronicles_outbox",
    )
    op.drop_table("informatics_chronicles_outbox")
    op.drop_table("informatics_task_map")
    op.drop_table("informatics_problem")
    op.drop_index(
        "ix_informatics_event_at", table_name="informatics_submission_event"
    )
    op.drop_index(
        "ix_informatics_event_submission", table_name="informatics_submission_event"
    )
    op.drop_table("informatics_submission_event")

    op.drop_index("ix_informatics_submission_run", table_name="informatics_submission")
    op.drop_index("ix_informatics_submission_task", table_name="informatics_submission")
    op.drop_index(
        "ix_informatics_submission_status_poll", table_name="informatics_submission"
    )
    op.drop_index(
        "uq_informatics_user_client_request", table_name="informatics_submission"
    )
    op.drop_index(
        "ix_informatics_submission_uuid", table_name="informatics_submission"
    )

    op.alter_column(
        "informatics_submission",
        "ejudge_status",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.alter_column(
        "informatics_submission",
        "run_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    for name in (
        "finished_at",
        "chronicles_logged_at",
        "chronicles_logged",
        "credited_at",
        "credited",
        "lease_expires_at",
        "lease_owner",
        "next_poll_at",
        "attempt_count",
        "last_error",
        "last_http_status",
        "raw_verdict",
        "message",
        "stderr",
        "compile_output",
        "memory_kb",
        "time_ms",
        "max_score",
        "tests_total",
        "tests_passed",
        "verdict",
        "status",
        "attempt_no",
        "source_code",
        "source_sha256",
        "language_informatics_id",
        "language_our_id",
        "org_id",
        "activity_uuid",
        "assignment_uuid",
        "assignment_task_uuid",
        "client_request_id",
        "submission_uuid",
    ):
        op.drop_column("informatics_submission", name)

    op.drop_index(
        "ix_informatics_account_informatics_user", table_name="informatics_account"
    )
    for name in (
        "last_error",
        "last_verified_at",
        "status",
        "password_encrypted",
        "email",
    ):
        op.drop_column("informatics_account", name)
