"""Course-level Informatics account requirement.

The flag is opt-in per course. The product path is login + password, so these
tests pin that a legacy userscript token alone does not satisfy the gate.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import AssignmentTaskSubmissionUpdate
from src.db.informatics import InformaticsAccount
from src.services.courses.activities.assignments import (
    handle_assignment_task_submission,
)
from src.services.informatics import ingest
from src.services.informatics.crypto import encrypt_secret
from src.services.informatics.requirements import (
    ensure_informatics_ready,
    get_requirement,
)

_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_PATCH_AUTH_ROLES = (
    "src.services.courses.activities.assignments.authorization_verify_based_on_roles"
)


def _require_script(course):
    course.extra_metadata = {"informatics": {"require_script": True}}
    return course


class TestRequirementState:
    async def test_course_without_flag_is_always_ready(self, db, course, regular_user):
        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["required"] is False
        assert requirement["ready"] is True
        assert requirement["reason"] == ""

    async def test_userscript_token_does_not_satisfy_the_gate(
        self, db, course, regular_user
    ):
        _require_script(course)
        db.add(course)
        await db.commit()

        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["required"] is True
        assert requirement["connected"] is False
        assert requirement["script_seen"] is False
        assert requirement["ready"] is False
        assert requirement["reason"] == "connect"

        account, _token = await ingest.rotate_token(db, regular_user.id)
        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["connected"] is True
        assert requirement["script_seen"] is False
        assert requirement["ready"] is False
        assert requirement["reason"] == "connect"

        await ingest.touch_account(db, account)
        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["connected"] is True
        assert requirement["script_seen"] is True
        assert requirement["ready"] is False
        assert requirement["reason"] == "connect"

    async def test_token_rotation_invalidates_the_old_ping(
        self, db, course, regular_user
    ):
        _require_script(course)
        db.add(course)
        await db.commit()

        account, _token = await ingest.rotate_token(db, regular_user.id)
        await ingest.touch_account(db, account)
        # Rotating mints a new token; the previous token's ping must not count.
        await ingest.rotate_token(db, regular_user.id)

        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["connected"] is True
        assert requirement["script_seen"] is False
        assert requirement["ready"] is False
        assert requirement["reason"] == "connect"

    async def test_server_link_counts_as_ready(self, db, course, regular_user):
        _require_script(course)
        db.add(course)
        await db.commit()
        db.add(
            InformaticsAccount(
                user_id=regular_user.id,
                username="ivan",
                email="ivan@example.com",
                password_encrypted=encrypt_secret("secret"),
                informatics_user_id=42,
                status="ACTIVE",
                created_at="2026-01-01",
                updated_at="2026-01-01",
            )
        )
        await db.commit()

        requirement = await get_requirement(db, regular_user.id, course)
        assert requirement["server_linked"] is True
        assert requirement["ready"] is True
        assert requirement["reason"] == ""

    async def test_ensure_raises_with_actionable_detail(
        self, db, course, regular_user
    ):
        _require_script(course)
        db.add(course)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await ensure_informatics_ready(db, regular_user.id, course)
        assert exc.value.status_code == 403
        detail = exc.value.detail
        assert detail["code"] == "informatics_setup_required"
        assert detail["url"] == "/account/informatics"
        assert detail["reason"] == "connect"


class TestSubmissionGate:
    async def test_learner_submission_is_blocked_until_ready(
        self, mock_request, db, course, assignment_task, regular_user
    ):
        _require_script(course)
        db.add(course)
        await db.commit()

        obj = AssignmentTaskSubmissionUpdate(task_submission={"answer": "4"})
        with patch(_PATCH_RBAC, new_callable=AsyncMock), patch(
            _PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(HTTPException) as exc:
                await handle_assignment_task_submission(
                    mock_request,
                    assignment_task.assignment_task_uuid,
                    obj,
                    regular_user,
                    db,
                )

        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "informatics_setup_required"

    async def test_instructor_is_exempt_from_the_gate(
        self, mock_request, db, course, assignment_task, regular_user
    ):
        _require_script(course)
        db.add(course)
        await db.commit()

        obj = AssignmentTaskSubmissionUpdate(task_submission={"answer": "4"})
        with patch(_PATCH_RBAC, new_callable=AsyncMock), patch(
            _PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True
        ), patch(
            "src.services.courses.activities.assignments.ensure_informatics_ready",
            new_callable=AsyncMock,
        ) as gate:
            try:
                await handle_assignment_task_submission(
                    mock_request,
                    assignment_task.assignment_task_uuid,
                    obj,
                    regular_user,
                    db,
                )
            except HTTPException:
                # Unrelated downstream gates (ownership, grades) are outside this
                # test; only the Informatics gate is under test.
                pass
        gate.assert_not_awaited()
