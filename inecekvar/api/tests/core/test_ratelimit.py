from collections.abc import AsyncIterator

import fakeredis
import pytest
from redis.asyncio import Redis, from_url
from redis.exceptions import RedisError

from app.core.client_ip import rate_limit_subjects
from app.core.deps import enforce_ip_rate_limit
from app.core.errors import ProblemError
from app.core.ratelimit import RedisSlidingWindowLimiter
from app.core.settings import RATE_LIMIT_RULES, Settings
from tests.support.app import FixedClock, InMemoryRateLimiter

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
        "auth.step_up": (5, 900),
        "edits.low_reputation": (10, 86400),
        "edits.default": (100, 86400),
        "traces": (20, 86400),
        "plan": (30, 60),
        "media.presign": (20, 86400),
        "pack.download": (10, 86400),
        "public.stop_pairs": (60, 60),
        "admin.export": (10, 3600),
        "mail.security_after_bounce": (3, 86400),
        # ADR-0052 decision 9: /64 ceilings of the two-tier IPv6 rules, 20 times the limit.
        "auth.login.net64": (100, 900),
        "auth.register.net64": (100, 900),
        "auth.magic_link.net64": (100, 900),
        "auth.refresh.net64": (100, 900),
        "auth.step_up.net64": (100, 900),
        "plan.net64": (600, 60),
    }


def test_rate_limit_subjects_two_tier_for_ipv6_only() -> None:
    assert rate_limit_subjects("auth.login", "2001:db8:1:2::7") == [
        ("auth.login", "2001:db8:1:2::7"),
        ("auth.login.net64", "2001:db8:1:2::/64"),
    ]
    assert rate_limit_subjects("plan", "2001:DB8:1:2:0:0:0:7") == [
        ("plan", "2001:db8:1:2::7"),
        ("plan.net64", "2001:db8:1:2::/64"),
    ]
    assert rate_limit_subjects("auth.login", "198.51.100.7") == [("auth.login", "198.51.100.7")]
    assert rate_limit_subjects("auth.login", "::ffff:198.51.100.7") == [
        ("auth.login", "198.51.100.7")
    ]
    # Rules outside the two-tier list keep one window per /64.
    assert rate_limit_subjects("public.stop_pairs", "2001:db8:1:2::7") == [
        ("public.stop_pairs", "2001:db8:1:2::/64")
    ]
    assert rate_limit_subjects("auth.login", "not-an-ip") == [("auth.login", "not-an-ip")]


async def login_status(limiter: InMemoryRateLimiter, address: str) -> int:
    try:
        await enforce_ip_rate_limit(limiter, "auth.login", address)
    except ProblemError as error:
        return error.status
    return 200


async def test_one_host_on_a_shared_64_cannot_lock_out_its_neighbours(
    settings: Settings, clock: FixedClock
) -> None:
    limiter = InMemoryRateLimiter(settings.rate_limit_rules, clock)
    hostile = [await login_status(limiter, "2001:db8:1:2::bad") for _ in range(200)]
    assert hostile == [200] * 5 + [429] * 195
    # The refused hits of the hostile host added nothing to the /64 ceiling (100).
    neighbours = [await login_status(limiter, f"2001:db8:1:2::{index:x}") for index in range(1, 20)]
    assert neighbours == [200] * 19


async def test_rotation_inside_one_64_meets_the_ceiling(
    settings: Settings, clock: FixedClock
) -> None:
    limiter = InMemoryRateLimiter(settings.rate_limit_rules, clock)
    statuses = [
        await login_status(limiter, f"2001:db8:1:2::{index:x}")
        for index in range(1, 30)
        for _ in range(5)
    ]
    assert statuses.count(200) == 100
    assert set(statuses[100:]) == {429}
    # Another /64 has its own ceiling.
    assert await login_status(limiter, "2001:db8:1:3::1") == 200
