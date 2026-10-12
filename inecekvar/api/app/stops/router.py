from typing import Annotated

from fastapi import APIRouter, Query
from geoalchemy2 import Geography
from sqlalchemy import func, select

from app.cities.router import get_city
from app.core.deps import DbDep
from app.core.errors import ProblemError
from app.lines.router import LineSummary, StopOut, stop_response, summary
from app.models import Line, LineStop, Stop

router = APIRouter()


class StopDetail(StopOut):
    lines: list[LineSummary]


@router.get("/stops/near")
async def near_stops(
    db: DbDep,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    radius: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> list[StopOut]:
    point = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326).cast(Geography)
    rows = await db.scalars(
        select(Stop)
        .where(
            Stop.status == "active",
            func.ST_DWithin(Stop.location, point, radius),
        )
        .order_by(func.ST_Distance(Stop.location, point), Stop.id)
        .limit(50)
    )
    return [stop_response(stop) for stop in rows]


@router.get("/stops/{slug}")
async def read_stop(slug: str, city: str, db: DbDep) -> StopDetail:
    stored_city = await get_city(db, city)
    stop = await db.scalar(
        select(Stop).where(
            Stop.city_id == stored_city.id,
            Stop.slug == slug,
            Stop.status == "active",
        )
    )
    if stop is None:
        raise ProblemError("stop.not_found", 404)
    lines = await db.scalars(
        select(Line)
        .join(
            LineStop,
            LineStop.line_version_id == Line.current_version_id,
        )
        .where(LineStop.stop_id == stop.id, Line.status == "published")
        .distinct()
        .order_by(Line.code)
    )
    return StopDetail(**stop_response(stop).model_dump(), lines=[summary(line) for line in lines])
