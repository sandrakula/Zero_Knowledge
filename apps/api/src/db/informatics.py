"""Informatics account, submissions, events and problem cache.

Two integration paths share these tables:

* the browser userscript posts verdicts to ``/informatics/ingest`` (no password,
  no cookie), and
* the official server-side path logs into informatics.msk.ru with an encrypted
  password, submits code through a background worker and polls ``filter-runs``.

``informatics_submission`` is append-only: one row per attempt. The userscript
path still uses the legacy columns (``tests``/``score``/``solved``); the server
path fills the richer fields.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel


class InformaticsLinkStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INVALID = "INVALID"
    UNVERIFIED = "UNVERIFIED"


class SubmissionStatus(str, Enum):
    QUEUED = "QUEUED"
    SUBMITTING = "SUBMITTING"
    RUNNING = "RUNNING"
    FINAL = "FINAL"
    RETRY_WAIT = "RETRY_WAIT"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class Verdict(str, Enum):
    ACCEPTED = "ACCEPTED"
    WRONG_ANSWER = "WRONG_ANSWER"
    COMPILATION_ERROR = "COMPILATION_ERROR"
    RUNTIME_ERROR = "RUNTIME_ERROR"
    TIME_LIMIT = "TIME_LIMIT"
    MEMORY_LIMIT = "MEMORY_LIMIT"
    PRESENTATION_ERROR = "PRESENTATION_ERROR"
    PARTIAL = "PARTIAL"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    UNKNOWN = "UNKNOWN"


ACTIVE_SUBMISSION_STATUSES = (
    SubmissionStatus.QUEUED.value,
    SubmissionStatus.SUBMITTING.value,
    SubmissionStatus.RUNNING.value,
)


class InformaticsAccount(SQLModel, table=True):
    """One LMS user's informatics connection.

    ``ingest_token_hash`` is a SHA-256 of the personal token used by the
    userscript. ``password_encrypted`` is only written by the server-side path
    and is never returned by the API.
    """

    __tablename__ = "informatics_account"
    __table_args__ = (
        Index("ix_informatics_account_token", "ingest_token_hash"),
        Index("ix_informatics_account_informatics_user", "informatics_user_id"),
    )

    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
        )
    )
    username: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    password_encrypted: str = Field(
        default="", sa_column=Column(Text, nullable=False, default="")
    )
    # Google-only Informatics accounts have no local password. For them we
    # store the MoodleSession cookie (encrypted) instead. Exactly one of the two
    # is usually present; both are cleared on disconnect.
    session_encrypted: str = Field(
        default="", sa_column=Column(Text, nullable=False, default="")
    )
    informatics_user_id: int = Field(default=0)
    status: str = Field(default=InformaticsLinkStatus.UNVERIFIED.value, max_length=32)
    last_verified_at: str = Field(default="")
    last_error: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    ingest_token_hash: str = Field(default="", max_length=64)
    token_created_at: str = Field(default="")
    last_seen_at: str = Field(default="")
    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class InformaticsSubmission(SQLModel, table=True):
    """One submission attempt. Append-only."""

    __tablename__ = "informatics_submission"
    __table_args__ = (
        UniqueConstraint("user_id", "run_id", name="uq_informatics_user_run"),
        Index(
            "uq_informatics_user_client_request",
            "user_id",
            "client_request_id",
            unique=True,
            postgresql_where=text("client_request_id <> ''"),
            sqlite_where=text("client_request_id <> ''"),
        ),
        Index(
            "ix_informatics_submission_uuid",
            "submission_uuid",
            unique=True,
            postgresql_where=text("submission_uuid <> ''"),
            sqlite_where=text("submission_uuid <> ''"),
        ),
        Index("ix_informatics_submission_user", "user_id"),
        Index("ix_informatics_submission_problem", "problem_id"),
        Index("ix_informatics_user_problem", "user_id", "problem_id"),
        Index("ix_informatics_submission_status_poll", "status", "next_poll_at"),
        Index("ix_informatics_submission_task", "assignment_task_uuid"),
        Index("ix_informatics_submission_run", "run_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    submission_uuid: str = Field(default="", max_length=64)
    client_request_id: str = Field(default="", max_length=64)
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    problem_id: int = Field()
    assignment_task_uuid: str = Field(default="", max_length=64)
    assignment_uuid: str = Field(default="", max_length=64)
    activity_uuid: str = Field(default="", max_length=64)
    org_id: Optional[int] = Field(default=None)
    language_our_id: int = Field(default=0)
    language_informatics_id: int = Field(default=0)
    source_sha256: str = Field(default="", max_length=64)
    source_code: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    attempt_no: int = Field(default=1)
    status: str = Field(default=SubmissionStatus.QUEUED.value, max_length=32)
    verdict: str = Field(default="", max_length=32)
    run_id: Optional[int] = Field(default=None)
    ejudge_status: Optional[int] = Field(default=None)
    tests: int = Field(default=0)
    tests_passed: int = Field(default=0)
    tests_total: int = Field(default=0)
    score: int = Field(default=0)
    max_score: int = Field(default=0)
    time_ms: int = Field(default=0)
    memory_kb: int = Field(default=0)
    compile_output: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    stderr: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    message: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    raw_verdict: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    last_http_status: int = Field(default=0)
    last_error: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    attempt_count: int = Field(default=0)
    next_poll_at: str = Field(default="")
    lease_owner: str = Field(default="", max_length=128)
    lease_expires_at: str = Field(default="")
    credited: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    credited_at: str = Field(default="")
    solved: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    source: str = Field(default="server", max_length=32)
    created_at: str = Field(default="")
    updated_at: str = Field(default="")
    finished_at: str = Field(default="")


class InformaticsSubmissionEvent(SQLModel, table=True):
    __tablename__ = "informatics_submission_event"
    __table_args__ = (
        Index("ix_informatics_event_submission", "submission_id"),
        Index("ix_informatics_event_at", "at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("informatics_submission.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    at: str = Field(default="")
    phase: str = Field(default="", max_length=48)
    level: str = Field(default="info", max_length=16)
    message: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    http_status: int = Field(default=0)
    payload: Optional[dict] = Field(default=None, sa_column=Column(JSON))


class InformaticsProblem(SQLModel, table=True):
    __tablename__ = "informatics_problem"

    problem_id: int = Field(primary_key=True)
    title: str = Field(default="", max_length=500)
    statement_md: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    languages: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    time_limit_ms: int = Field(default=0)
    memory_limit_kb: int = Field(default=0)
    raw: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    fetched_at: str = Field(default="")


class InformaticsTaskMap(SQLModel, table=True):
    """Optional problem metadata used by LMS statistics (category/title)."""

    __tablename__ = "informatics_task_map"

    problem_id: int = Field(primary_key=True)
    category: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=500)
    source: str = Field(default="", max_length=32)
    updated_at: str = Field(default="")


class InformaticsSubmissionRead(SQLModel):
    id: int
    submission_uuid: str
    problem_id: int
    run_id: Optional[int]
    ejudge_status: Optional[int]
    tests: int
    score: int
    solved: bool
    source: str
    created_at: str
    updated_at: str
