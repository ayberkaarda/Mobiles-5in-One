from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.core.deps import DbDep
from app.core.errors import ProblemError
from app.geo import bbox_bounds, point_coordinates
from app.models import City, Line

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


async def city_response(db: DbDep, city: City) -> CityOut:
    count = await db.scalar(
        select(func.count())
        .select_from(Line)
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
async def read_city(slug: str, db: DbDep) -> CityOut:
    return await city_response(db, await get_city(db, slug))
