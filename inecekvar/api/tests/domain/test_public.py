import json

import httpx
import pytest
from sqlalchemy import update

from app.core.deps import Services
from app.core.ids import uuid7
from app.models import Line
from tests.domain.conftest import Sample

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"
DETAIL = "/v1/lines/ornek-hat-1?city=" + CITY


async def test_public_city_line_stop_reads(client: httpx.AsyncClient, sample: Sample) -> None:
    response = await client.get("/v1/cities")
    assert response.status_code == 200
    city = response.json()[0]
    assert city["name"] == "[ÖRNEK] Test Şehri"
    assert city["is_sample"] is True
    assert city["published_line_count"] == 3
    assert city["bbox"] == [34.0, 42.5, 34.1, 42.58]
    assert (await client.get("/v1/cities/" + CITY)).json() == city
    assert len((await client.get("/v1/lines", params={"city": CITY})).json()) == 3
    line = (await client.get(DETAIL)).json()
    assert line["geometry"]["type"] == "LineString"
    assert len(line["stops"]) == 5
    stop = await client.get("/v1/stops/ornek-durak-1-1", params={"city": CITY})
    assert stop.status_code == 200
    assert stop.json()["lines"][0]["slug"] == "ornek-hat-1"
    versions = await client.get("/v1/lines/ornek-hat-1/versions", params={"city": CITY})
    assert versions.json()[0]["version_no"] == 1
    assert versions.json()[0]["stop_count"] == 5


async def test_line_search_escapes_wildcards(
    client: httpx.AsyncClient,
    sample: Sample,
    services: Services,
) -> None:
    async with services.session_factory() as db:
        await db.execute(update(Line).where(Line.id == sample.line_id).values(name="Özel %_ Hat"))
        await db.commit()
    for query in ("%", "_", "%_"):
        response = await client.get("/v1/lines", params={"city": CITY, "q": query})
        assert len(response.json()) == 1
    response = await client.get("/v1/lines", params={"city": CITY, "q": "orn-1"})
    assert response.json()[0]["slug"] == "ornek-hat-1"
    assert (await client.get("/v1/lines", params={"city": CITY, "q": ""})).status_code == 422


async def test_draft_line_is_404(
    client: httpx.AsyncClient,
    sample: Sample,
    services: Services,
) -> None:
    async with services.session_factory() as db:
        db.add(
            Line(
                id=uuid7(),
                city_id=sample.city_id,
                code="T",
                name="Taslak",
                slug="taslak",
                mode="dolmus",
                status="draft",
            )
        )
        await db.commit()
    assert (await client.get("/v1/lines/taslak", params={"city": CITY})).status_code == 404
    assert (await client.get("/v1/lines/taslak/versions", params={"city": CITY})).status_code == 404


async def test_stops_near_orders_by_distance_and_bounds_radius(
    client: httpx.AsyncClient,
    sample: Sample,
) -> None:
    response = await client.get(
        "/v1/stops/near",
        params={
            "lat": 42.51,
            "lng": 34.011,
            "radius": 2000,
        },
    )
    assert response.status_code == 200
    assert [stop["slug"] for stop in response.json()][:2] == [
        "ornek-durak-1-1",
        "ornek-durak-1-2",
    ]
    for radius in (0, 2001):
        assert (
            await client.get(
                "/v1/stops/near",
                params={
                    "lat": 42.51,
                    "lng": 34.01,
                    "radius": radius,
                },
            )
        ).status_code == 422
    for lat, lng in ((91, 34), (42, 181)):
        response = await client.get("/v1/stops/near", params={"lat": lat, "lng": lng})
        assert response.status_code == 422


async def test_public_line_has_no_private_fields(client: httpx.AsyncClient, sample: Sample) -> None:
    for path in (DETAIL, "/v1/lines/ornek-hat-1/versions?city=" + CITY):
        response = await client.get(path)
        assert response.status_code == 200
        rendered = json.dumps(response.json())
        for key in ("source_edit_id", "published_by", "author_id", "email", "payload", "trace"):
            assert key not in rendered


async def test_retired_line_is_only_available_in_detail(
    client: httpx.AsyncClient,
    sample: Sample,
    services: Services,
) -> None:
    async with services.session_factory() as db:
        await db.execute(update(Line).where(Line.id == sample.line_id).values(status="retired"))
        await db.commit()
    assert (await client.get(DETAIL)).json()["status"] == "retired"
    assert len((await client.get("/v1/lines", params={"city": CITY})).json()) == 2
