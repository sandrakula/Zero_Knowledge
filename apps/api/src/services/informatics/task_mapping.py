"""Build and persist the Informatics problem -> «Хроники» task mapping.

The «Хроники» CSV (TASK_SUBMISSIONS) names every task with a letter prefix
(``A. Гипотенуза``, ``AA. ...``) and a ``TASK_XXXX`` id plus a
``CAT_xxx_INF_xxx`` category. The Informatics course names its assignment
activities ``№<problem_id>. <title>``. Matching is done on the bare title by
stripping the letter prefix from ``TASK_NAME`` and the ``№<id>.`` prefix from the
activity name.

A bare title that maps to more than one distinct ``TASK_ID`` is ambiguous and is
skipped (the same title is reused across category blocks in the spreadsheet).
"""

from __future__ import annotations

import csv
import re

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import AssignmentTask
from src.db.courses.courses import Course
from src.db.informatics_task_map import InformaticsTaskMap

DEFAULT_COURSE_UUID = "course_153ebd33-e07a-48c1-83ea-eda9378a0119"

# "A. Гипотенуза" -> "Гипотенуза". Single letter only: the spreadsheet reuses
# the letter A..Z and then AA, AB, ... per category block; the multi-letter
# prefixes are intentionally NOT stripped (those titles simply will not match).
_TASK_NAME_PREFIX_RE = re.compile(r"^[A-Za-zА-Яа-я]\.\s*")

# "№2936. Гипотенуза" -> ("2936", "Гипотенуза")
_ACTIVITY_NAME_RE = re.compile(r"^№(\d+)\.\s*")


def parse_csv_mapping(csv_path: str) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Parse the «Хроники» CSV into ``{bare_title: (task_id, category)}``.

    Returns the mapping and the list of ambiguous bare titles (titles that map
    to more than one distinct ``TASK_ID``). Rows whose ``TASK_ID`` is empty or
    ``#N/A`` are skipped; ambiguous titles are excluded from the mapping.
    """
    task_ids_by_title: dict[str, set[str]] = {}
    category_by_title: dict[str, str] = {}

    with open(csv_path, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            task_id = (row.get("TASK_ID") or "").strip()
            if not task_id or task_id == "#N/A":
                continue
            bare_title = _TASK_NAME_PREFIX_RE.sub("", (row.get("TASK_NAME") or "")).strip()
            if not bare_title:
                continue
            task_ids_by_title.setdefault(bare_title, set()).add(task_id)
            category_by_title.setdefault(bare_title, (row.get("TASK_CATEGORY") or "").strip())

    ambiguous: list[str] = []
    mapping: dict[str, tuple[str, str]] = {}
    for bare_title, task_ids in task_ids_by_title.items():
        if len(task_ids) == 1:
            mapping[bare_title] = (next(iter(task_ids)), category_by_title[bare_title])
        else:
            ambiguous.append(bare_title)
    return mapping, ambiguous


async def sync_mapping(
    csv_path: str,
    db_session: AsyncSession,
    course_uuid: str = DEFAULT_COURSE_UUID,
    *,
    dry_run: bool = False,
) -> dict:
    """Sync the CSV mapping into ``informatics_task_map`` and the course tasks.

    For every assignment task in the course whose activity name parses to a
    ``№<problem_id>. <title>`` and whose bare title matches the CSV map, upserts
    an ``InformaticsTaskMap`` row and merges ``informatics_problem_id`` into the
    task's ``contents`` JSON (without replacing the other keys). Commits unless
    ``dry_run`` is set, in which case it only computes and returns the report.
    """
    mapping, ambiguous_titles = parse_csv_mapping(csv_path)
    ambiguous: set[str] = set(ambiguous_titles)

    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).scalars().first()
    if course is None:
        raise ValueError(f"Course not found: {course_uuid}")

    rows = (
        await db_session.execute(
            select(AssignmentTask, Activity.name)
            .join(Activity, AssignmentTask.activity_id == Activity.id)
            .where(AssignmentTask.course_id == course.id)
        )
    ).all()

    matched = 0
    ambiguous_count = 0
    unmatched_titles: list[str] = []
    updates: list[tuple[AssignmentTask, int, str, str, str]] = []

    for task, activity_name in rows:
        match = _ACTIVITY_NAME_RE.match(activity_name or "")
        if match is None:
            unmatched_titles.append(activity_name or "")
            continue
        problem_id = int(match.group(1))
        bare_title = (activity_name or "")[match.end():].strip()

        if bare_title in mapping:
            task_id, category = mapping[bare_title]
            updates.append((task, problem_id, task_id, category, bare_title))
            matched += 1
        elif bare_title in ambiguous:
            ambiguous_count += 1
        else:
            unmatched_titles.append(bare_title)

    if not dry_run:
        for task, problem_id, task_id, category, title in updates:
            existing = (
                await db_session.execute(
                    select(InformaticsTaskMap).where(
                        InformaticsTaskMap.problem_id == problem_id
                    )
                )
            ).scalars().first()
            if existing is None:
                db_session.add(
                    InformaticsTaskMap(
                        problem_id=problem_id,
                        task_id=task_id,
                        category=category,
                        title=title,
                    )
                )
            else:
                existing.task_id = task_id
                existing.category = category
                existing.title = title

            contents = dict(task.contents or {})
            contents["informatics_problem_id"] = problem_id
            task.contents = contents

        await db_session.commit()

    return {
        "matched": matched,
        "ambiguous": ambiguous_count,
        "unmatched": len(unmatched_titles),
        "unmatched_titles": unmatched_titles,
        "assignments_updated": matched if not dry_run else 0,
    }
