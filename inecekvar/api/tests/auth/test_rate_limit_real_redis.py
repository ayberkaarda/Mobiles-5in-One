"""The login limit through the production limiter on a real Redis server (spec 6.5 proof)."""

from collections.abc import AsyncIterator

import httpx
import pytest
from redis.asyncio import Redis

from app.core.ratelimit import RedisSlidingWindowLimiter
from app.core.settings import Settings
from tests.auth.test_links_login import failed_login
from tests.support.app import FixedClock

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


@pytest.fixture
async def real_redis(redis_url: str) -> AsyncIterator[Redis]:
    connection = Redis.from_url(redis_url)
    await connection.flushdb()
    try:
        yield connection
    finally:
        await connection.flushdb()
        await connection.aclose()


@pytest.fixture
def limiter(real_redis: Redis, settings: Settings, clock: FixedClock) -> RedisSlidingWindowLimiter:
    return RedisSlidingWindowLimiter(
        real_redis, settings.rate_limit_rules, settings.require_secret("log_hash_key"), clock
    )


async def test_sixth_login_is_429_on_real_redis(
    client: httpx.AsyncClient, clock: FixedClock
) -> None:
    for _ in range(5):
        assert (await failed_login(client)).status_code == 401
        clock.advance(seconds=1)
    response = await failed_login(client)
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    retry_after = int(response.headers["retry-after"])
    assert 0 < retry_after <= 15 * 60
    clock.advance(seconds=retry_after)
    assert (await failed_login(client)).status_code == 401
