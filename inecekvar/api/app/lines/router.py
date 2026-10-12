import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.cities.router import get_city
from app.core.deps import DbDep
from app.core.errors import ProblemError
from app.geo import GeoJSONLineString, line_geojson, point_coordinates
from app.models import Line, LineStop, LineVersion, Stop

router = APIRouter()
type Limit = Annotated[int, Query(ge=1, le=100)]
type Offset = Annotated[int, Query(ge=0, le=100000)]


class LineSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    code: str
    name: str
    mode: str


class StopOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    slug: str
    name: str
    kind: str
    location: list[float]


class LineListOut(LineSummary):
    id: uuid.UUID


class LineOut(LineSummary):
    id: uuid.UUID
    status: str
    version_no: int
    published_at: datetime
    geometry: GeoJSONLineString
    stops: list[StopOut]
    fare_minor: int | None
    fare_updated_at: datetime | None
    hours_text: str | None
    payment_methods: list[str]
    hail_notes: str | None
    last_verified_at: datetime | None
    contributor_count: int


class VersionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_no: int
    published_at: datetime
    fare_minor: int | None
    stop_count: int


def summary(line: Line) -> LineSummary:
    return LineSummary(slug=line.slug, code=line.code, name=line.name, mode=line.mode)


def stop_response(stop: Stop) -> StopOut:
    return StopOut(
        id=stop.id,
        slug=stop.slug,
        name=stop.name,
        kind=stop.kind,
        location=point_coordinates(stop.location),
    )


async def public_line(db: DbDep, slug: str, city: str) -> Line:
    stored_city = await get_city(db, city)
    line = await db.scalar(
        select(Line).where(
            Line.city_id == stored_city.id,
            Line.slug == slug,
            Line.status != "draft",
        )
    )
    if line is None:
        raise ProblemError("line.not_found", 404)
    return line


async def current_version(db: DbDep, line: Line) -> LineVersion:
    version = (
        await db.get(LineVersion, line.current_version_id) if line.current_version_id else None
    )
    if version is None:
        raise ProblemError("line.not_found", 404)
    return version


@router.get("/lines")
async def list_lines(
    db: DbDep,
    city: str,
    q: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[LineListOut]:
    stored_city = await get_city(db, city)
    query = select(Line).where(Line.city_id == stored_city.id, Line.status == "published")
    if q is not None:
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(
            Line.code.ilike(pattern, escape="\\") | Line.name.ilike(pattern, escape="\\")
        )
    rows = await db.scalars(query.order_by(Line.code, Line.id).limit(limit).offset(offset))
    return [LineListOut(id=line.id, **summary(line).model_dump()) for line in rows]


@router.get("/lines/{slug}")
async def read_line(slug: str, city: str, db: DbDep) -> LineOut:
    line = await public_line(db, slug, city)
    version = await current_version(db, line)
    stops = await db.scalars(
        select(Stop)
        .join(LineStop, Stop.id == LineStop.stop_id)
        .where(
            LineStop.line_version_id == version.id,
        )
        .order_by(LineStop.seq)
    )
    return LineOut(
        id=line.id,
        slug=line.slug,
        code=line.code,
        name=line.name,
        mode=line.mode,
        status=line.status,
        version_no=version.version_no,
        published_at=version.published_at,
        geometry=line_geojson(version.geom),
        stops=[stop_response(stop) for stop in stops],
        fare_minor=version.fare_minor,
        fare_updated_at=version.fare_updated_at,
        hours_text=version.hours_text,
        payment_methods=version.payment_methods,
        hail_notes=version.hail_notes,
        last_verified_at=line.last_verified_at,
        contributor_count=line.contributor_count,
    )


@router.get("/lines/{slug}/versions")
async def list_versions(slug: str, city: str, db: DbDep) -> list[VersionOut]:
    line = await public_line(db, slug, city)
    rows = await db.scalars(
        select(LineVersion)
        .where(LineVersion.line_id == line.id)
        .order_by(
            LineVersion.version_no.desc(),
        )
    )
    return [
        VersionOut(
            version_no=row.version_no,
            published_at=row.published_at,
            fare_minor=row.fare_minor,
            stop_count=len(row.stop_ids),
        )
        for row in rows
    ]
