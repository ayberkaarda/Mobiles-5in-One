from collections.abc import AsyncIterator

import httpx
import pytest

from app.core.deps import Services
from tests.domain.conftest import (
    Account,
    Sample,
    client,
    clock,
    contributor,
    migrated_url,
    sample,
    services,
    session_factory,
)
from tests.support.domain import trace_media_app

__all__ = [
    "Account",
    "Sample",
    "client",
    "clock",
    "contributor",
    "migrated_url",
    "review_client",
    "sample",
    "services",
    "session_factory",
]


@pytest.fixture
async def review_client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=trace_media_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        yield client
