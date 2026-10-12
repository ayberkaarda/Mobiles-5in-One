import json

import httpx
import pytest
from sqlalchemy import select

from app.core.deps import Services
from app.models.geo import Line, LineStop, LineVersion, Stop
from app.models.ops import Export
from app.workers.export import LICENCE, export_all_cities, export_city
from tests.domain.conftest import Sample
from tests.privacy.test_public_responses import PUBLIC_PROBES
from tests.support.privacy import assert_no_trace_leak
from tests.support.storage import S3Buckets
from tests.traces.test_traces import RAW

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"
LATEST = "/v1/export/" + CITY + "/latest.geojson"


def configure_store(services: Services, buckets: S3Buckets) -> None:
    services.object_store = buckets.store
    services.settings = services.settings.model_copy(update=buckets.settings_overrides())


async def test_export_sample_city_geojson(
    services: Services, sample: Sample, s3_buckets: S3Buckets
) -> None:
    configure_store(services, s3_buckets)
    first = await export_city(
        services.session_factory, s3_buckets.store, services.settings, services.clock, CITY
    )
    assert first.version == 1
    assert first.path == "exports/" + CITY + "/1.geojson"
    body = json.loads(await s3_buckets.store.get(s3_buckets.exports_bucket, first.path, 50_000_000))
    assert body["type"] == "FeatureCollection"
    assert sum(item["geometry"]["type"] == "LineString" for item in body["features"]) == 3
    assert sum(item["geometry"]["type"] == "Point" for item in body["features"]) == 20
    assert body["licence"] == LICENCE
    assert "no licence granted" in body["licence"]
    assert body["attribution"] == "İnecek Var katkıcıları"
    assert_no_trace_leak(body, RAW)
    stored = await s3_buckets.store.head(s3_buckets.exports_bucket, first.path)
    assert stored is not None
    assert stored.content_type == "application/geo+json"
    second = await export_all_cities(
        services.session_factory, s3_buckets.store, services.settings, services.clock
    )
    assert [item.version for item in second] == [2]
    async with services.session_factory() as db:
        rows = list(await db.scalars(select(Export).order_by(Export.version)))
        assert [item.version for item in rows] == [1, 2]


async def test_latest_geojson_served_publicly(
    client: httpx.AsyncClient, services: Services, sample: Sample, s3_buckets: S3Buckets
) -> None:
    configure_store(services, s3_buckets)
    for _ in range(2):
        await export_city(
            services.session_factory, s3_buckets.store, services.settings, services.clock, CITY
        )
    response = await client.get(LATEST)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/geo+json"
    assert response.json()["version"] == 2
    assert_no_trace_leak(response.json(), RAW)


async def test_latest_geojson_404_without_export(
    client: httpx.AsyncClient, services: Services, sample: Sample, s3_buckets: S3Buckets
) -> None:
    configure_store(services, s3_buckets)
    assert (await client.get(LATEST)).status_code == 404


async def test_public_export_probes_have_no_trace_data(
    client: httpx.AsyncClient, services: Services, sample: Sample, s3_buckets: S3Buckets
) -> None:
    configure_store(services, s3_buckets)
    await export_city(
        services.session_factory, s3_buckets.store, services.settings, services.clock, CITY
    )
    signatures = (
        ("GET", "/v1/cities/{slug}/pack"),
        ("GET", "/v1/cities/{slug}/tiles.pmtiles"),
        ("GET", "/v1/export/{city}/latest.geojson"),
        ("GET", "/v1/cities/{slug}/sitemap"),
    )
    for signature in signatures:
        probe = PUBLIC_PROBES[signature]
        response = await client.send(probe.request(client, signature[0]))
        assert response.status_code == probe.status
        assert_no_trace_leak(response.json(), RAW)


async def test_sitemap_lastmod(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    async with services.session_factory() as db:
        line = await db.get(Line, sample.line_id)
        assert line is not None
        version = await db.get(LineVersion, line.current_version_id)
        assert version is not None
        expected = version.published_at.isoformat()
        stop_slug = await db.scalar(
            select(Stop.slug)
            .join(LineStop, Stop.id == LineStop.stop_id)
            .where(LineStop.line_version_id == version.id)
            .order_by(LineStop.seq)
            .limit(1)
        )
        orphan = Stop(
            city_id=sample.city_id,
            slug="bagimsiz-durak",
            name="[ÖRNEK] Bağımsız durak",
            location="SRID=4326;POINT(34.01 42.51)",
            kind="formal",
            status="active",
            updated_at=services.clock.now(),
        )
        db.add(orphan)
        await db.commit()
    response = await client.get("/v1/cities/" + CITY + "/sitemap")
    assert response.status_code == 200
    body = response.json()
    assert body["city"] == CITY
    assert next(item["lastmod"] for item in body["lines"] if item["slug"] == line.slug) == expected
    assert next(item["lastmod"] for item in body["stops"] if item["slug"] == stop_slug) == expected
    assert (
        next(item["lastmod"] for item in body["stops"] if item["slug"] == "bagimsiz-durak")
        == services.clock.now().isoformat()
    )
