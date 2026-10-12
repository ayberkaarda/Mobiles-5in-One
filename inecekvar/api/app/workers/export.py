import inspect
import json
from collections.abc import Awaitable, Callable
from typing import cast

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import Clock
from app.core.errors import ProblemError
from app.core.settings import Settings
from app.core.storage import ObjectStore
from app.export.dataset import city_dataset
from app.models.geo import City, Line, LineVersion, Stop
from app.models.ops import Export

LICENCE = "CC BY 4.0 proposed; legal approval pending; no licence granted yet."


async def export_city(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    clock: Clock,
    city_slug: str,
    before_commit: Callable[[AsyncSession, Export], Awaitable[None] | None] | None = None,
) -> Export:
    async with session_factory() as db:
        try:
            city = await db.scalar(
                select(City).where(City.slug == city_slug).with_for_update(nowait=True)
            )
        except DBAPIError as exc:
            if getattr(exc.orig, "sqlstate", None) == "55P03":
                raise ProblemError("export.in_progress", 409) from None
            raise
        if city is None:
            raise ProblemError("city.not_found", 404)
        line_count = await db.scalar(
            select(func.count())
            .select_from(Line)
            .join(LineVersion, Line.current_version_id == LineVersion.id)
            .where(Line.city_id == city.id, Line.status == "published")
        )
        stop_count = await db.scalar(
            select(func.count())
            .select_from(Stop)
            .where(Stop.city_id == city.id, Stop.status == "active")
        )
        if (line_count or 0) + (stop_count or 0) > settings.export_max_features:
            raise ProblemError("export.too_large", 422)
        previous = await db.scalar(
            select(func.max(Export.version)).where(Export.city_id == city.id)
        )
        version = (previous or 0) + 1
        dataset = await city_dataset(db, city)
        features: list[dict[str, object]] = []
        for collection, kind, coordinate_key in (
            ("lines", "LineString", "geometry"),
            ("stops", "Point", "location"),
        ):
            for item in cast(list[dict[str, object]], dataset[collection]):
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": kind, "coordinates": item[coordinate_key]},
                        "properties": {
                            key: value for key, value in item.items() if key != coordinate_key
                        },
                    }
                )
        now = clock.now()
        body = {
            "type": "FeatureCollection",
            "features": features,
            "licence": LICENCE,
            "attribution": "İnecek Var katkıcıları",
            "city": dataset["city"],
            "exported_at": now.isoformat(),
            "version": version,
        }
        path = "exports/" + city.slug + "/" + str(version) + ".geojson"
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        if len(encoded) > settings.export_max_bytes:
            raise ProblemError("export.too_large", 422)
        await store.put(
            settings.exports_bucket,
            path,
            encoded,
            "application/geo+json",
        )
        export = Export(
            city_id=city.id,
            version=version,
            path=path,
            published_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(export)
        if before_commit is not None:
            result = before_commit(db, export)
            if inspect.isawaitable(result):
                await result
        await db.commit()
        await db.refresh(export)
        db.expunge(export)
        return export


async def export_all_cities(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    clock: Clock,
) -> list[Export]:
    async with session_factory() as db:
        slugs = list(await db.scalars(select(City.slug).order_by(City.slug)))
    exports: list[Export] = []
    for slug in slugs:
        try:
            exports.append(await export_city(session_factory, store, settings, clock, slug))
        except ProblemError as exc:
            if exc.code not in {"export.in_progress", "export.too_large"}:
                raise
            structlog.get_logger().info("export.skipped", city=slug, code=exc.code)
    return exports
