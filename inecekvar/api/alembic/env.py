import asyncio
from logging.config import fileConfig

from alembic import context
from geoalchemy2.alembic_helpers import render_item
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.schema import SchemaItem

from app.models import Base
from app.models.session import database_url_from_env

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def include_object(
    obj: SchemaItem,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: SchemaItem | None,
) -> bool:
    if type_ == "table":
        return name in target_metadata.tables and getattr(obj, "schema", None) is None
    if type_ == "index":
        table = getattr(obj, "table", None)
        if table is None or getattr(table, "schema", None) is not None:
            return False
        model_table = target_metadata.tables.get(str(getattr(table, "name", "")))
        return model_table is not None and any(index.name == name for index in model_table.indexes)
    return True


config.attributes["include_object"] = include_object


def migration_url() -> str:
    configured = config.attributes.get("database_url")
    if configured is not None:
        if not isinstance(configured, str):
            raise RuntimeError("Alembic database_url must be a string")
        return configured
    return database_url_from_env()


def run_migrations_offline() -> None:
    context.configure(
        url=migration_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=include_object,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(migration_url(), poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
