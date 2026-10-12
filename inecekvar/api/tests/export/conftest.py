from collections.abc import AsyncIterator

import httpx
import pytest

from app.core.deps import Services
from tests.domain.conftest import (
    clock,
    contributor,
    migrated_url,
    moderator,
    sample,
    services,
    session_factory,
    user,
)
from tests.support.domain import export_app

__all__ = [
    "clock",
    "contributor",
    "migrated_url",
    "moderator",
    "sample",
    "services",
    "session_factory",
    "user",
]


@pytest.fixture
async def client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=export_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection
