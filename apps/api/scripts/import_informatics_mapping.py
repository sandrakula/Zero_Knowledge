#!/usr/bin/env python3
"""Import optional problem metadata for LMS statistics.

The LMS computes statistics from ``informatics_submission`` directly. This CSV
only adds a human category and title to the problem catalog:

    problem_id,category,title
    2936,Алгоритмы,Гипотенуза

Usage:
    uv run python scripts/import_informatics_mapping.py mapping.csv
"""

from __future__ import annotations

import argparse
import asyncio
import csv
from datetime import datetime
from pathlib import Path

from src.core.events.database import _async_session_factory
from src.db.informatics import InformaticsTaskMap


async def import_mapping(path: Path) -> int:
    count = 0
    async with _async_session_factory() as db:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                raw = row.get("problem_id") or row.get("problem") or ""
                try:
                    problem_id = int(str(raw).strip())
                except ValueError:
                    continue
                if problem_id <= 0:
                    continue
                item = await db.get(InformaticsTaskMap, problem_id)
                if item is None:
                    item = InformaticsTaskMap(problem_id=problem_id)
                item.category = (row.get("category") or "").strip()[:200]
                item.title = (row.get("title") or "").strip()[:500]
                item.source = "csv"
                item.updated_at = datetime.now().isoformat()
                db.add(item)
                count += 1
        await db.commit()
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    count = asyncio.run(import_mapping(args.csv_path))
    print(f"Imported {count} Informatics task mappings from {args.csv_path}")


if __name__ == "__main__":
    main()
