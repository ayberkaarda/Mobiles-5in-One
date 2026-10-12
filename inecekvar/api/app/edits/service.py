import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cities.router import get_city
from app.core.errors import ProblemError
from app.edits.schemas import (
    EditInput,
    EditOut,
    FareUpdate,
    NewLine,
    NewStop,
    UpdateLine,
    UpdateStop,
)
from app.geo import Coordinate, bbox_contains, line_geojson, point_coordinates, validate_polyline
from app.lines.router import current_version
from app.models import City, Edit, Line, LineVersion, Photo, Stop, Trace
from app.traces.derive import derive_line_geometry
from app.traces.router import TraceInput


async def resolve_attachments(
    db: AsyncSession,
    body: EditInput,
    user_id: uuid.UUID,
) -> tuple[Trace | None, uuid.UUID | None]:
    trace: Trace | None = None
    source = (
        body
        if isinstance(body, NewLine)
        else (body.changes if isinstance(body, UpdateLine) else None)
    )
    if source is not None:
        source.geometry_source = None
        source.model_fields_set.discard("geometry_source")
    if source is not None and source.trace_id is not None:
        trace = await db.scalar(
            select(Trace)
            .where(Trace.id == source.trace_id, Trace.author_id == user_id)
            .with_for_update()
        )
        if trace is None:
            raise ProblemError("trace.not_found", 404)
        if trace.linked_edit_id is not None:
            raise ProblemError("trace.already_linked", 409)
        validated = TraceInput.model_validate(
            {
                "city": "stored",
                "started_at": trace.started_at,
                "ended_at": trace.ended_at,
                "points": trace.points,
            }
        )
        geometry = derive_line_geometry(validated.points)
        try:
            validate_polyline(geometry)
        except ValueError as error:
            raise ProblemError("trace.invalid_geometry", 422) from error
        source.geometry = geometry
        source.trace_id = None
        source.geometry_source = "trace"
        source.model_fields_set.discard("trace_id")
    photo_id = body.photo_id
    if photo_id is not None:
        photo = await db.scalar(
            select(Photo)
            .where(
                Photo.id == photo_id,
                Photo.owner_id == user_id,
                Photo.processed_at.is_not(None),
                Photo.moderation_state != "quarantined",
            )
            .with_for_update()
        )
        if photo is None:
            raise ProblemError("photo.not_found", 404)
    return trace, photo_id


async def stored_line(db: AsyncSession, identity: uuid.UUID, *, lock: bool = False) -> Line:
    query = select(Line).where(Line.id == identity, Line.status != "draft")
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    line = await db.scalar(query)
    if line is None:
        raise ProblemError("line.not_found", 404)
    return line


async def stored_stop(db: AsyncSession, identity: uuid.UUID) -> Stop:
    stop = await db.get(Stop, identity)
    if stop is None or stop.status != "active":
        raise ProblemError("stop.not_found", 404)
    return stop


def version_values(line: Line, version: LineVersion) -> dict[str, object]:
    return {
        "name": line.name,
        "geometry": line_geojson(version.geom)["coordinates"],
        "stop_ids": version.stop_ids,
        "fare_minor": version.fare_minor,
        "hours_text": version.hours_text,
        "payment_methods": version.payment_methods,
        "hail_notes": version.hail_notes,
    }


def compute_diff(current: dict[str, object], proposed: dict[str, object]) -> dict[str, object]:
    diff: dict[str, object] = {
        field: {"from": current.get(field), "to": value}
        for field, value in proposed.items()
        if current.get(field) != value
    }
    if not diff:
        raise ProblemError("edit.no_change", 422)
    return diff


async def validate_city_data(
    db: AsyncSession,
    city: City,
    geometry: list[Coordinate] | None,
    stop_ids: list[uuid.UUID] | None,
) -> None:
    if geometry is not None and not bbox_contains(city.bbox, geometry):
        raise ProblemError("edit.outside_bbox", 422)
    if stop_ids is not None:
        rows = await db.scalars(
            select(Stop.id).where(
                Stop.id.in_(stop_ids),
                Stop.city_id == city.id,
                Stop.status == "active",
            )
        )
        if set(rows) != set(stop_ids):
            raise ProblemError("edit.invalid_stops", 422)


async def prepare_edit(
    db: AsyncSession,
    body: EditInput,
) -> tuple[City, uuid.UUID | None, uuid.UUID | None, dict[str, object]]:
    line_id = None
    stop_id = None
    diff: dict[str, object]
    if isinstance(body, NewLine | NewStop):
        city = await get_city(db, body.city)
        proposed = body.model_dump(
            mode="json",
            by_alias=True,
            exclude={"kind", "city", "trace_id", "photo_id", "geometry_source"},
        )
        diff = {field: {"from": None, "to": value} for field, value in proposed.items()}
    elif isinstance(body, UpdateStop):
        stop = await stored_stop(db, body.stop)
        stop_id = stop.id
        city_row = await db.get(City, stop.city_id)
        if city_row is None:
            raise ProblemError("city.not_found", 404)
        city = city_row
        diff = compute_diff(
            {"name": stop.name, "location": point_coordinates(stop.location), "kind": stop.kind},
            body.changes.model_dump(
                mode="json",
                exclude_unset=True,
            ),
        )
    else:
        line = await stored_line(db, body.line)
        line_id = line.id
        city_row = await db.get(City, line.city_id)
        if city_row is None:
            raise ProblemError("city.not_found", 404)
        city = city_row
        version = await current_version(db, line)
        if isinstance(body, UpdateLine):
            proposed = body.changes.model_dump(
                mode="json",
                exclude_unset=True,
                exclude={"trace_id", "geometry_source"},
            )
        elif isinstance(body, FareUpdate):
            proposed = {"fare_minor": body.fare_minor}
        else:
            proposed = {"status": "retired"}
        current = version_values(line, version)
        current["status"] = line.status
        diff = compute_diff(current, proposed)
    if isinstance(body, NewLine):
        await validate_city_data(db, city, body.geometry, body.stop_ids)
    elif isinstance(body, UpdateLine):
        await validate_city_data(db, city, body.changes.geometry, body.changes.stop_ids)
    elif isinstance(body, NewStop):
        await validate_city_data(db, city, [body.location], None)
    elif isinstance(body, UpdateStop) and body.changes.location is not None:
        await validate_city_data(db, city, [body.changes.location], None)
    return city, line_id, stop_id, diff


async def edit_response(db: AsyncSession, edit: Edit) -> EditOut:
    city = await db.get(City, edit.city_id)
    if city is None:
        raise ProblemError("city.not_found", 404)
    return EditOut(
        id=edit.id,
        kind=edit.kind,
        state=edit.state,
        payload=edit.payload,
        diff=edit.diff,
        reason=edit.reason,
        created_at=edit.created_at,
        reviewed_at=edit.reviewed_at,
        city=city.slug,
    )
