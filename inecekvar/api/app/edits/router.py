import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.deps import ClockDep, DbDep, PrincipalDep, RateLimiterDep, enforce_rate_limit
from app.core.errors import AUTH_FORBIDDEN, ProblemError
from app.core.ids import uuid7
from app.core.settings import EDITS_REPUTATION_THRESHOLD
from app.edits.schemas import EditInput, EditOut
from app.edits.service import edit_response, prepare_edit, resolve_attachments
from app.lines.router import Limit, Offset
from app.models import Edit, User
from app.security.deps import require_permission
from app.security.policy import Action, can_read_edit

router = APIRouter()


@router.post(
    "/edits",
    status_code=201,
    dependencies=[Depends(require_permission(Action.PROPOSE_EDIT))],
)
async def propose_edit(
    body: EditInput,
    db: DbDep,
    principal: PrincipalDep,
    clock: ClockDep,
    limiter: RateLimiterDep,
) -> EditOut:
    trace, photo_id = await resolve_attachments(db, body, principal.user_id)
    city, line_id, stop_id, diff = await prepare_edit(db, body)
    user = await db.get(User, principal.user_id)
    if user is None:
        raise ProblemError(AUTH_FORBIDDEN, 403)
    rule = (
        "edits.low_reputation" if user.reputation < EDITS_REPUTATION_THRESHOLD else "edits.default"
    )
    await enforce_rate_limit(limiter, rule, "user:" + str(principal.user_id))
    edit = Edit(
        id=uuid7(),
        kind=body.kind,
        city_id=city.id,
        line_id=line_id,
        stop_id=stop_id,
        payload=body.model_dump(
            mode="json",
            by_alias=True,
            exclude_unset=True,
            exclude={"trace_id": True, "photo_id": True, "changes": {"trace_id"}},
        ),
        photo_id=photo_id,
        diff=diff,
        state="pending",
        author_id=principal.user_id,
        created_at=clock.now(),
        updated_at=clock.now(),
    )
    db.add(edit)
    await db.flush()
    if trace is not None:
        trace.linked_edit_id = edit.id
    result = await edit_response(db, edit)
    await db.commit()
    return result


@router.get("/edits")
async def list_edits(
    db: DbDep,
    principal: PrincipalDep,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[EditOut]:
    rows = await db.scalars(
        select(Edit)
        .where(Edit.author_id == principal.user_id)
        .order_by(
            Edit.created_at.desc(),
            Edit.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return [await edit_response(db, edit) for edit in rows]


@router.get("/edits/{identity}")
async def read_edit(identity: uuid.UUID, db: DbDep, principal: PrincipalDep) -> EditOut:
    edit = await db.get(Edit, identity)
    if edit is None:
        raise ProblemError("edit.not_found", 404)
    if not can_read_edit(principal, edit.author_id):
        raise ProblemError(AUTH_FORBIDDEN, 403)
    return await edit_response(db, edit)
