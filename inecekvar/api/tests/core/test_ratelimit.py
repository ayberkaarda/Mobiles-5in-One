from collections.abc import AsyncIterator

import fakeredis
import pytest
from redis.asyncio import Redis, from_url
from redis.exceptions import RedisError

from app.core.ratelimit import RedisSlidingWindowLimiter
from app.core.settings import RATE_LIMIT_RULES, Settings
from tests.support.app import FixedClock

pytestmark = pytest.mark.anyio


@pytest.fixture
async def real_redis(redis_url: str) -> AsyncIterator[Redis]:
    connection = from_url(redis_url, decode_responses=True)
    await connection.flushdb()
    try:
        yield connection
    finally:
        await connection.flushdb()
        await connection.aclose()


def make_limiter(redis: Redis, settings: Settings, clock: FixedClock) -> RedisSlidingWindowLimiter:
    return RedisSlidingWindowLimiter(
        redis, settings.rate_limit_rules, settings.require_secret("log_hash_key"), clock
    )


async def sixth_hit(limiter: RedisSlidingWindowLimiter) -> None:
    for _ in range(5):
        assert (await limiter.hit("auth.login", "ip:203.0.113.10")).allowed
    decision = await limiter.hit("auth.login", "ip:203.0.113.10")
    assert not decision.allowed
    assert decision.remaining == 0
    assert 1 <= decision.retry_after_seconds <= 900


async def test_sliding_window_sixth_hit_denied_on_real_redis(
    real_redis: Redis, settings: Settings, clock: FixedClock
) -> None:
    await sixth_hit(make_limiter(real_redis, settings, clock))


async def test_sliding_window_sixth_hit_denied_on_fakeredis(
    redis: fakeredis.FakeAsyncRedis, settings: Settings, clock: FixedClock
) -> None:
    pytest.importorskip("lupa", reason="fakeredis Lua execution requires the Lua extra")
    await sixth_hit(make_limiter(redis, settings, clock))


async def test_sliding_window_slides(
    real_redis: Redis, settings: Settings, clock: FixedClock
) -> None:
    limiter = make_limiter(real_redis, settings, clock)
    assert (await limiter.hit("auth.login", "email:a@b.example")).allowed
    clock.advance(seconds=10)
    for _ in range(4):
        assert (await limiter.hit("auth.login", "email:a@b.example")).allowed
    assert not (await limiter.hit("auth.login", "email:a@b.example")).allowed
    clock.advance(seconds=891)
    assert (await limiter.hit("auth.login", "email:a@b.example")).allowed
    assert not (await limiter.hit("auth.login", "email:a@b.example")).allowed


async def test_limiter_keys_hide_subject(
    real_redis: Redis, settings: Settings, clock: FixedClock
) -> None:
    limiter = make_limiter(real_redis, settings, clock)
    await limiter.hit("auth.login", "email:a@b.example")
    await limiter.hit("auth.login", "ip:203.0.113.10")
    keys = [
        key.decode() if isinstance(key, bytes) else str(key)
        for key in await real_redis.keys("rl:*")
    ]
    assert len(keys) == 2
    assert all("a@b.example" not in key and "203.0.113.10" not in key for key in keys)
    assert all(len(key.removeprefix("rl:auth.login:")) == 64 for key in keys)


async def test_parallel_hits_are_atomic(
    real_redis: Redis, settings: Settings, clock: FixedClock
) -> None:
    import asyncio

    limiter = make_limiter(real_redis, settings, clock)
    results = await asyncio.gather(*(limiter.hit("auth.login", "same") for _ in range(20)))
    assert sum(result.allowed for result in results) == 5


async def test_unknown_rule_fails_closed(
    redis: fakeredis.FakeAsyncRedis, settings: Settings, clock: FixedClock
) -> None:
    with pytest.raises(KeyError):
        await make_limiter(redis, settings, clock).hit("missing", "subject")


async def test_redis_error_propagates(settings: Settings, clock: FixedClock) -> None:
    connection = from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.1)
    try:
        with pytest.raises(RedisError):
            await make_limiter(connection, settings, clock).hit("auth.login", "subject")
    finally:
        await connection.aclose()


def test_rules_match_spec() -> None:
    assert {key: (rule.limit, rule.window_seconds) for key, rule in RATE_LIMIT_RULES.items()} == {
        "auth.login": (5, 900),
        "auth.register": (5, 900),
        "auth.magic_link": (5, 900),
        "auth.refresh": (5, 900),
        "edits.low_reputation": (10, 86400),
        "edits.default": (100, 86400),
        "traces": (20, 86400),
        "plan": (30, 60),
        "media.presign": (20, 86400),
        "pack.download": (10, 86400),
    }
