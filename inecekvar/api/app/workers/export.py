import json
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import Clock
from app.core.errors import ProblemError
from app.core.settings import Settings
from app.core.storage import ObjectStore
from app.export.dataset import city_dataset
from app.models.geo import City
from app.models.ops import Export

LICENCE = "CC BY 4.0 proposed; legal approval pending; no licence granted yet."


async def export_city(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    settings: Settings,
    clock: Clock,
    city_slug: str,
) -> Export:
    async with session_factory() as db:
        city = await db.scalar(select(City).where(City.slug == city_slug).with_for_update())
        if city is None:
            raise ProblemError("city.not_found", 404)
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
        await store.put(
            settings.exports_bucket,
            path,
            json.dumps(body, ensure_ascii=False, allow_nan=False).encode(),
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
    return [await export_city(session_factory, store, settings, clock, slug) for slug in slugs]
