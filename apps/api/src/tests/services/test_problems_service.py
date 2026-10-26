"""Problem library + importer tests (service level).

The importer is where the security-sensitive parsing lives, so these tests
exercise it directly with real ZIP bytes: valid packs, idempotency, manual-edit
conflicts, dry runs, path traversal, and the snapshot hand-off into an
assignment task.
"""

import io
import json
import zipfile
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.datastructures import UploadFile

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.problems import Problem, ProblemCreate, ProblemUpdate
from src.db.users import APITokenUser
from src.services.courses.activities.assignments import (
    create_assignment_task_from_problem,
)
from src.services.problems.problems import (
    create_problem,
    delete_problem,
    get_problem,
    import_problems,
    list_problems,
    update_problem,
)


def _pack(files: dict, manifest_problems=None) -> bytes:
    buffer = io.BytesIO()
    manifest = {
        "format": "learnhouse-problem-pack",
        "version": 1,
        "problems": manifest_problems
        or [{"external_id": "inf-2936", "dir": "problems/2936"}],
    }
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        for name, content in files.items():
            zf.writestr(name, content)
    return buffer.getvalue()


def _problem_files(
    title="Гипотенуза",
    statement="Дано два числа a и b. Найдите гипотенузу.",
    expected="5.0\n",
    source_id="2936",
    hidden_expected="13.0\n",
) -> dict:
    meta = {
        "external_id": f"inf-{source_id}",
        "title": title,
        "statement_file": "statement.md",
        "input_format": "Два целых числа",
        "output_format": "Одно вещественное число",
        "constraints": "1 <= a,b <= 1000",
        "difficulty": "easy",
        "topics": ["ввод-вывод", "арифметика"],
        "languages": [71, 54],
        "limits": {"time_ms": 1000, "memory_kb": 65536},
        "source": {
            "name": "Informatics",
            "url": "https://informatics.msk.ru/mod/statements/view.php?chapterid=2936",
            "problem_id": source_id,
        },
        "tests_file": "tests.json",
    }
    tests = {
        "tests": [
            {
                "id": "t1",
                "label": "Пример 1",
                "stdin": "3\n4\n",
                "expected_stdout": expected,
                "hidden": False,
                "weight": 1,
            },
            {
                "id": "t2",
                "label": "Скрытый 1",
                "stdin": "5\n12\n",
                "expected_stdout": hidden_expected,
                "hidden": True,
                "weight": 2,
            },
        ]
    }
    base = "problems/2936"
    return {
        f"{base}/problem.json": json.dumps(meta, ensure_ascii=False),
        f"{base}/statement.md": statement,
        f"{base}/tests.json": json.dumps(tests, ensure_ascii=False),
    }


def _upload(data: bytes) -> UploadFile:
    return UploadFile(filename="pack.zip", file=io.BytesIO(data))


async def _run_import(org_id, admin_user, db, data: bytes, dry_run=False):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        return await import_problems(
            org_id, _upload(data), admin_user, db, dry_run=dry_run
        )


@pytest.mark.asyncio
async def test_import_creates_problem_with_normalized_tests(db, org, admin_user):
    result = await _run_import(org.id, admin_user, db, _pack(_problem_files()))

    assert result.created == 1
    assert result.failed == 0
    assert result.results[0].status == "created"

    problem = (
        await db.execute(select(Problem).where(Problem.org_id == org.id))
    ).scalars().first()
    assert problem is not None
    assert problem.title == "Гипотенуза"
    assert problem.source_name == "Informatics"
    assert problem.source_id == "2936"
    assert problem.checksum
    assert problem.tests[0]["expected_stdout"] == "5.0\n"
    assert problem.tests[1]["hidden"] is True
    assert problem.tests[1]["weight"] == 2


@pytest.mark.asyncio
async def test_reimport_identical_is_skipped(db, org, admin_user):
    pack = _pack(_problem_files())
    await _run_import(org.id, admin_user, db, pack)
    result = await _run_import(org.id, admin_user, db, pack)

    assert result.created == 0
    assert result.skipped == 1
    count = len((await db.execute(select(Problem))).scalars().all())
    assert count == 1


@pytest.mark.asyncio
async def test_reimport_changed_updates_untouched_problem(db, org, admin_user):
    await _run_import(org.id, admin_user, db, _pack(_problem_files()))
    result = await _run_import(
        org.id,
        admin_user,
        db,
        _pack(_problem_files(statement="Новое условие", expected="6.0\n")),
    )

    assert result.updated == 1
    problem = (await db.execute(select(Problem))).scalars().first()
    assert "Новое условие" in problem.statement_md
    assert problem.tests[0]["expected_stdout"] == "6.0\n"


@pytest.mark.asyncio
async def test_manual_edit_wins_over_reimport(db, org, admin_user):
    await _run_import(org.id, admin_user, db, _pack(_problem_files()))
    problem = (await db.execute(select(Problem))).scalars().first()

    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        await update_problem(
            problem.problem_uuid,
            ProblemUpdate(statement_md="Правка преподавателя"),
            admin_user,
            db,
        )

    result = await _run_import(
        org.id,
        admin_user,
        db,
        _pack(_problem_files(statement="Импорт не должен победить")),
    )

    assert result.conflicts == 1
    await db.refresh(problem)
    assert problem.statement_md == "Правка преподавателя"


@pytest.mark.asyncio
async def test_dry_run_writes_nothing(db, org, admin_user):
    result = await _run_import(org.id, admin_user, db, _pack(_problem_files()), dry_run=True)

    assert result.created == 1
    assert (await db.execute(select(Problem))).scalars().first() is None


@pytest.mark.asyncio
async def test_path_traversal_is_rejected(db, org, admin_user):
    data = _pack({"../evil.json": "{}"})
    with pytest.raises(HTTPException) as exc:
        await _run_import(org.id, admin_user, db, data)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_invalid_test_does_not_abort_other_problems(db, org, admin_user):
    files = _problem_files()
    files["problems/2936/tests.json"] = json.dumps(
        {"tests": [{"id": "t1", "stdin": 1, "expected_stdout": "1"}]}
    )
    # Second, valid problem in the same pack.
    files.update(_prefix_files("problems/2937", _problem_files(source_id="2937")))
    manifest = [
        {"external_id": "inf-2936", "dir": "problems/2936"},
        {"external_id": "inf-2937", "dir": "problems/2937"},
    ]
    result = await _run_import(org.id, admin_user, db, _pack(files, manifest))

    assert result.failed == 1
    assert result.created == 1


def _prefix_files(directory: str, files: dict) -> dict:
    out = {}
    for name, content in files.items():
        out[name.replace("problems/2936", directory)] = content
    return out


@pytest.mark.asyncio
async def test_create_list_update_archive(db, org, admin_user):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        created = await create_problem(
            org.id,
            ProblemCreate(
                title="A+B",
                statement_md="Сложите два числа.",
                topics=["арифметика"],
                tests=[
                    {
                        "id": "t1",
                        "label": "one",
                        "stdin": "1 2\n",
                        "expected_stdout": "3\n",
                    }
                ],
            ),
            admin_user,
            db,
        )
        listed = await list_problems(org.id, admin_user, db, search="A+B")
        assert listed.total == 1
        assert created.is_edited is True

        updated = await update_problem(
            created.problem_uuid,
            ProblemUpdate(difficulty="easy"),
            admin_user,
            db,
        )
        assert updated.is_edited is True

        await delete_problem(created.problem_uuid, admin_user, db)
        listed = await list_problems(org.id, admin_user, db)
        assert listed.total == 0


@pytest.mark.asyncio
async def test_list_never_leaks_across_orgs(db, org, other_org, admin_user):
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        result = await list_problems(other_org.id, admin_user, db)
    assert result.total == 0


@pytest.mark.asyncio
async def test_imported_problem_snapshots_into_assignment_task(
    db, org, course, chapter, activity, admin_user
):
    await _run_import(org.id, admin_user, db, _pack(_problem_files()))
    problem = (await db.execute(select(Problem))).scalars().first()

    assignment = Assignment(
        id=1,
        title="HW",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()

    with patch(
        "src.services.courses.activities.assignments.authorize_assignment_access",
        new_callable=AsyncMock,
    ), patch(
        "src.services.courses.activities.assignments.index_activity"
    ):
        task = await create_assignment_task_from_problem(
            None, "assignment_test", problem.problem_uuid, None, admin_user, db
        )

    assert task.assignment_type == AssignmentTaskTypeEnum.CODE
    assert task.problem_uuid == problem.problem_uuid
    assert task.problem_checksum == problem.checksum
    assert task.contents["test_cases"][1]["hidden"] is True
    assert task.contents["test_cases"][1]["expectedStdout"] == "13.0\n"
    assert "Input:" in task.description

    # Editing the library row must not rewrite the task snapshot.
    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        await update_problem(
            problem.problem_uuid,
            ProblemUpdate(statement_md="Изменено после назначения"),
            admin_user,
            db,
        )
    stored = (
        await db.execute(
            select(AssignmentTask).where(
                AssignmentTask.assignment_task_uuid == task.assignment_task_uuid
            )
        )
    ).scalars().first()
    assert "Изменено после назначения" not in stored.description


@pytest.mark.asyncio
async def test_member_without_assignments_rights_is_denied(db, org, regular_user):
    with pytest.raises(HTTPException) as exc:
        await create_problem(
            org.id,
            ProblemCreate(
                title="Denied",
                statement_md="x",
                tests=[{"id": "t", "stdin": "", "expected_stdout": ""}],
            ),
            regular_user,
            db,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_learner_with_assignments_read_cannot_read_hidden_tests(
    db, org, admin_user, regular_user, user_role
):
    """Learners can read assignments, but the library payload contains the
    hidden tests' expected stdout, so library reads require the authoring
    action instead of the plain read action."""
    rights = dict(user_role.rights or {})
    rights["assignments"] = {
        "action_create": False,
        "action_read": True,
        "action_update": False,
        "action_delete": False,
    }
    user_role.rights = rights
    db.add(user_role)
    await db.commit()

    await _run_import(org.id, admin_user, db, _pack(_problem_files()))
    problem = (await db.execute(select(Problem))).scalars().first()

    with pytest.raises(HTTPException) as list_exc:
        await list_problems(org.id, regular_user, db)
    assert list_exc.value.status_code == 403

    with pytest.raises(HTTPException) as get_exc:
        await get_problem(problem.problem_uuid, regular_user, db)
    assert get_exc.value.status_code == 403



@pytest.mark.asyncio
async def test_api_tokens_cannot_manage_library(db, org):
    token = APITokenUser(id=1, org_id=org.id, created_by_user_id=1, rights={})
    with pytest.raises(HTTPException) as exc:
        await list_problems(org.id, token, db)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_manifest_rejects_duplicate_entries(db, org, admin_user):
    data = _pack(
        {},
        manifest_problems=[
            {"external_id": "inf-1", "dir": "problems/1"},
            {"external_id": "inf-1", "dir": "problems/2"},
        ],
    )
    with pytest.raises(HTTPException) as exc:
        await _run_import(org.id, admin_user, db, data)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_same_content_from_different_sources_is_not_merged(db, org, admin_user):
    await _run_import(org.id, admin_user, db, _pack(_problem_files(source_id="2936")))
    result = await _run_import(
        org.id, admin_user, db, _pack(_problem_files(source_id="2937"))
    )

    assert result.created == 1
    problems = (await db.execute(select(Problem))).scalars().all()
    assert {p.source_id for p in problems} == {"2936", "2937"}


@pytest.mark.asyncio
async def test_broken_zip_is_rejected(db, org, admin_user):
    with pytest.raises(HTTPException) as exc:
        await _run_import(org.id, admin_user, db, b"not a zip")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_reimport_never_touches_assignment_history(
    db, org, course, chapter, activity, admin_user
):
    await _run_import(org.id, admin_user, db, _pack(_problem_files()))

    assignment = Assignment(
        id=42,
        title="History",
        description="",
        due_date=None,
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_history",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()

    submission = AssignmentUserSubmission(
        assignmentusersubmission_uuid="assignmentusersubmission_history",
        submission_status=AssignmentUserSubmissionStatus.GRADED,
        grade=90,
        attempt_number=1,
        user_id=admin_user.id,
        assignment_id=assignment.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(submission)
    await db.commit()

    await _run_import(
        org.id,
        admin_user,
        db,
        _pack(_problem_files(statement="Changed", expected="7.0\n")),
    )

    stored = (
        await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id
            )
        )
    ).scalars().all()
    assert len(stored) == 1
    assert stored[0].grade == 90


@pytest.mark.asyncio
async def test_archived_problem_is_not_resurrected_by_reimport(db, org, admin_user):
    await _run_import(org.id, admin_user, db, _pack(_problem_files()))
    problem = (await db.execute(select(Problem))).scalars().first()

    with patch(
        "src.services.problems.problems.require_org_role_permission",
        new_callable=AsyncMock,
    ):
        await delete_problem(problem.problem_uuid, admin_user, db)

    result = await _run_import(
        org.id,
        admin_user,
        db,
        _pack(_problem_files(statement="New", expected="9.0\n")),
    )
    assert result.conflicts == 1
    await db.refresh(problem)
    assert problem.archived is True
    assert "New" not in problem.statement_md


@pytest.mark.asyncio
async def test_absolute_and_unsupported_entries_are_rejected(db, org, admin_user):
    for bad in ("/abs.json", "problems/2936/run.exe"):
        data = _pack({bad: b"x"})
        with pytest.raises(HTTPException) as exc:
            await _run_import(org.id, admin_user, db, data)
        assert exc.value.status_code in (400, 413)
