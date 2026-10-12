import hashlib
import json
import uuid
from datetime import datetime, timedelta

from geoalchemy2.shape import from_shape
from pydantic import TypeAdapter
from shapely.geometry import LineString, Point
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, Services
from app.core.errors import ProblemError
from app.core.ids import uuid7
from app.edits.schemas import EditInput, FareUpdate, NewLine, NewStop, Retire, UpdateLine
from app.edits.service import prepare_edit, stored_line, stored_stop, version_values
from app.geo import slugify
from app.lines.router import current_version
from app.models import AuditLog, City, Edit, Line, LineStop, LineVersion, Stop, Trace, User
from app.models.enums import EditState
from app.security.policy import Action, ResourceContext, authorize

EDIT_ADAPTER = TypeAdapter[EditInput](EditInput)


async def locked_edit(db: AsyncSession, identity: uuid.UUID) -> Edit:
    edit = await db.scalar(select(Edit).where(Edit.id == identity).with_for_update())
    if edit is None:
        raise ProblemError("edit.not_found", 404)
    return edit


async def context_for(
    db: AsyncSession,
    principal: Principal,
    services: Services,
    edit: Edit | None = None,
) -> ResourceContext:
    step_up = await services.step_up.step_up_at(db, principal) if services.step_up else None
    return ResourceContext(
        actor_id=principal.user_id,
        edit_author_id=edit.author_id if edit else None,
        edit_state=EditState(edit.state) if edit else None,
        step_up_at=step_up,
        now=services.clock.now(),
    )


def audit(
    db: AsyncSession,
    principal: Principal,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    diff: object,
    now: datetime,
) -> None:
    canonical = json.dumps(diff, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(canonical).digest()
    db.add(
        AuditLog(
            id=uuid7(),
            actor_id=principal.user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            diff_hash=digest,
            created_at=now,
            updated_at=now,
        )
    )


async def unique_slug(db: AsyncSession, city_id: uuid.UUID, value: str, *, stop: bool) -> str:
    base = slugify(value)
    model = Stop if stop else Line
    existing = set(await db.scalars(select(model.slug).where(model.city_id == city_id)))
    candidate = base
    suffix = 2
    while candidate in existing:
        candidate = base + "-" + str(suffix)
        suffix += 1
    return candidate


async def publish_version(
    db: AsyncSession,
    line: Line,
    source: LineVersion | None,
    body: NewLine | UpdateLine | FareUpdate | None,
    principal: Principal,
    now: datetime,
    edit_id: uuid.UUID | None,
) -> LineVersion:
    maximum = await db.scalar(
        select(func.max(LineVersion.version_no)).where(
            LineVersion.line_id == line.id,
        )
    )
    if source is None:
        if not isinstance(body, NewLine):
            raise ProblemError("edit.invalid_payload", 422)
        geometry = from_shape(LineString(body.geometry), srid=4326)
        stop_ids = [str(identity) for identity in body.stop_ids]
        fare = body.fare_minor
        fare_date = now if fare is not None else None
        hours = body.hours_text
        payments: list[str] = list(body.payment_methods)
        notes = body.hail_notes
    else:
        geometry = source.geom
        stop_ids = list(source.stop_ids)
        fare = source.fare_minor
        fare_date = source.fare_updated_at
        hours = source.hours_text
        payments = list(source.payment_methods)
        notes = source.hail_notes
        if isinstance(body, FareUpdate):
            fare = body.fare_minor
        elif isinstance(body, UpdateLine):
            changes = body.changes
            if changes.geometry is not None:
                geometry = from_shape(LineString(changes.geometry), srid=4326)
            if changes.stop_ids is not None:
                stop_ids = [str(identity) for identity in changes.stop_ids]
            if "fare_minor" in changes.model_fields_set:
                fare = changes.fare_minor
            if "hours_text" in changes.model_fields_set:
                hours = changes.hours_text
            if changes.payment_methods is not None:
                payments = list(changes.payment_methods)
            if "hail_notes" in changes.model_fields_set:
                notes = changes.hail_notes
            if changes.name is not None:
                line.name = changes.name
        if fare != source.fare_minor:
            fare_date = now
    version = LineVersion(
        id=uuid7(),
        line_id=line.id,
        version_no=int(maximum or 0) + 1,
        geom=geometry,
        fare_minor=fare,
        fare_updated_at=fare_date,
        hours_text=hours,
        payment_methods=payments,
        hail_notes=notes,
        stop_ids=stop_ids,
        source_edit_id=edit_id,
        published_by=principal.user_id,
        published_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(version)
    await db.flush()
    for seq, stop_id in enumerate(stop_ids):
        db.add(
            LineStop(
                line_version_id=version.id, stop_id=uuid.UUID(stop_id), seq=seq, created_at=now
            )
        )
    line.current_version_id = version.id
    line.last_verified_at = now
    return version


RECIPROCAL_WINDOW = timedelta(days=30)


async def refuse_reciprocal_approval(
    db: AsyncSession, principal: Principal, edit: Edit, now: datetime
) -> None:
    """Two reviewers must not publish each other's proposals (threat model: sockpuppet
    approval). When the author of this edit approved one of the reviewer's own edits within
    the window, a third, independent reviewer has to decide."""
    if edit.author_id is None:
        return
    reciprocal = await db.scalar(
        select(Edit.id)
        .where(
            Edit.author_id == principal.user_id,
            Edit.reviewer_id == edit.author_id,
            Edit.state == EditState.APPROVED.value,
            Edit.reviewed_at >= now - RECIPROCAL_WINDOW,
        )
        .limit(1)
    )
    if reciprocal is not None:
        raise ProblemError("moderation.reciprocal_conflict", 409)


async def approve(
    db: AsyncSession,
    edit: Edit,
    principal: Principal,
    services: Services,
) -> None:
    context = await context_for(db, principal, services, edit)
    authorize(principal, Action.APPROVE_EDIT, context)
    authorize(principal, Action.PUBLISH_VERSION, context)
    body = EDIT_ADAPTER.validate_python(edit.payload)
    if isinstance(body, Retire):
        authorize(principal, Action.RETIRE_LINE, context)
    now = services.clock.now()
    await refuse_reciprocal_approval(db, principal, edit, now)
    city = await db.scalar(select(City).where(City.id == edit.city_id).with_for_update())
    if city is None:
        raise ProblemError("city.not_found", 404)
    line: Line | None = None
    if isinstance(body, UpdateLine | FareUpdate | Retire):
        if edit.line_id is None:
            raise ProblemError("line.not_found", 404)
        line = await stored_line(db, edit.line_id, lock=True)
        source = await current_version(db, line)
        if isinstance(body, UpdateLine | FareUpdate) and body.base_version_no != source.version_no:
            raise ProblemError("edit.version_conflict", 409)
    # Revalidate active stops and the current city boundary at publication time.
    _, _, _, applied_diff = await prepare_edit(db, body)
    if isinstance(body, NewLine):
        line = Line(
            id=uuid7(),
            city_id=city.id,
            code=body.code,
            name=body.name,
            mode=body.mode.value,
            slug=await unique_slug(db, city.id, body.code, stop=False),
            status="draft",
            contributor_count=0,
            created_at=now,
            updated_at=now,
        )
        db.add(line)
        await db.flush()
        edit.line_id = line.id
        await publish_version(db, line, None, body, principal, now, edit.id)
        line.status = "published"
    elif isinstance(body, UpdateLine | FareUpdate):
        if line is None:
            raise ProblemError("line.not_found", 404)
        await publish_version(
            db, line, await current_version(db, line), body, principal, now, edit.id
        )
    elif isinstance(body, Retire):
        if line is None:
            raise ProblemError("line.not_found", 404)
        line.status = "retired"
    elif isinstance(body, NewStop):
        stop = Stop(
            id=uuid7(),
            city_id=city.id,
            name=body.name,
            slug=await unique_slug(db, city.id, body.name, stop=True),
            location=from_shape(Point(body.location), srid=4326),
            kind=body.stop_kind.value,
            status="active",
            created_at=now,
            updated_at=now,
        )
        db.add(stop)
        await db.flush()
        edit.stop_id = stop.id
    else:
        if edit.stop_id is None:
            raise ProblemError("stop.not_found", 404)
        stop = await stored_stop(db, edit.stop_id)
        if body.changes.name is not None:
            stop.name = body.changes.name
        if body.changes.location is not None:
            stop.location = from_shape(Point(body.changes.location), srid=4326)
        if body.changes.kind is not None:
            stop.kind = body.changes.kind.value
    edit.diff = applied_diff
    edit.state = "approved"
    edit.reviewer_id = principal.user_id
    edit.reviewed_at = now
    await db.flush()
    if line is not None:
        count = await db.scalar(
            select(func.count(func.distinct(Edit.author_id))).where(
                Edit.line_id == line.id,
                Edit.state == "approved",
                Edit.author_id.is_not(None),
            )
        )
        line.contributor_count = int(count or 0)
        line.last_verified_at = now
    if edit.author_id is not None:
        await db.execute(
            update(User)
            .where(User.id == edit.author_id)
            .values(
                reputation=User.reputation + 5,
            )
        )
    city.pack_version += 1
    await db.execute(
        update(Trace)
        .where(Trace.linked_edit_id == edit.id)
        .values(
            delete_after=now + timedelta(days=services.settings.trace_retention_days),
        )
    )
    audit(db, principal, "moderation.approve", "edit", edit.id, applied_diff, now)


async def rollback(
    db: AsyncSession,
    identity: uuid.UUID,
    version_no: int,
    principal: Principal,
    services: Services,
) -> LineVersion:
    authorize(principal, Action.ROLLBACK, await context_for(db, principal, services))
    # Lock city before line, matching approval's lock order.
    line_row = await stored_line(db, identity)
    city = await db.scalar(select(City).where(City.id == line_row.city_id).with_for_update())
    if city is None:
        raise ProblemError("city.not_found", 404)
    line = await stored_line(db, identity, lock=True)
    old = await db.scalar(
        select(LineVersion).where(
            LineVersion.line_id == line.id,
            LineVersion.version_no == version_no,
        )
    )
    if old is None:
        raise ProblemError("line.version_not_found", 404)
    current = await current_version(db, line)
    now = services.clock.now()
    version = await publish_version(db, line, old, None, principal, now, None)
    city.pack_version += 1
    diff = {
        "version_no": {"from": current.version_no, "to": version.version_no},
        "content": {"from": version_values(line, current), "to": version_values(line, old)},
    }
    audit(db, principal, "moderation.rollback", "line", line.id, diff, now)
    return version
