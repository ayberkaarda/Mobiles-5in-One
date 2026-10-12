import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core.deps import DbDep
from app.core.errors import ProblemError
from app.geo import bbox_bounds, point_coordinates
from app.lines.schemas import LineSummary, summary
from app.models import City, Line, LineStop, LineVersion, Stop
from app.models.accounts import Favorite

router = APIRouter()


class CityOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    slug: str
    is_sample: bool
    bbox: list[float]
    centroid: list[float]
    timezone: str
    pack_version: int
    published_line_count: int


class RecentLineOut(LineSummary):
    model_config = ConfigDict(extra="forbid")
    updated_at: datetime


class CityDetailOut(CityOut):
    model_config = ConfigDict(extra="forbid")
    recently_updated_lines: list[RecentLineOut]
    popular_lines: list[LineSummary]
    lastmod: datetime | None


class StopRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    name: str


class StopPairOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_stop: StopRef
    to_stop: StopRef
    shared_line_count: int


class StopPairsOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: str
    basis: Literal["shared_published_lines"]
    pairs: list[StopPairOut]


async def published_lastmod(db: DbDep, city_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    if not city_ids:
        return {}
    rows = await db.execute(
        select(Line.city_id, func.max(LineVersion.published_at))
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(Line.city_id.in_(city_ids), Line.status == "published")
        .group_by(Line.city_id)
    )
    return {city_id: published_at for city_id, published_at in rows}


async def city_response(db: DbDep, city: City) -> CityOut:
    count = await db.scalar(
        select(func.count())
        .select_from(Line)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(
            Line.city_id == city.id,
            Line.status == "published",
        )
    )
    return CityOut(
        name=city.name,
        slug=city.slug,
        is_sample=city.is_sample,
        bbox=bbox_bounds(city.bbox),
        centroid=point_coordinates(city.centroid),
        timezone=city.timezone,
        pack_version=city.pack_version,
        published_line_count=int(count or 0),
    )


async def get_city(db: DbDep, slug: str) -> City:
    city = await db.scalar(select(City).where(City.slug == slug))
    if city is None:
        raise ProblemError("city.not_found", 404)
    return city


@router.get("/cities")
async def list_cities(db: DbDep) -> list[CityOut]:
    cities = await db.scalars(select(City).order_by(City.name, City.id))
    return [await city_response(db, city) for city in cities]


@router.get("/cities/{slug}")
async def read_city(slug: str, db: DbDep) -> CityDetailOut:
    city = await get_city(db, slug)
    base = await city_response(db, city)
    recent = await db.execute(
        select(Line, LineVersion.published_at)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(Line.city_id == city.id, Line.status == "published")
        .order_by(LineVersion.published_at.desc(), Line.code, Line.id)
        .limit(10)
    )
    popular = await db.scalars(
        select(Line)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .outerjoin(Favorite, Favorite.line_id == Line.id)
        .where(Line.city_id == city.id, Line.status == "published")
        .group_by(Line.id)
        .order_by(func.count(Favorite.user_id).desc(), Line.code, Line.id)
        .limit(10)
    )
    lastmods = await published_lastmod(db, [city.id])
    return CityDetailOut(
        **base.model_dump(),
        recently_updated_lines=[
            RecentLineOut(**summary(line).model_dump(), updated_at=published_at)
            for line, published_at in recent
        ],
        popular_lines=[summary(line) for line in popular],
        lastmod=lastmods.get(city.id),
    )


@router.get("/cities/{slug}/stop-pairs")
async def stop_pairs(
    slug: str, db: DbDep, limit: Annotated[int, Query(ge=1, le=200)] = 200
) -> StopPairsOut:
    city = await get_city(db, slug)
    from_membership = aliased(LineStop)
    to_membership = aliased(LineStop)
    from_stop = aliased(Stop)
    to_stop = aliased(Stop)
    shared_lines = (
        select(
            from_stop.slug.label("from_slug"),
            from_stop.name.label("from_name"),
            to_stop.slug.label("to_slug"),
            to_stop.name.label("to_name"),
            Line.id.label("line_id"),
        )
        .select_from(Line)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .join(from_membership, from_membership.line_version_id == LineVersion.id)
        .join(to_membership, to_membership.line_version_id == from_membership.line_version_id)
        .join(from_stop, from_stop.id == from_membership.stop_id)
        .join(to_stop, to_stop.id == to_membership.stop_id)
        .where(
            Line.city_id == city.id,
            Line.status == "published",
            from_stop.city_id == city.id,
            to_stop.city_id == city.id,
            from_stop.status == "active",
            to_stop.status == "active",
            from_stop.slug < to_stop.slug,
        )
        .distinct()
        .subquery()
    )
    favorites = (
        select(Favorite.line_id, func.count().label("favorite_count"))
        .group_by(Favorite.line_id)
        .subquery()
    )
    shared_count = func.count(func.distinct(shared_lines.c.line_id))
    favorite_sum = func.sum(func.coalesce(favorites.c.favorite_count, 0))
    rows = await db.execute(
        select(
            shared_lines.c.from_slug,
            shared_lines.c.from_name,
            shared_lines.c.to_slug,
            shared_lines.c.to_name,
            shared_count,
        )
        .outerjoin(favorites, favorites.c.line_id == shared_lines.c.line_id)
        .group_by(
            shared_lines.c.from_slug,
            shared_lines.c.from_name,
            shared_lines.c.to_slug,
            shared_lines.c.to_name,
        )
        .order_by(
            shared_count.desc(),
            favorite_sum.desc(),
            shared_lines.c.from_slug,
            shared_lines.c.to_slug,
        )
        .limit(limit)
    )
    return StopPairsOut(
        city=city.slug,
        basis="shared_published_lines",
        pairs=[
            StopPairOut(
                from_stop=StopRef(slug=from_slug, name=from_name),
                to_stop=StopRef(slug=to_slug, name=to_name),
                shared_line_count=shared_line_count,
            )
            for from_slug, from_name, to_slug, to_name, shared_line_count in rows
        ],
    )
