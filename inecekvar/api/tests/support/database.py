import uuid
from pathlib import Path

import asyncpg
from alembic.config import Config
from sqlalchemy.engine import make_url

API_DIR = Path(__file__).resolve().parents[2]


def async_url(dsn: str) -> str:
    return make_url(dsn).set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)


def asyncpg_dsn(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def maintenance_dsn(dsn: str) -> str:
    return make_url(dsn).set(database="postgres").render_as_string(hide_password=False)


async def create_database(dsn: str) -> str:
    name = "iv_test_" + uuid.uuid4().hex
    connection = await asyncpg.connect(maintenance_dsn(dsn))
    try:
        statement = str(
            await connection.fetchval("SELECT format('CREATE DATABASE %I', $1::text)", name)
        )
        await connection.execute(statement)
    finally:
        await connection.close()
    return make_url(dsn).set(database=name).render_as_string(hide_password=False)


async def drop_database(dsn: str) -> None:
    name = make_url(dsn).database
    if name is None or not name.startswith("iv_test_"):
        raise ValueError("Only isolated test databases may be dropped")
    connection = await asyncpg.connect(maintenance_dsn(dsn))
    try:
        await connection.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            name,
        )
        statement = str(
            await connection.fetchval(
                "SELECT format('DROP DATABASE %I WITH (FORCE)', $1::text)",
                name,
            )
        )
        await connection.execute(statement)
    finally:
        await connection.close()


def alembic_config(url: str) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "alembic"))
    config.attributes["database_url"] = url
    return config
