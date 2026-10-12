import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BeforeValidator, Field
from sqlalchemy import select

from app.core.deps import DbDep, Principal, ServicesDep, require_role
from app.edits.schemas import EditOut, StrictModel, clean_text
from app.edits.service import edit_response
from app.geo import GeoJSONLineString, line_geojson
from app.lines.router import Limit, Offset, VersionOut
from app.models import Edit, Line, LineVersion, User
from app.models.enums import UserRole
from app.moderation.service import approve, audit, context_for, locked_edit, rollback
from app.security.policy import Action, authorize

router = APIRouter()
type ModeratorDep = Annotated[Principal, Depends(require_role(UserRole.MODERATOR, UserRole.ADMIN))]
DELETED_CONTRIBUTOR_LABEL = "silinmiş katkıcı"


class QueueOut(EditOut):
    author: str
    current_geometry: GeoJSONLineString | None
    proposed_geometry: GeoJSONLineString | None


class RejectInput(StrictModel):
    reason: Annotated[str, BeforeValidator(clean_text), Field(min_length=1, max_length=1000)]


class RollbackInput(StrictModel):
    version_no: Annotated[int, Field(ge=1, le=2147483647)]


@router.get("/moderation/edits")
async def queue(
    principal: ModeratorDep,
    db: DbDep,
    state: Literal["pending", "approved", "rejected", "withdrawn"] = "pending",
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[QueueOut]:
    rows = await db.scalars(
        select(Edit)
        .where(Edit.state == state)
        .order_by(
            Edit.created_at,
            Edit.id,
        )
        .limit(limit)
        .offset(offset)
    )
    result: list[QueueOut] = []
    for edit in rows:
        author = await db.get(User, edit.author_id) if edit.author_id else None
        line = await db.get(Line, edit.line_id) if edit.line_id else None
        version = (
            await db.get(LineVersion, line.current_version_id)
            if (line is not None and line.current_version_id is not None)
            else None
        )
        current = line_geojson(version.geom) if version else None
        proposed = current
        if edit.kind == "new_line":
            proposed = {"type": "LineString", "coordinates": []}
            coordinates = edit.payload.get("geometry")
        else:
            changes = edit.payload.get("changes")
            coordinates = changes.get("geometry") if isinstance(changes, dict) else None
        if isinstance(coordinates, list):
            proposed = {
                "type": "LineString",
                "coordinates": [
                    [float(point[0]), float(point[1])]
                    for point in coordinates
                    if isinstance(point, list) and len(point) == 2
                ],
            }
        result.append(
            QueueOut(
                **(await edit_response(db, edit)).model_dump(),
                author=(author.display_name or "katkıcı") if author else DELETED_CONTRIBUTOR_LABEL,
                current_geometry=current,
                proposed_geometry=proposed,
            )
        )
    return result


@router.post("/moderation/edits/{identity}/approve")
async def approve_edit(
    identity: uuid.UUID,
    principal: ModeratorDep,
    db: DbDep,
    services: ServicesDep,
) -> EditOut:
    edit = await locked_edit(db, identity)
    await approve(db, edit, principal, services)
    result = await edit_response(db, edit)
    await db.commit()
    return result


@router.post("/moderation/edits/{identity}/reject")
async def reject_edit(
    identity: uuid.UUID,
    body: RejectInput,
    principal: ModeratorDep,
    db: DbDep,
    services: ServicesDep,
) -> EditOut:
    edit = await locked_edit(db, identity)
    authorize(principal, Action.REJECT_EDIT, await context_for(db, principal, services, edit))
    edit.state = "rejected"
    edit.reason = body.reason
    edit.reviewer_id = principal.user_id
    edit.reviewed_at = services.clock.now()
    audit(
        db,
        principal,
        "moderation.reject",
        "edit",
        edit.id,
        {"state": {"from": "pending", "to": "rejected"}},
        services.clock.now(),
    )
    result = await edit_response(db, edit)
    await db.commit()
    return result


@router.post("/moderation/lines/{identity}/rollback")
async def rollback_line(
    identity: uuid.UUID,
    body: RollbackInput,
    principal: ModeratorDep,
    db: DbDep,
    services: ServicesDep,
) -> VersionOut:
    version = await rollback(db, identity, body.version_no, principal, services)
    result = VersionOut(
        version_no=version.version_no,
        published_at=version.published_at,
        fare_minor=version.fare_minor,
        stop_count=len(version.stop_ids),
    )
    await db.commit()
    return result
