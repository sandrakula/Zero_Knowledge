"""Record of a student's code submission to the Informatics judge."""

from __future__ import annotations

from typing import Optional

from sqlmodel import Field, SQLModel


class InformaticsSubmission(SQLModel, table=True):
    """One submission (and its latest verdict) per student + Informatics problem.

    ``problem_id`` is the Informatics problem id (matches ``problem.source_id``).
    The row is upserted on each submit so it always reflects the latest verdict,
    which is what the progress statistics aggregate.
    """

    __tablename__ = "informatics_submission"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    problem_id: int = Field(index=True)
    category: str = Field(default="", max_length=64)
    informatics_run_id: int = Field(default=0)
    status: int = Field(default=0)
    tests: int = Field(default=0)
    score: int = Field(default=0)
    solved: bool = Field(default=False)
    created_at: str = Field(default="")
    updated_at: str = Field(default="")
