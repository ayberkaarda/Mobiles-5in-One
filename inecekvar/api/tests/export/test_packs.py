import uuid

import httpx
import pytest
from sqlalchemy import func, select

from app.core.deps import Services
from app.core.ids import uuid7
from app.models.billing import PackDownload
from app.models.geo import City
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.billing import StaticEntitlements
from tests.support.domain import export_app
from tests.support.privacy import assert_no_trace_leak
from tests.traces.test_traces import RAW, upload

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
PACK = "/v1/cities/ornek-test-sehri/pack"


async def second_city(services: Services) -> uuid.UUID:
    async with services.session_factory() as db:
        original = await db.scalar(select(City).where(City.slug == "ornek-test-sehri"))
        assert original is not None
        identity = uuid7()
        db.add(
            City(
                id=identity,
                name="[ÖRNEK] İkinci Şehir",
                slug="ikinci-sehir",
                bbox=original.bbox,
                centroid=original.centroid,
                is_sample=True,
            )
        )
        await db.commit()
        return identity


async def test_first_city_pack_is_free_anonymous(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    for _ in range(2):
        response = await client.get(PACK)
        assert response.status_code == 200
        assert response.json()["format"] == 1
        assert len(response.json()["lines"]) == 3
        assert len(response.json()["stops"]) == 20
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(PackDownload)) == 1


async def test_second_city_needs_entitlement(
    client: httpx.AsyncClient, services: Services, sample: Sample, user: Account
) -> None:
    await second_city(services)
    for headers in ({}, user.headers):
        assert (await client.get(PACK, headers=headers)).status_code == 200
        result = await client.get("/v1/cities/ikinci-sehir/pack", headers=headers)
        assert result.status_code == 403
        assert result.json()["code"] == "pack.entitlement_required"
    services.entitlements = StaticEntitlements({user.identity})
    assert (
        await client.get("/v1/cities/ikinci-sehir/pack", headers=user.headers)
    ).status_code == 200
    assert (await client.get("/v1/cities/ikinci-sehir/pack")).status_code == 403


async def test_pack_download_rate_limit_per_anon_hash(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    for _ in range(10):
        assert (await client.get(PACK)).status_code == 200
    assert (await client.get(PACK)).status_code == 429
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=export_app(services), client=("203.0.113.11", 50000)),
        base_url="https://testserver",
        headers={"X-Pack-Request": "1"},
    ) as other:
        assert (await other.get(PACK)).status_code == 200


async def test_pack_anon_hash_not_raw_ip(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    assert (await client.get(PACK)).status_code == 200
    async with services.session_factory() as db:
        digest = await db.scalar(select(PackDownload.anon_hash))
        assert digest is not None
        assert len(digest) == 32
        assert digest != b"203.0.113.10"


async def test_pack_has_no_trace_data(
    client: httpx.AsyncClient, sample: Sample, contributor: Account, clock: FixedClock
) -> None:
    await upload(client, contributor, clock)
    response = await client.get(PACK)
    assert response.status_code == 200
    assert_no_trace_leak(response.json(), RAW)


async def test_tiles_redirect_only_when_configured(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    path = "/v1/cities/ornek-test-sehri/tiles.pmtiles"
    response = await client.get(path)
    assert response.status_code == 404
    assert response.json()["code"] == "tiles.not_configured"
    services.settings = services.settings.model_copy(
        update={"pmtiles_base_url": "https://tiles.example.com"}
    )
    response = await client.get(path)
    assert response.status_code == 302
    assert response.headers["location"] == "https://tiles.example.com/ornek-test-sehri.pmtiles"
    assert (await client.get("/v1/cities/missing/tiles.pmtiles")).status_code == 404


async def test_pack_requires_request_header(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    response = await client.get(PACK, headers={"X-Pack-Request": "0"})
    assert response.status_code == 400
    assert response.json()["code"] == "pack.header_required"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=export_app(services), client=("203.0.113.12", 50000)),
        base_url="https://testserver",
    ) as plain:
        assert (await plain.get(PACK)).status_code == 400
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(PackDownload)) == 0


async def test_signing_in_does_not_grant_another_free_city(
    client: httpx.AsyncClient, services: Services, sample: Sample, user: Account
) -> None:
    await second_city(services)
    assert (await client.get(PACK)).status_code == 200
    response = await client.get("/v1/cities/ikinci-sehir/pack", headers=user.headers)
    assert response.status_code == 403
    assert response.json()["code"] == "pack.entitlement_required"
