from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.geo import bbox_bounds, line_geojson, point_coordinates
from app.models.geo import City, Line, LineStop, LineVersion, Stop


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


async def city_dataset(db: AsyncSession, city: City) -> dict[str, object]:
    rows = await db.execute(
        select(Line, LineVersion)
        .join(LineVersion, Line.current_version_id == LineVersion.id)
        .where(Line.city_id == city.id, Line.status == "published")
        .order_by(Line.slug)
    )
    lines: list[dict[str, object]] = []
    for line, version in rows:
        slugs = list(
            await db.scalars(
                select(Stop.slug)
                .join(LineStop, LineStop.stop_id == Stop.id)
                .where(LineStop.line_version_id == version.id)
                .order_by(LineStop.seq)
            )
        )
        lines.append(
            {
                "slug": line.slug,
                "code": line.code,
                "name": line.name,
                "mode": line.mode,
                "version_no": version.version_no,
                "published_at": iso(version.published_at),
                "geometry": line_geojson(version.geom)["coordinates"],
                "stops": slugs,
                "fare_minor": version.fare_minor,
                "fare_updated_at": iso(version.fare_updated_at),
                "hours_text": version.hours_text,
                "payment_methods": version.payment_methods,
                "hail_notes": version.hail_notes,
                "last_verified_at": iso(line.last_verified_at),
                "contributor_count": line.contributor_count,
            }
        )
    stops = await db.scalars(
        select(Stop).where(Stop.city_id == city.id, Stop.status == "active").order_by(Stop.slug)
    )
    return {
        "city": {
            "name": city.name,
            "slug": city.slug,
            "is_sample": city.is_sample,
            "bbox": bbox_bounds(city.bbox),
            "centroid": point_coordinates(city.centroid),
            "timezone": city.timezone,
        },
        "pack_version": city.pack_version,
        "format": 1,
        "lines": lines,
        "stops": [
            {
                "slug": stop.slug,
                "name": stop.name,
                "kind": stop.kind,
                "location": point_coordinates(stop.location),
            }
            for stop in stops
        ],
    }
