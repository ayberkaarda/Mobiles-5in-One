import uuid

import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, Polygon
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Services
from app.core.ids import uuid7
from app.models import City, Stop
from tests.domain.conftest import Sample

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"
INJECTION_INPUTS = (
    "%",
    "_",
    "\\",
    "' OR '1'='1",
    "%' OR 1=1 --",
    "x'); DROP TABLE stops; --",
)


def add_stop(
    db: AsyncSession, city_id: uuid.UUID, name: str, *, status: str = "active"
) -> uuid.UUID:
    identity = uuid7()
    db.add(
        Stop(
            id=identity,
            city_id=city_id,
            name=name,
            slug="search-" + identity.hex,
            location=from_shape(Point(34.05, 42.54), srid=4326),
            kind="formal",
            status=status,
        )
    )
    return identity


@pytest.mark.parametrize("query", ["durak", "DURAK", "  DuRaK  ", "rak 1-1"])
async def test_search_substrings_ignore_case(
    client: httpx.AsyncClient, sample: Sample, services: Services, query: str
) -> None:
    response = await client.get("/v1/stops", params={"city": CITY, "q": query, "limit": 50})
    assert response.status_code == 200, response.text
    async with services.session_factory() as db:
        stops = list(await db.scalars(select(Stop).where(Stop.city_id == sample.city_id)))
    expected = {str(stop.id) for stop in stops if query.strip().lower() in stop.name.lower()}
    assert {item["id"] for item in response.json()} == expected
    assert expected
    assert all(set(item) == {"id", "slug", "name", "kind", "location"} for item in response.json())


@pytest.mark.parametrize(
    ("params", "status", "code"),
    [
        ({}, 422, "validation.failed"),
        ({"city": "missing"}, 404, "city.not_found"),
        ({"city": CITY, "q": "x" * 65}, 422, "validation.failed"),
        ({"city": CITY, "q": ""}, 422, "validation.failed"),
        ({"city": CITY, "limit": "51"}, 422, "validation.failed"),
        ({"city": CITY, "limit": "0"}, 422, "validation.failed"),
    ],
)
async def test_search_bounds(
    client: httpx.AsyncClient, sample: Sample, params: dict[str, str], status: int, code: str
) -> None:
    response = await client.get("/v1/stops", params=params)
    assert response.status_code == status, response.text
    assert response.json()["code"] == code


async def test_search_without_term_is_alphabetical(
    client: httpx.AsyncClient, sample: Sample, services: Services
) -> None:
    async with services.session_factory() as db:
        expected = list(
            await db.scalars(
                select(Stop.id)
                .where(Stop.city_id == sample.city_id, Stop.status == "active")
                .order_by(Stop.name, Stop.id)
                .limit(20)
            )
        )
    absent = await client.get("/v1/stops", params={"city": CITY})
    whitespace = await client.get("/v1/stops", params={"city": CITY, "q": "   "})
    assert absent.status_code == whitespace.status_code == 200
    assert [item["id"] for item in absent.json()] == [str(identity) for identity in expected]
    assert whitespace.json() == absent.json()


async def test_search_limit_never_exceeds_fifty(
    client: httpx.AsyncClient, sample: Sample, services: Services
) -> None:
    async with services.session_factory() as db:
        for number in range(60):
            add_stop(db, sample.city_id, f"Search limit {number:02d}")
        await db.commit()
    for query in (None, "Search limit"):
        params = {"city": CITY, "limit": "50"}
        if query is not None:
            params["q"] = query
        response = await client.get("/v1/stops", params=params)
        assert response.status_code == 200
        assert len(response.json()) == 50
    default = await client.get("/v1/stops", params={"city": CITY, "q": "Search limit"})
    assert len(default.json()) == 20


@pytest.mark.parametrize("query", INJECTION_INPUTS)
async def test_search_treats_sql_and_wildcards_literally(
    client: httpx.AsyncClient, sample: Sample, services: Services, query: str
) -> None:
    async with services.session_factory() as db:
        literal = add_stop(db, sample.city_id, "100%_x")
        for name in INJECTION_INPUTS[2:]:
            add_stop(db, sample.city_id, "Literal " + name)
        await db.commit()
        stops = list(await db.scalars(select(Stop).where(Stop.city_id == sample.city_id)))
        count_before = await db.scalar(select(func.count()).select_from(Stop))
    response = await client.get("/v1/stops", params={"city": CITY, "q": query, "limit": 50})
    assert response.status_code == 200, response.text
    expected = {str(stop.id) for stop in stops if query.lower() in stop.name.lower()}
    assert {item["id"] for item in response.json()} == expected
    assert expected
    if query == "_":
        assert expected == {str(literal)}
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Stop)) == count_before


@pytest.mark.parametrize("query", ["%", "_"])
async def test_wildcard_matches_only_the_literal_stop(
    client: httpx.AsyncClient, sample: Sample, services: Services, query: str
) -> None:
    async with services.session_factory() as db:
        literal = add_stop(db, sample.city_id, "100%_x")
        await db.commit()
    response = await client.get("/v1/stops", params={"city": CITY, "q": query})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(literal)]


async def test_search_excludes_other_cities_and_retired_stops(
    client: httpx.AsyncClient, sample: Sample, services: Services
) -> None:
    other_city = uuid7()
    async with services.session_factory() as db:
        db.add(
            City(
                id=other_city,
                name="Other city",
                slug="other-search-city",
                bbox=from_shape(
                    Polygon([(34, 42.5), (34.1, 42.5), (34.1, 42.58), (34, 42.58), (34, 42.5)]),
                    srid=4326,
                ),
                centroid=from_shape(Point(34.05, 42.54), srid=4326),
            )
        )
        await db.flush()
        add_stop(db, other_city, "Durak other city")
        add_stop(db, sample.city_id, "Durak retired", status="retired")
        await db.commit()
    for query in (None, "durak"):
        params = {"city": CITY, "limit": "50"}
        if query is not None:
            params["q"] = query
        response = await client.get("/v1/stops", params=params)
        assert response.status_code == 200
        assert {item["id"] for item in response.json()} == {
            str(identity) for identity in sample.stop_ids
        }


async def test_prefix_matches_sort_first_and_ties_use_id(
    client: httpx.AsyncClient, sample: Sample, services: Services
) -> None:
    async with services.session_factory() as db:
        substring = add_stop(db, sample.city_id, "A searchneedle")
        prefix_one = add_stop(db, sample.city_id, "Searchneedle Z")
        prefix_two = add_stop(db, sample.city_id, "Searchneedle Z")
        prefix_first = add_stop(db, sample.city_id, "Searchneedle A")
        await db.commit()
    response = await client.get("/v1/stops", params={"city": CITY, "q": "searchneedle"})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        str(prefix_first),
        *[str(identity) for identity in sorted((prefix_one, prefix_two))],
        str(substring),
    ]


async def test_search_does_not_shadow_existing_routes(
    client: httpx.AsyncClient, sample: Sample
) -> None:
    nearby = await client.get("/v1/stops/near", params={"lng": 34.01, "lat": 42.51})
    detail = await client.get("/v1/stops/ornek-durak-1-1", params={"city": CITY})
    assert nearby.status_code == detail.status_code == 200
    assert detail.json()["slug"] == "ornek-durak-1-1"
