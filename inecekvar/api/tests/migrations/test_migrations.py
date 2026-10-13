from collections.abc import Callable
from functools import partial
from typing import cast

import anyio
import asyncpg
import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.schema import SchemaItem

from app.models import Base
from app.models.session import create_engine
from tests.support.database import alembic_config, asyncpg_dsn

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

type IncludeObject = Callable[[SchemaItem, str | None, str, bool, SchemaItem | None], bool]


async def table_names(url: str) -> set[str]:
    connection = await asyncpg.connect(asyncpg_dsn(url))
    try:
        rows = await connection.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        return {str(row["tablename"]) for row in rows}
    finally:
        await connection.close()


async def test_upgrade_downgrade_upgrade(migrated_url: str) -> None:
    expected = set(Base.metadata.tables)
    assert expected <= await table_names(migrated_url)
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        assert await connection.fetchval("SELECT version_num FROM alembic_version") == "0005"
        assert await connection.fetchval(
            "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')"
        )
    finally:
        await connection.close()
    config = alembic_config(migrated_url)
    await anyio.to_thread.run_sync(partial(command.downgrade, config, "base"))
    assert not expected & await table_names(migrated_url)
    await anyio.to_thread.run_sync(partial(command.upgrade, config, "head"))
    assert expected <= await table_names(migrated_url)


async def test_metadata_matches(migrated_url: str) -> None:
    config = alembic_config(migrated_url)
    await anyio.to_thread.run_sync(partial(command.current, config))
    include_object = cast(IncludeObject, config.attributes["include_object"])

    def compare(connection: Connection) -> list[object]:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True, "include_object": include_object},
        )
        return cast(list[object], compare_metadata(context, Base.metadata))

    engine = create_engine(migrated_url)
    try:
        async with engine.connect() as connection:
            differences = await connection.run_sync(compare)
        assert differences == []
    finally:
        await engine.dispose()


async def test_spatial_indexes(migrated_url: str) -> None:
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        rows = await connection.fetch(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'"
        )
    finally:
        await connection.close()
    indexes = {str(row["indexname"]): str(row["indexdef"]) for row in rows}
    for name, column in (
        ("ix_cities_bbox", "bbox"),
        ("ix_cities_centroid", "centroid"),
        ("ix_line_versions_geom", "geom"),
        ("ix_stops_location", "location"),
    ):
        assert "USING gist" in indexes[name]
        assert "(" + column + ")" in indexes[name]


async def test_immutability_triggers(migrated_url: str) -> None:
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        rows = await connection.fetch("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")
    finally:
        await connection.close()
    assert {"trg_line_versions_immutable", "trg_line_stops_immutable"} <= {
        str(row["tgname"]) for row in rows
    }
