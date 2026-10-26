from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.problems import (
    ProblemCreate,
    ProblemImportResponse,
    ProblemListResponse,
    ProblemRead,
    ProblemUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.problems.informatics import import_informatics_problem
from src.services.problems.problems import (
    create_problem,
    delete_problem,
    get_problem,
    import_problems,
    list_problems,
    update_problem,
)

router = APIRouter()


@router.get(
    "/org/{org_id}",
    response_model=ProblemListResponse,
    summary="List the organization's problem library",
    description="Paginated, searchable list of programming problems, including hidden tests. Requires the assignments update (authoring) permission in the target organization.",
    responses={
        200: {"description": "A page of problems.", "model": ProblemListResponse},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Organization not found"},
    },
)
async def api_list_problems(
    org_id: int,
    request: Request,
    search: Optional[str] = Query(None, max_length=200),
    difficulty: Optional[str] = Query(None, max_length=32),
    topic: Optional[str] = Query(None, max_length=100),
    include_archived: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemListResponse:
    return await list_problems(
        org_id,
        current_user,
        db_session,
        search=search,
        difficulty=difficulty,
        topic=topic,
        include_archived=include_archived,
        page=page,
        limit=limit,
    )


@router.post(
    "/org/{org_id}",
    response_model=ProblemRead,
    summary="Create a problem",
    description="Create a single problem in the organization's library. Tests are validated with the same rules as the ZIP importer.",
    responses={
        200: {"description": "Problem created.", "model": ProblemRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        409: {"description": "Duplicate source id"},
        422: {"description": "Validation error"},
    },
)
async def api_create_problem(
    org_id: int,
    problem_object: ProblemCreate,
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemRead:
    return await create_problem(org_id, problem_object, current_user, db_session)


@router.post(
    "/org/{org_id}/import",
    response_model=ProblemImportResponse,
    summary="Import a problem pack",
    description="Upload a learnhouse-problem-pack ZIP. Re-importing identical content is a no-op; edited problems are never overwritten. Set dry_run=true to validate and preview without writing.",
    responses={
        200: {"description": "Import report.", "model": ProblemImportResponse},
        400: {"description": "Invalid or unsafe ZIP archive"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        413: {"description": "Archive exceeds the size limits"},
        422: {"description": "Manifest or problem validation error"},
    },
)
async def api_import_problems(
    org_id: int,
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemImportResponse:
    return await import_problems(
        org_id, file, current_user, db_session, dry_run=dry_run
    )


class InformaticsImportBody(BaseModel):
    problem_id: int = Field(ge=1, le=100_000_000)
    dry_run: bool = False


@router.post(
    "/org/{org_id}/import/informatics",
    response_model=ProblemImportResponse,
    summary="Import one Informatics problem",
    description="Fetch a single problem from the public informatics.msk.ru JSON endpoint and import its statement, limits and public sample tests. Hidden judge tests are not available; add them in the library editor. Reuses the normal pack validation and conflict rules.",
    responses={
        200: {"description": "Import report.", "model": ProblemImportResponse},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Informatics problem not found"},
        413: {"description": "Informatics response is too large"},
        422: {"description": "Problem has no usable statement/sample tests"},
        502: {"description": "Informatics request failed"},
    },
)
async def api_import_informatics_problem(
    org_id: int,
    body: InformaticsImportBody,
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemImportResponse:
    return await import_informatics_problem(
        org_id,
        body.problem_id,
        current_user,
        db_session,
        dry_run=body.dry_run,
    )


@router.get(
    "/{problem_uuid}",
    response_model=ProblemRead,
    summary="Get a problem",
    responses={
        200: {"description": "The problem.", "model": ProblemRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Problem not found"},
    },
)
async def api_get_problem(
    problem_uuid: str,
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemRead:
    return await get_problem(problem_uuid, current_user, db_session)


@router.put(
    "/{problem_uuid}",
    response_model=ProblemRead,
    summary="Update a problem",
    description="Update library fields. Any successful update marks the problem as manually edited so re-imports report a conflict instead of overwriting it.",
    responses={
        200: {"description": "Problem updated.", "model": ProblemRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Problem not found"},
        409: {"description": "Duplicate source id"},
        422: {"description": "Validation error"},
    },
)
async def api_update_problem(
    problem_uuid: str,
    problem_object: ProblemUpdate,
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ProblemRead:
    return await update_problem(
        problem_uuid, problem_object, current_user, db_session
    )


@router.delete(
    "/{problem_uuid}",
    summary="Archive a problem",
    description="Soft-deletes the library row. Assignments keep their snapshots and student history.",
    responses={
        200: {"description": "Problem archived."},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Problem not found"},
    },
)
async def api_delete_problem(
    problem_uuid: str,
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await delete_problem(problem_uuid, current_user, db_session)
