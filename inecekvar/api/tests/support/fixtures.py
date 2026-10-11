from collections.abc import AsyncIterator
from functools import partial

import anyio
import pytest
from alembic import command

from tests.support.database import alembic_config, async_url, create_database, drop_database


@pytest.fixture
async def migrated_url(postgis_dsn: str) -> AsyncIterator[str]:
    dsn = await create_database(postgis_dsn)
    try:
        url = async_url(dsn)
        await anyio.to_thread.run_sync(partial(command.upgrade, alembic_config(url), "head"))
        yield url
    finally:
        await drop_database(dsn)
