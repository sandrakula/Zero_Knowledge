#!/usr/bin/env python3
"""Import the «Хроники» CSV into the Informatics task mapping.

Builds the ``informatics_task_map`` table (problem_id -> task_id + category) and
merges ``informatics_problem_id`` into every matching assignment task's
``contents`` JSON. Run from ``apps/api``:

    python scripts/import_informatics_mapping.py --dry-run
    python scripts/import_informatics_mapping.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.informatics.task_mapping import sync_mapping

DEFAULT_CSV = r"C:\Users\Artem\Downloads\Хроники Градиента 2025-26 - TASK_SUBMISSIONS.csv"


def _async_dsn(url: str) -> str:
    """Normalise a sync/psycopg2 Postgres DSN to the asyncpg driver."""
    if url.startswith("postgresql+psycopg2://"):
        return url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


async def _run(csv_path: str, dry_run: bool) -> dict:
    load_dotenv()
    dsn = _async_dsn(os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING", ""))
    if not dsn:
        raise RuntimeError("LEARNHOUSE_SQL_CONNECTION_STRING is not set")

    engine = create_async_engine(dsn)
    try:
        if not dry_run:
            async with engine.begin() as conn:
                await conn.run_sync(SQLModel.metadata.create_all)
        async with AsyncSession(engine) as session:
            return await sync_mapping(csv_path, session, dry_run=dry_run)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import the «Хроники» CSV into the Informatics task mapping."
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help="Path to the TASK_SUBMISSIONS CSV (default: the Downloads export).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and print the report without writing to the database.",
    )
    args = parser.parse_args()

    report = asyncio.run(_run(args.csv, args.dry_run))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
