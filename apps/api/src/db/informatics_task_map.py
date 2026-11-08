"""Persistent mapping from an Informatics problem id to a «Хроники» task id.

The ``problem`` library table is empty for the Informatics curriculum, so the
Google-Form logging hook cannot read ``Problem.task_id`` / ``Problem.category``
anymore. This table is the standalone source of truth: it is populated by the
import CLI (``scripts/import_informatics_mapping.py``) from the «Хроники»
TASK_SUBMISSIONS CSV and read by ``_record_submission`` on every verdict.
"""

from __future__ import annotations

from sqlmodel import Field, SQLModel


class InformaticsTaskMap(SQLModel, table=True):
    """``problem_id`` (informatics.msk.ru) -> ``task_id`` + ``category``.

    ``problem_id`` is the Informatics judge's problem id (e.g. ``2936``). It is
    the primary key: each problem maps to at most one «Хроники» ``TASK_XXXX``
    and one ``CAT_xxx_INF_xxx`` topic code.
    """

    __tablename__ = "informatics_task_map"

    problem_id: int = Field(primary_key=True)
    task_id: str = Field(default="", max_length=32)
    category: str = Field(default="", max_length=64)
    title: str = Field(default="", max_length=500)
