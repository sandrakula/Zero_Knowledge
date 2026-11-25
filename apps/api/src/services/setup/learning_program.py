"""Seed the default learning programme.

All published courses in the default organization are added to one programme.
The bundled Informatics course is first, with weight 5 and the Informatics KPI
formula; other courses start with weight 1 and the general formula. Existing
programme rows are never overwritten, so an admin can tune weights, sequence
and unlock rules later.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select

from src.core.events.database import _async_session_factory
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.stats import LearningProgram, ProgramCourse
from src.services.stats.course_stats import (
    DEFAULT_GENERAL_FORMULA,
    DEFAULT_INFORMATICS_FORMULA,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "Основная программа"


def _now() -> str:
    return datetime.now().isoformat()


def _json_value(value: Any) -> dict:
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value or {}


async def ensure_default_learning_program(
    session_factory=None,
    org_slug: str = "default",
) -> Optional[dict]:
    factory = session_factory or _async_session_factory
    try:
        async with factory() as db:
            org = (
                await db.execute(
                    select(Organization).where(Organization.slug == org_slug)
                )
            ).scalars().first()
            if org is None:
                org = (await db.execute(select(Organization).limit(1))).scalars().first()
            if org is None:
                return None

            program = (
                await db.execute(
                    select(LearningProgram)
                    .where(
                        LearningProgram.org_id == int(org.id or 0),
                        LearningProgram.is_active.is_(True),
                    )
                    .order_by(LearningProgram.id.asc())
                    .limit(1)
                )
            ).scalars().first()
            if program is None:
                now = _now()
                program = LearningProgram(
                    org_id=int(org.id or 0),
                    name=PROGRAM_NAME,
                    description="",
                    is_active=True,
                    creation_date=now,
                    update_date=now,
                )
                db.add(program)
                await db.flush()

            existing_rows = list(
                (
                    await db.execute(
                        select(ProgramCourse).where(
                            ProgramCourse.program_id == int(program.id or 0)
                        )
                    )
                ).scalars().all()
            )
            existing = {int(row.course_id) for row in existing_rows}
            courses = list(
                (
                    await db.execute(
                        select(Course)
                        .where(Course.org_id == int(org.id or 0), Course.published.is_(True))
                        .order_by(Course.creation_date.asc(), Course.id.asc())
                    )
                ).scalars().all()
            )
            max_order = int(
                (
                    await db.execute(
                        select(func.max(ProgramCourse.sequence_order)).where(
                            ProgramCourse.program_id == int(program.id or 0)
                        )
                    )
                ).scalar_one_or_none()
                or 0
            )
            created = 0
            informatics_course_id: Optional[int] = None
            for course in courses:
                meta = _json_value(course.extra_metadata)
                is_informatics = meta.get("seed") == "informatics"
                if is_informatics:
                    informatics_course_id = int(course.id or 0)
                if int(course.id or 0) in existing:
                    continue
                volume = int(
                    (
                        await db.execute(
                            select(func.count())
                            .select_from(Activity)
                            .where(Activity.course_id == int(course.id or 0))
                        )
                    ).scalar_one()
                )
                max_order += 1
                now = _now()
                db.add(
                    ProgramCourse(
                        program_id=int(program.id or 0),
                        course_id=int(course.id or 0),
                        sequence_order=1 if is_informatics else max_order,
                        weight=5.0 if is_informatics else 1.0,
                        estimated_hours=120.0 if is_informatics else 0.0,
                        volume=volume,
                        unlock_after_course_id=None,
                        unlock_kpi_threshold=0.0,
                        include_in_global=True,
                        kpi_formula=(
                            dict(DEFAULT_INFORMATICS_FORMULA)
                            if is_informatics
                            else dict(DEFAULT_GENERAL_FORMULA)
                        ),
                        creation_date=now,
                        update_date=now,
                    )
                )
                created += 1

            # The Informatics course must be first. If it shares order 1 with a
            # course created before it, move the others after it. Only fix
            # collisions, so an admin's custom order >1 is left alone.
            await db.flush()
            all_rows = list(
                (
                    await db.execute(
                        select(ProgramCourse).where(
                            ProgramCourse.program_id == int(program.id or 0)
                        )
                    )
                ).scalars().all()
            )
            informatics_pc: Optional[ProgramCourse] = None
            for row in all_rows:
                course = await db.get(Course, row.course_id)
                if course and _json_value(course.extra_metadata).get("seed") == "informatics":
                    informatics_pc = row
                    break
            if informatics_pc is not None:
                if informatics_pc.sequence_order != 1:
                    informatics_pc.sequence_order = 1
                    informatics_pc.update_date = _now()
                    db.add(informatics_pc)
                next_order = 2
                conflicting = [
                    row
                    for row in all_rows
                    if row.id != informatics_pc.id and row.sequence_order <= 1
                ]
                for row in sorted(
                    conflicting, key=lambda item: (item.sequence_order, item.id or 0)
                ):
                    row.sequence_order = next_order
                    row.update_date = _now()
                    db.add(row)
                    next_order += 1

            program.update_date = _now()
            db.add(program)
            await db.commit()
            report = {
                "program_id": int(program.id or 0),
                "program_name": program.name,
                "courses": len(courses),
                "created": created,
                "informatics_course_id": informatics_course_id,
            }
            logger.info("Learning programme ready: %s", report)
            return report
    except Exception:
        logger.exception("Learning programme seeding failed")
        return None
