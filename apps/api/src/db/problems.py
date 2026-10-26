"""Problem library models.

A problem is a reusable, org-scoped programming exercise (statement + tests).
Assignments never point at the live problem row: adding a problem to an
assignment copies a snapshot into ``AssignmentTask.contents`` so editing the
library cannot rewrite the work a cohort already submitted against.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Column, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class ProblemBase(SQLModel):
    title: str = Field(max_length=500)
    # Markdown only. HTML is rejected by the importer and by the create/update
    # services, because the statement is rendered as Markdown by the web app.
    statement_md: str = Field(default="", sa_column=Column(Text))
    input_format: str = Field(default="", sa_column=Column(Text))
    output_format: str = Field(default="", sa_column=Column(Text))
    constraints: str = Field(default="", sa_column=Column(Text))
    difficulty: Optional[str] = Field(default=None, max_length=32)
    topics: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    # Judge0 language ids, same list the code editor uses.
    languages: List[int] = Field(default_factory=lambda: [71, 54], sa_column=Column(JSON))
    # [{id, label, stdin, expected_stdout, hidden, weight}]
    tests: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    time_limit_ms: Optional[int] = None
    memory_limit_kb: Optional[int] = None
    source_name: Optional[str] = Field(default=None, max_length=200)
    source_url: Optional[str] = Field(default=None, max_length=2000)
    source_id: Optional[str] = Field(default=None, max_length=200)
    # Informatics topic category (CAT_001_INF_IO …), for progress statistics.
    category: Optional[str] = Field(default=None, max_length=64)
    checksum: str = Field(default="", max_length=64)
    # Set to True by the manual update path. The importer never overwrites an
    # edited problem; it reports a conflict instead.
    is_edited: bool = Field(default=False)
    archived: bool = Field(default=False)


class Problem(ProblemBase, table=True):
    __table_args__ = (
        Index("ix_problem_org", "org_id"),
        Index("ix_problem_checksum", "checksum"),
        UniqueConstraint(
            "org_id", "source_name", "source_id",
            name="uq_problem_org_source",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    problem_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    created_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL")),
    )
    creation_date: str = ""
    update_date: str = ""


class ProblemCreate(SQLModel):
    title: str = Field(max_length=500)
    statement_md: str = ""
    input_format: str = ""
    output_format: str = ""
    constraints: str = ""
    difficulty: Optional[str] = None
    topics: List[str] = Field(default_factory=list)
    languages: List[int] = Field(default_factory=lambda: [71, 54])
    tests: List[Dict[str, Any]] = Field(default_factory=list)
    time_limit_ms: Optional[int] = None
    memory_limit_kb: Optional[int] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    source_id: Optional[str] = None


class ProblemUpdate(SQLModel):
    title: Optional[str] = None
    statement_md: Optional[str] = None
    input_format: Optional[str] = None
    output_format: Optional[str] = None
    constraints: Optional[str] = None
    difficulty: Optional[str] = None
    topics: Optional[List[str]] = None
    languages: Optional[List[int]] = None
    tests: Optional[List[Dict[str, Any]]] = None
    time_limit_ms: Optional[int] = None
    memory_limit_kb: Optional[int] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    source_id: Optional[str] = None
    archived: Optional[bool] = None


class ProblemRead(ProblemBase):
    id: int
    problem_uuid: str
    org_id: int
    created_by_id: Optional[int] = None
    creation_date: str
    update_date: str


class ProblemListResponse(SQLModel):
    problems: List[ProblemRead]
    total: int
    page: int
    limit: int


class ProblemImportResultItem(SQLModel):
    external_id: Optional[str] = None
    title: Optional[str] = None
    status: str  # created | updated | skipped | conflict | failed
    problem_uuid: Optional[str] = None
    error: Optional[str] = None


class ProblemImportResponse(SQLModel):
    dry_run: bool
    created: int
    updated: int
    skipped: int
    conflicts: int
    failed: int
    results: List[ProblemImportResultItem]
