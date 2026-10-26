"""Per-user Informatics account binding."""

from __future__ import annotations

from typing import Optional

from sqlmodel import Field, SQLModel


class InformaticsLink(SQLModel, table=True):
    """A student's bound Informatics session, used to submit code on their behalf.

    ``session_cookie`` is stored encrypted (Fernet, key derived from the JWT
    secret). It is never returned to clients; the API exposes only the binding
    status + Informatics identity.
    """

    __tablename__ = "informatics_link"

    user_id: int = Field(primary_key=True, foreign_key="user.id", ondelete="CASCADE")
    session_cookie: str = Field(default="")
    informatics_user_id: int = Field(default=0)
    informatics_username: str = Field(default="")
    last_error: Optional[str] = Field(default=None)
    created_at: str = Field(default="")
    updated_at: str = Field(default="")
