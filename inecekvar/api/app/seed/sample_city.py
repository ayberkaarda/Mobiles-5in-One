from dataclasses import dataclass
from datetime import UTC, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import LineString, Point, Polygon
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import City, Line, LineStop, LineVersion, Stop
from app.models.enums import LineMode, LineStatus, StopKind

CITY_SLUG = "ornek-test-sehri"
ROUTES = (
    ("ORN-1", "ornek-hat-1", LineMode.DOLMUS, 2500, ((1, 1), (1, 2), (1, 3), (1, 4), (1, 5))),
    ("ORN-2", "ornek-hat-2", LineMode.MINIBUS, 3000, ((3, 1), (3, 2), (3, 3), (3, 4), (3, 5))),
    ("ORN-3", "ornek-hat-3", LineMode.SERVIS, 0, ((1, 5), (2, 5), (3, 5), (4, 5))),
)


@dataclass(frozen=True)
class SeedSummary:
    created: int
    existing: int


def stop_point(row: int, col: int) -> Point:
    return Point(34.01 + (col - 1) * 0.02, 42.51 + (row - 1) * 0.02)


async def seed_sample_city(session: AsyncSession) -> SeedSummary:
    """Stage a synthetic sample; the caller owns the transaction."""
    created = 0
    existing = 0
    city = await session.scalar(select(City).where(City.slug == CITY_SLUG))
    if city is None:
        city = City(
            name="[ÖRNEK] Test Şehri",
            slug=CITY_SLUG,
            bbox=from_shape(
                Polygon(((34.00, 42.50), (34.10, 42.50), (34.10, 42.58), (34.00, 42.58))),
                srid=4326,
            ),
            centroid=from_shape(Point(34.05, 42.54), srid=4326),
            timezone="Europe/Istanbul",
            is_sample=True,
        )
        session.add(city)
        await session.flush()
        created += 1
    else:
        existing += 1

    stops: dict[tuple[int, int], Stop] = {}
    for row in range(1, 5):
        for col in range(1, 6):
            slug = f"ornek-durak-{row}-{col}"
            stop = await session.scalar(
                select(Stop).where(Stop.city_id == city.id, Stop.slug == slug)
            )
            if stop is None:
                stop = Stop(
                    city_id=city.id,
                    name=f"[ÖRNEK] Durak {row}-{col}",
                    slug=slug,
                    location=from_shape(stop_point(row, col), srid=4326),
                    kind=StopKind.INFORMAL if (row, col) in {(2, 2), (4, 4)} else StopKind.FORMAL,
                )
                session.add(stop)
                await session.flush()
                created += 1
            else:
                existing += 1
            stops[row, col] = stop

    for code, slug, mode, fare, positions in ROUTES:
        line = await session.scalar(select(Line).where(Line.city_id == city.id, Line.slug == slug))
        if line is None:
            line = Line(
                city_id=city.id,
                code=code,
                name=f"[ÖRNEK] Hat {code}",
                slug=slug,
                mode=mode,
                status=LineStatus.DRAFT,
            )
            session.add(line)
            await session.flush()
            created += 1
        else:
            existing += 1

        version = await session.scalar(
            select(LineVersion).where(LineVersion.line_id == line.id, LineVersion.version_no == 1)
        )
        if version is None:
            version = LineVersion(
                line_id=line.id,
                version_no=1,
                geom=from_shape(
                    LineString([stop_point(*position) for position in positions]),
                    srid=4326,
                ),
                fare_minor=fare,
                hours_text="[ÖRNEK] 06:00-23:00",
                payment_methods=["nakit"] if mode != LineMode.SERVIS else [],
                stop_ids=[str(stops[position].id) for position in positions],
                published_by=None,
                published_at=datetime.now(UTC),
            )
            session.add(version)
            await session.flush()
            created += 1
            for seq, position in enumerate(positions):
                session.add(
                    LineStop(line_version_id=version.id, stop_id=stops[position].id, seq=seq)
                )
                created += 1
            await session.flush()
        else:
            existing += 1
            existing += int(
                await session.scalar(
                    select(func.count())
                    .select_from(LineStop)
                    .where(LineStop.line_version_id == version.id)
                )
                or 0
            )
        if line.current_version_id != version.id:
            line.current_version_id = version.id
            line.status = LineStatus.PUBLISHED
    await session.flush()
    return SeedSummary(created=created, existing=existing)
