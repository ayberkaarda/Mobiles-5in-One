import asyncio
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString, Point, Polygon
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.cities import router as cities_router
from app.cities.router import CityDetailOut, CityOut, StopPairsOut
from app.core.deps import Services
from app.export.router import SitemapIndexOut
from app.models import City, Line, LineStop, LineVersion, Stop
from app.models.accounts import Favorite
from tests.domain.conftest import Sample
from tests.support.app import build_test_app
from tests.support.domain import create_account
from tests.support.privacy import assert_no_trace_leak

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"
CITY_PATH = "/v1/cities/" + CITY
PAIRS_PATH = CITY_PATH + "/stop-pairs"
PUBLISHED_AT = datetime(2020, 1, 1, tzinfo=UTC)


async def add_city(db: AsyncSession, slug: str) -> City:
    city = City(
        slug=slug,
        name=slug,
        bbox=from_shape(
            Polygon(((34.00, 42.50), (34.10, 42.50), (34.10, 42.58), (34.00, 42.58))),
            srid=4326,
        ),
        centroid=from_shape(Point(34.05, 42.54), srid=4326),
        timezone="Europe/Istanbul",
        is_sample=False,
    )
    db.add(city)
    await db.flush()
    return city


async def add_version(
    db: AsyncSession,
    line: Line,
    published_at: datetime,
    stop_ids: Sequence[uuid.UUID] = (),
    *,
    version_no: int = 1,
) -> LineVersion:
    version = LineVersion(
        line_id=line.id,
        version_no=version_no,
        geom=from_shape(LineString(((34.01, 42.51), (34.09, 42.57))), srid=4326),
        published_at=published_at,
        stop_ids=[str(stop_id) for stop_id in stop_ids],
        payment_methods=[],
    )
    db.add(version)
    await db.flush()
    db.add_all(
        LineStop(line_version_id=version.id, stop_id=stop_id, seq=seq)
        for seq, stop_id in enumerate(stop_ids)
    )
    line.current_version_id = version.id
    await db.flush()
    return version


async def add_line(
    db: AsyncSession,
    city_id: uuid.UUID,
    slug: str,
    code: str,
    published_at: datetime,
    stop_ids: Sequence[uuid.UUID] = (),
    *,
    status: str = "published",
) -> Line:
    line = Line(
        city_id=city_id,
        slug=slug,
        code=code,
        name=slug,
        mode="dolmus",
        status="draft",
    )
    db.add(line)
    await db.flush()
    await add_version(db, line, published_at, stop_ids)
    line.status = status
    await db.flush()
    return line


async def test_city_detail_recent_popular_and_current_lastmod(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    first_user, _ = await create_account(services)
    second_user, _ = await create_account(services)
    async with services.session_factory() as db:
        published_at = max(
            await db.scalars(
                select(LineVersion.published_at)
                .join(Line, Line.current_version_id == LineVersion.id)
                .where(Line.city_id == sample.city_id)
            )
        )
        sample_lines = list(
            await db.scalars(select(Line).where(Line.city_id == sample.city_id).order_by(Line.code))
        )
        extras = [
            await add_line(
                db,
                sample.city_id,
                f"page-line-{index}",
                f"P{index // 2:02}",
                published_at + timedelta(days=1 + index // 2),
            )
            for index in range(12)
        ]
        line = await db.get(Line, sample.line_id)
        assert line is not None
        previous = await db.get(LineVersion, line.current_version_id)
        assert previous is not None
        await add_version(
            db, line, published_at + timedelta(days=100), version_no=previous.version_no + 1
        )
        newest = published_at + timedelta(days=10)
        await add_version(db, line, newest, version_no=previous.version_no + 2)
        retired = await add_line(
            db, sample.city_id, "retired-page", "A", newest + timedelta(days=1), status="retired"
        )
        draft = await add_line(
            db, sample.city_id, "draft-page", "B", newest + timedelta(days=2), status="draft"
        )
        db.add_all(
            Favorite(user_id=user_id, line_id=target.id)
            for target, user_ids in (
                (extras[-1], (first_user, second_user)),
                (extras[-2], (first_user,)),
                (retired, (first_user, second_user)),
                (draft, (first_user, second_user)),
            )
            for user_id in user_ids
        )
        await db.commit()

    response = await client.get(CITY_PATH)
    assert response.status_code == 200
    detail = CityDetailOut.model_validate(response.json())
    assert detail.published_line_count == 15
    assert detail.lastmod == newest
    assert len(detail.recently_updated_lines) == 10
    ordered_extras = sorted(
        enumerate(extras), key=lambda item: (-(1 + item[0] // 2), item[1].code, item[1].id)
    )
    assert [item.slug for item in detail.recently_updated_lines] == [line.slug] + [
        item.slug for _, item in ordered_extras[:9]
    ]
    assert detail.recently_updated_lines[0].updated_at == newest
    assert [item.updated_at for item in detail.recently_updated_lines[1:]] == [
        published_at + timedelta(days=1 + index // 2) for index, _ in ordered_extras[:9]
    ]
    zero_favorites = sorted(sample_lines + extras[:-2], key=lambda item: (item.code, item.id))
    assert [item.slug for item in detail.popular_lines] == [extras[-1].slug, extras[-2].slug] + [
        item.slug for item in zero_favorites[:8]
    ]
    assert len(detail.popular_lines) == 10
    body = response.json()
    assert set(body) == set(CityOut.model_fields) | {
        "recently_updated_lines",
        "popular_lines",
        "lastmod",
    }
    assert all(set(item) == {"slug", "code", "name", "mode"} for item in body["popular_lines"])
    assert all(
        set(item) == {"slug", "code", "name", "mode", "updated_at"}
        for item in body["recently_updated_lines"]
    )
    assert_no_trace_leak(body, ())
    cities = await client.get("/v1/cities")
    assert cities.status_code == 200
    assert all(set(item) == set(CityOut.model_fields) for item in cities.json())


async def test_city_without_published_lines(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    async with services.session_factory() as db:
        city = await add_city(db, "empty-city")
        await add_line(db, city.id, "empty-draft", "D", PUBLISHED_AT, status="draft")
        await add_line(db, city.id, "empty-retired", "R", PUBLISHED_AT, status="retired")
        await db.commit()
    response = await client.get("/v1/cities/empty-city")
    assert response.status_code == 200
    detail = CityDetailOut.model_validate(response.json())
    assert detail.published_line_count == 0
    assert detail.lastmod is None
    assert detail.recently_updated_lines == []
    assert detail.popular_lines == []
    pairs = await client.get("/v1/cities/empty-city/stop-pairs")
    assert pairs.status_code == 200
    assert pairs.json() == {"city": "empty-city", "basis": "shared_published_lines", "pairs": []}
    assert (await client.get("/v1/cities/unknown-city")).status_code == 404


async def test_stop_pairs_count_and_rank_shared_current_lines(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    first_user, _ = await create_account(services)
    second_user, _ = await create_account(services)
    async with services.session_factory() as db:
        await db.execute(
            update(Line).where(Line.city_id == sample.city_id).values(status="retired")
        )
        stops = list(
            await db.scalars(select(Stop).where(Stop.city_id == sample.city_id).order_by(Stop.slug))
        )
        a, b, c, d, inactive, retired_only, historical_only = stops[:7]
        inactive.status = "retired"
        first = await add_line(
            db,
            sample.city_id,
            "shared-first",
            "S1",
            PUBLISHED_AT + timedelta(days=100),
            [a.id, b.id, c.id, inactive.id, historical_only.id],
        )
        await add_version(
            db, first, PUBLISHED_AT, [a.id, b.id, c.id, c.id, inactive.id], version_no=2
        )
        await add_line(db, sample.city_id, "shared-second", "S2", PUBLISHED_AT, [a.id, b.id])
        popular = await add_line(
            db, sample.city_id, "popular-pair", "S3", PUBLISHED_AT, [c.id, d.id]
        )
        retired = await add_line(
            db,
            sample.city_id,
            "retired-pair",
            "S4",
            PUBLISHED_AT,
            [a.id, b.id, retired_only.id],
            status="retired",
        )
        await add_line(
            db,
            sample.city_id,
            "draft-pair",
            "S5",
            PUBLISHED_AT,
            [a.id, b.id, retired_only.id],
            status="draft",
        )
        db.add_all(
            [
                Favorite(user_id=first_user, line_id=first.id),
                Favorite(user_id=first_user, line_id=popular.id),
                Favorite(user_id=second_user, line_id=popular.id),
                Favorite(user_id=first_user, line_id=retired.id),
                Favorite(user_id=second_user, line_id=retired.id),
            ]
        )
        await db.commit()

    response = await client.get(PAIRS_PATH)
    assert response.status_code == 200
    body = StopPairsOut.model_validate(response.json())
    assert body.city == CITY
    assert body.basis == "shared_published_lines"
    actual = [
        (pair.from_stop.slug, pair.to_stop.slug, pair.shared_line_count) for pair in body.pairs
    ]
    assert actual == [
        (a.slug, b.slug, 2),
        (c.slug, d.slug, 1),
        (a.slug, c.slug, 1),
        (b.slug, c.slug, 1),
    ]
    names = {stop.slug: stop.name for stop in stops}
    for pair in body.pairs:
        assert pair.from_stop.slug < pair.to_stop.slug
        assert pair.from_stop.name == names[pair.from_stop.slug]
        assert pair.to_stop.name == names[pair.to_stop.slug]
    assert (await client.get(PAIRS_PATH)).json() == response.json()
    limited = await client.get(PAIRS_PATH, params={"limit": 2})
    assert limited.status_code == 200
    assert StopPairsOut.model_validate(limited.json()).pairs == body.pairs[:2]
    assert_no_trace_leak(response.json(), ())


async def test_stop_pairs_limit_bounds_and_unknown_city(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    async with services.session_factory() as db:
        extra_stops = [
            Stop(
                city_id=sample.city_id,
                slug=f"extra-stop-{index}",
                name=f"Extra stop {index}",
                location=from_shape(Point(34.05, 42.54), srid=4326),
                kind="formal",
                status="active",
            )
            for index in range(2)
        ]
        db.add_all(extra_stops)
        await db.flush()
        await add_line(
            db,
            sample.city_id,
            "all-stops",
            "ALL",
            PUBLISHED_AT,
            sample.stop_ids + [stop.id for stop in extra_stops],
        )
        await db.commit()
    response = await client.get(PAIRS_PATH)
    assert response.status_code == 200
    assert len(StopPairsOut.model_validate(response.json()).pairs) == 200
    for limit in (1, 200):
        limited = await client.get(PAIRS_PATH, params={"limit": limit})
        assert limited.status_code == 200
        assert len(StopPairsOut.model_validate(limited.json()).pairs) == limit
    for limit in (0, 201):
        assert (await client.get(PAIRS_PATH, params={"limit": limit})).status_code == 422
    missing = await client.get("/v1/cities/unknown-city/stop-pairs")
    assert missing.status_code == 404
    assert missing.json()["code"] == "city.not_found"


async def test_sitemap_index_current_lastmods_counts_and_flags(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    async with services.session_factory() as db:
        published_at = max(
            await db.scalars(
                select(LineVersion.published_at)
                .join(Line, Line.current_version_id == LineVersion.id)
                .where(Line.city_id == sample.city_id)
            )
        )
        sample_line = await db.get(Line, sample.line_id)
        assert sample_line is not None
        old = await db.get(LineVersion, sample_line.current_version_id)
        assert old is not None
        await add_version(
            db, sample_line, published_at + timedelta(days=100), version_no=old.version_no + 1
        )
        newest = published_at + timedelta(days=10)
        await add_version(db, sample_line, newest, version_no=old.version_no + 2)
        alpha = await add_city(db, "alpha-city")
        zulu = await add_city(db, "zulu-city")
        empty = await add_city(db, "empty-city")
        never_published = await add_city(db, "never-published-city")
        await add_line(db, alpha.id, "alpha-first", "A1", PUBLISHED_AT)
        await add_line(db, alpha.id, "alpha-second", "A2", PUBLISHED_AT + timedelta(days=2))
        await add_line(db, zulu.id, "zulu-first", "Z1", PUBLISHED_AT + timedelta(days=3))
        await add_line(db, empty.id, "retired", "R", newest, status="retired")
        await add_line(db, empty.id, "draft", "D", newest, status="draft")
        await add_line(db, never_published.id, "draft", "D", newest, status="draft")
        await add_line(
            db,
            sample.city_id,
            "retired-newest",
            "R",
            newest + timedelta(days=50),
            status="retired",
        )
        await db.commit()
    response = await client.get("/v1/sitemap")
    assert response.status_code == 200
    body = SitemapIndexOut.model_validate(response.json())
    assert [city.slug for city in body.cities] == [alpha.slug, CITY, zulu.slug]
    assert [city.lastmod for city in body.cities] == [
        PUBLISHED_AT + timedelta(days=2),
        newest,
        PUBLISHED_AT + timedelta(days=3),
    ]
    assert [city.published_line_count for city in body.cities] == [2, 3, 1]
    assert [city.is_sample for city in body.cities] == [False, True, False]
    for city in body.cities:
        detail = await client.get("/v1/cities/" + city.slug)
        assert detail.status_code == 200
        assert CityDetailOut.model_validate(detail.json()).lastmod == city.lastmod
    assert_no_trace_leak(response.json(), ())


async def test_sitemap_index_without_published_lines(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    async with services.session_factory() as db:
        await db.execute(
            update(Line).where(Line.city_id == sample.city_id).values(status="retired")
        )
        await db.commit()
    response = await client.get("/v1/sitemap")
    assert response.status_code == 200
    assert response.json() == {"cities": []}


async def test_stop_pairs_are_cached_until_publish(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    first = await client.get(PAIRS_PATH)
    assert first.status_code == 200
    assert first.json()["pairs"]
    async with services.session_factory() as db:
        await db.execute(
            update(Stop).where(Stop.city_id == sample.city_id).values(status="retired")
        )
        await db.commit()
    assert (await client.get(PAIRS_PATH)).json() == first.json()
    async with services.session_factory() as db:
        await db.execute(
            update(City).where(City.id == sample.city_id).values(pack_version=City.pack_version + 1)
        )
        await db.commit()
    changed = await client.get(PAIRS_PATH)
    assert changed.status_code == 200
    assert changed.json()["pairs"] == []


async def test_stop_pairs_concurrent_cold_cache_computes_once(
    client: httpx.AsyncClient, sample: Sample, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = cities_router.compute_stop_pairs
    count = 0

    async def counted(db: AsyncSession, city_id: uuid.UUID, slug: str) -> StopPairsOut:
        nonlocal count
        count += 1
        await asyncio.sleep(0.1)
        return await original(db, city_id, slug)

    monkeypatch.setattr(cities_router, "compute_stop_pairs", counted)
    responses = await asyncio.gather(*(client.get(PAIRS_PATH) for _ in range(8)))
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json() == responses[0].json() for response in responses)
    assert count == 1


async def test_stop_pairs_ip_quota(
    client: httpx.AsyncClient, services: Services, sample: Sample
) -> None:
    for _ in range(60):
        assert (await client.get(PAIRS_PATH)).status_code == 200
    response = await client.get(PAIRS_PATH)
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["Retry-After"]) > 0
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.11", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as other:
        assert (await other.get(PAIRS_PATH)).status_code == 200


async def test_stop_pairs_timeout_answers_503(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    services.settings = services.settings.model_copy(update={"stop_pairs_timeout_ms": 100})
    original = cities_router.compute_stop_pairs

    async def slow(db: AsyncSession, city_id: uuid.UUID, slug: str) -> StopPairsOut:
        await db.execute(text("SELECT pg_sleep(1)"))
        return await original(db, city_id, slug)

    monkeypatch.setattr(cities_router, "compute_stop_pairs", slow)
    response = await client.get(PAIRS_PATH)
    assert response.status_code == 503
    assert response.json()["code"] == "public.busy"
    assert response.headers["Retry-After"] == "30"
    monkeypatch.setattr(cities_router, "compute_stop_pairs", original)
    assert (await client.get(PAIRS_PATH)).status_code == 200
