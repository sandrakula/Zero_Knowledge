"""Progress-tracking tables mirroring the «Хроники Градиента» spreadsheet.

- Attendance: one row per (student, day) they were present.
- CategoryDeadline: the deadline a teacher sets per Informatics category.
- CategoryCompletion: the teacher's manual validation of a category for a
  student (validation status, who checked it, and the «досдача» retake flag).
"""

from __future__ import annotations

from typing import Optional

from sqlmodel import Field, SQLModel


class Attendance(SQLModel, table=True):
    __tablename__ = "attendance"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    attendance_date: str = Field(index=True)  # YYYY-MM-DD
    created_at: str = Field(default="")


class CategoryDeadline(SQLModel, table=True):
    __tablename__ = "category_deadline"

    category: str = Field(primary_key=True, max_length=64)
    deadline: Optional[str] = Field(default=None)  # YYYY-MM-DD or None
    note: str = Field(default="")
    updated_at: str = Field(default="")


class CategoryCompletion(SQLModel, table=True):
    """Teacher's manual validation of a category for a student."""

    __tablename__ = "category_completion"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    category: str = Field(max_length=64, index=True)
    validation_status: Optional[str] = Field(default=None)  # "OK" / None
    checked_by: Optional[str] = Field(default=None)
    dosdacha: bool = Field(default=False)  # retake required later
    created_at: str = Field(default="")
    updated_at: str = Field(default="")
