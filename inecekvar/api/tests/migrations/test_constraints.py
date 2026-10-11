from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app.core.ids import uuid7
from tests.support.database import asyncpg_dsn

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


@pytest.fixture
async def connection(migrated_url: str) -> AsyncIterator[asyncpg.Connection[asyncpg.Record]]:
    database = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        yield database
    finally:
        await database.close()


async def city(connection: asyncpg.Connection[asyncpg.Record]) -> uuid.UUID:
    value = uuid7()
    await connection.execute(
        "INSERT INTO cities (id, name, slug, bbox, centroid) VALUES "
        "($1, $2, $3, ST_GeomFromText($4, 4326), ST_GeomFromText($5, 4326))",
        value,
        "Test city",
        "city-" + value.hex,
        "POLYGON((34 42.5,34.1 42.5,34.1 42.58,34 42.58,34 42.5))",
        "POINT(34.05 42.54)",
    )
    return value


async def user(
    connection: asyncpg.Connection[asyncpg.Record],
    *,
    uppercase: bool = False,
) -> uuid.UUID:
    value = uuid7()
    email = value.hex + "@example.invalid"
    if uppercase:
        email = email.upper()
    await connection.execute("INSERT INTO users (id, email) VALUES ($1, $2)", value, email)
    return value


async def line(
    connection: asyncpg.Connection[asyncpg.Record],
    city_id: uuid.UUID,
    *,
    slug: str = "test-line",
    mode: str = "dolmus",
) -> uuid.UUID:
    value = uuid7()
    await connection.execute(
        "INSERT INTO lines (id, city_id, code, name, slug, mode) VALUES ($1, $2, $3, $4, $5, $6)",
        value,
        city_id,
        "TEST-1",
        "Test line",
        slug,
        mode,
    )
    return value


async def version(
    connection: asyncpg.Connection[asyncpg.Record],
    line_id: uuid.UUID,
    *,
    publisher: uuid.UUID | None = None,
    fare: int = 2500,
    geom: str = "LINESTRING(34.01 42.51,34.03 42.51)",
) -> uuid.UUID:
    value = uuid7()
    await connection.execute(
        "INSERT INTO line_versions "
        "(id, line_id, version_no, geom, fare_minor, published_by, published_at) "
        "VALUES ($1, $2, 1, ST_GeomFromText($3, 4326), $4, $5, now())",
        value,
        line_id,
        geom,
        fare,
        publisher,
    )
    return value


async def trace(
    connection: asyncpg.Connection[asyncpg.Record],
    city_id: uuid.UUID,
    author_id: uuid.UUID,
    count: int,
) -> uuid.UUID:
    value = uuid7()
    await connection.execute(
        "INSERT INTO traces (id, city_id, author_id, points, started_at, ended_at) "
        "VALUES ($1, $2, $3, $4::jsonb, now(), now())",
        value,
        city_id,
        author_id,
        json.dumps([[34.01, 42.51]] * count),
    )
    return value


async def edit(
    connection: asyncpg.Connection[asyncpg.Record],
    city_id: uuid.UUID,
    author_id: uuid.UUID,
    *,
    reviewer_id: uuid.UUID | None = None,
) -> uuid.UUID:
    value = uuid7()
    await connection.execute(
        "INSERT INTO edits (id, kind, city_id, payload, author_id, reviewer_id) "
        "VALUES ($1, 'new_line', $2, '{}'::jsonb, $3, $4)",
        value,
        city_id,
        author_id,
        reviewer_id,
    )
    return value


@pytest.mark.parametrize("operation", ["update", "delete"])
async def test_version_immutable(
    connection: asyncpg.Connection[asyncpg.Record],
    operation: str,
) -> None:
    line_id = await line(connection, await city(connection))
    version_id = await version(connection, line_id)
    statement = (
        "UPDATE line_versions SET fare_minor = 3000 WHERE id = $1"
        if operation == "update"
        else "DELETE FROM line_versions WHERE id = $1"
    )
    with pytest.raises(asyncpg.PostgresError) as exc:
        await connection.execute(statement, version_id)
    assert exc.value.sqlstate == "23001"


async def test_publisher_anonymisation(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    publisher = await user(connection)
    line_id = await line(connection, await city(connection))
    version_id = await version(connection, line_id, publisher=publisher)
    before = await connection.fetchrow("SELECT * FROM line_versions WHERE id = $1", version_id)
    await connection.execute("DELETE FROM users WHERE id = $1", publisher)
    after = await connection.fetchrow("SELECT * FROM line_versions WHERE id = $1", version_id)
    assert before is not None
    assert after is not None
    assert after["published_by"] is None
    columns = tuple(before.keys())
    assert {key: before[key] for key in columns if key != "published_by"} == {
        key: after[key] for key in columns if key != "published_by"
    }


async def test_anonymisation_rejects_other_changes(
    connection: asyncpg.Connection[asyncpg.Record],
) -> None:
    publisher = await user(connection)
    line_id = await line(connection, await city(connection))
    version_id = await version(connection, line_id, publisher=publisher)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await connection.execute(
            "UPDATE line_versions SET published_by = NULL, fare_minor = 3000 WHERE id = $1",
            version_id,
        )
    assert exc.value.sqlstate == "23001"


async def test_null_publisher_noop_rejected(
    connection: asyncpg.Connection[asyncpg.Record],
) -> None:
    line_id = await line(connection, await city(connection))
    version_id = await version(connection, line_id)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await connection.execute(
            "UPDATE line_versions SET published_by = NULL WHERE id = $1",
            version_id,
        )
    assert exc.value.sqlstate == "23001"


@pytest.mark.parametrize("operation", ["update", "delete"])
async def test_line_stop_immutable(
    connection: asyncpg.Connection[asyncpg.Record],
    operation: str,
) -> None:
    city_id = await city(connection)
    version_id = await version(connection, await line(connection, city_id))
    stop_id = uuid7()
    await connection.execute(
        "INSERT INTO stops (id, city_id, name, slug, location, kind) "
        "VALUES ($1, $2, 'Test stop', 'test-stop', ST_GeogFromText($3), 'formal')",
        stop_id,
        city_id,
        "SRID=4326;POINT(34.01 42.51)",
    )
    await connection.execute(
        "INSERT INTO line_stops (line_version_id, stop_id, seq) VALUES ($1, $2, 0)",
        version_id,
        stop_id,
    )
    statement = (
        "UPDATE line_stops SET seq = 1 WHERE line_version_id = $1"
        if operation == "update"
        else "DELETE FROM line_stops WHERE line_version_id = $1"
    )
    with pytest.raises(asyncpg.PostgresError) as exc:
        await connection.execute(statement, version_id)
    assert exc.value.sqlstate == "23001"


async def test_invalid_mode(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    city_id = await city(connection)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await line(connection, city_id, mode="invalid")
    assert exc.value.sqlstate == "23514"


async def test_fare_boundary(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    line_id = await line(connection, await city(connection))
    with pytest.raises(asyncpg.PostgresError) as exc:
        await version(connection, line_id, fare=10_000_001)
    assert exc.value.sqlstate == "23514"
    await version(connection, line_id, fare=10_000_000)


@pytest.mark.parametrize("count", [1, 5001])
async def test_trace_bounds(connection: asyncpg.Connection[asyncpg.Record], count: int) -> None:
    city_id = await city(connection)
    author_id = await user(connection)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await trace(connection, city_id, author_id, count)
    assert exc.value.sqlstate == "23514"
    await trace(connection, city_id, author_id, 2)


async def test_no_self_review(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    city_id = await city(connection)
    author_id = await user(connection)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await edit(connection, city_id, author_id, reviewer_id=author_id)
    assert exc.value.sqlstate == "23514"


async def test_line_slug_scope(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    city_id = await city(connection)
    await line(connection, city_id)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await line(connection, city_id)
    assert exc.value.sqlstate == "23505"
    await line(connection, await city(connection))


async def test_contribution_retention(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    city_id = await city(connection)
    author_id = await user(connection)
    edit_id = await edit(connection, city_id, author_id)
    trace_id = await trace(connection, city_id, author_id, 2)
    await connection.execute("DELETE FROM users WHERE id = $1", author_id)
    row = await connection.fetchrow("SELECT author_id FROM edits WHERE id = $1", edit_id)
    assert row is not None
    assert row["author_id"] is None
    assert not await connection.fetchval(
        "SELECT EXISTS(SELECT 1 FROM traces WHERE id = $1)",
        trace_id,
    )


async def test_route_length(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    line_id = await line(connection, await city(connection))
    with pytest.raises(asyncpg.PostgresError) as exc:
        await version(connection, line_id, geom="LINESTRING(34 42.5,37 42.5)")
    assert exc.value.sqlstate == "23514"


async def test_email_lowercase(connection: asyncpg.Connection[asyncpg.Record]) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await user(connection, uppercase=True)
    assert exc.value.sqlstate == "23514"
