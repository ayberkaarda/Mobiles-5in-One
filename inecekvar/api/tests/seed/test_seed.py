import os
import subprocess
import sys
from functools import partial

import anyio
import asyncpg
import pytest
from geoalchemy2.shape import to_shape
from sqlalchemy import func, select

from app.models import Base, City, Line, LineStop, LineVersion, Stop
from app.models.session import create_engine, create_session_factory
from app.seed.sample_city import seed_sample_city
from tests.support.database import API_DIR, asyncpg_dsn

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def row_counts(url: str) -> dict[str, int]:
    engine = create_engine(url)
    try:
        async with engine.connect() as connection:
            counts: dict[str, int] = {}
            for name, table in Base.metadata.tables.items():
                counts[name] = int(
                    await connection.scalar(select(func.count()).select_from(table)) or 0
                )
            return counts
    finally:
        await engine.dispose()


async def test_idempotent_sample(migrated_url: str) -> None:
    engine = create_engine(migrated_url)
    factory = create_session_factory(engine)
    try:
        async with factory.begin() as session:
            first = await seed_sample_city(session)
        before = await row_counts(migrated_url)
        async with factory.begin() as session:
            second = await seed_sample_city(session)
        assert second.created == 0
        assert first.existing == 0
        assert first.created == second.existing == sum(before.values())
        assert before == await row_counts(migrated_url)
        assert before["cities"] == 1
        assert before["stops"] == 20
        assert before["lines"] == before["line_versions"] == 3
        async with factory() as session:
            city = (await session.scalars(select(City))).one()
            assert city.is_sample
            assert city.name == "[ÖRNEK] Test Şehri"
            assert city.slug == "ornek-test-sehri"
            assert city.timezone == "Europe/Istanbul"
            bounds = to_shape(city.bbox)
            assert bounds.bounds == (34.0, 42.5, 34.1, 42.58)
            stops = (await session.scalars(select(Stop))).all()
            assert all(stop.name.startswith("[ÖRNEK]") for stop in stops)
            assert sum(stop.kind == "informal" for stop in stops) == 2
            lines = (await session.scalars(select(Line))).all()
            assert all(line.name.startswith("[ÖRNEK]") for line in lines)
            for line in lines:
                assert line.status == "published"
                assert line.current_version_id is not None
                version = await session.get(LineVersion, line.current_version_id)
                assert version is not None
                assert bounds.contains(to_shape(version.geom))
                rows = (
                    await session.scalars(
                        select(LineStop)
                        .where(LineStop.line_version_id == version.id)
                        .order_by(LineStop.seq)
                    )
                ).all()
                assert len(rows) == len(version.stop_ids)
                assert [str(row.stop_id) for row in rows] == version.stop_ids
                assert [row.seq for row in rows] == list(range(len(rows)))
    finally:
        await engine.dispose()


async def test_cli_twice(migrated_url: str) -> None:
    env = dict(os.environ, INECEKVAR_DATABASE_URL=migrated_url, INECEKVAR_ENV="test")
    run = partial(
        subprocess.run,
        [sys.executable, "-m", "app.seed"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    first = await anyio.to_thread.run_sync(run)
    before = await row_counts(migrated_url)
    second = await anyio.to_thread.run_sync(run)
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert "created=0" in second.stdout
    assert len(first.stdout.splitlines()) == len(second.stdout.splitlines()) == 1
    assert before == await row_counts(migrated_url)


async def test_cli_refuses_production(migrated_url: str) -> None:
    env = dict(os.environ, INECEKVAR_DATABASE_URL=migrated_url, INECEKVAR_ENV="production")
    result = await anyio.to_thread.run_sync(
        partial(
            subprocess.run,
            [sys.executable, "-m", "app.seed"],
            cwd=API_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    )
    assert result.returncode != 0
    assert "production" in result.stderr
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        assert await connection.fetchval("SELECT count(*) FROM cities") == 0
    finally:
        await connection.close()
