"""`cost.guard` (spec section 6 item 22, ADR-0054)."""

import uuid
from collections.abc import AsyncIterator, MutableMapping
from datetime import date, timedelta
from typing import Any

import fakeredis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from structlog.testing import capture_logs

from app.core.deps import Services
from app.core.ids import uuid7
from app.models import MagicLink
from app.planner.degrade import DEGRADE_KEY, hour_key, read_flag, set_flag
from app.workers import main
from app.workers.cost_guard import (
    ALERT_PREFIX,
    CostGuardSettings,
    DatabaseUsageSource,
    Resource,
    run_cost_guard,
)
from tests.support.app import FixedClock

pytestmark = pytest.mark.anyio

SECRET_LIKE = ("redis://", "postgresql", "@", "password")


class FakeUsage:
    def __init__(self, counts: dict[Resource, int] | None = None) -> None:
        self.counts = counts or {}
        self.days: list[date] = []

    async def database_counts(self, day: date) -> dict[Resource, int]:
        self.days.append(day)
        return dict(self.counts)


class FailingUsage:
    async def database_counts(self, day: date) -> dict[Resource, int]:
        raise OSError("connection to postgresql://user:password@db failed")


class BrokenRedis(fakeredis.FakeAsyncRedis):
    async def get(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("redis://user:password@cache unreachable")

    async def set(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("redis://user:password@cache unreachable")

    async def mget(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("redis://user:password@cache unreachable")

    async def delete(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("redis://user:password@cache unreachable")


@pytest.fixture
async def redis() -> AsyncIterator[fakeredis.FakeAsyncRedis]:
    connection = fakeredis.FakeAsyncRedis()
    try:
        yield connection
    finally:
        await connection.aclose()


def config(**overrides: Any) -> CostGuardSettings:
    values: dict[str, Any] = {
        "emails_per_day": 10,
        "pack_downloads_per_day": 10,
        "presigns_per_day": 10,
        "exports_per_day": 10,
        "planner_calls_per_day": 1000,
        "planner_calls_per_hour": 100,
        "cool_down_minutes": 30,
    }
    values.update(overrides)
    return CostGuardSettings(**values)


def alerts(
    logs: list[MutableMapping[str, Any]], event: str = "cost.guard.alert"
) -> list[MutableMapping[str, Any]]:
    return [line for line in logs if line["event"] == event]


@pytest.mark.parametrize(
    ("count", "alerted"),
    [(9, False), (10, True), (11, True)],
    ids=["below", "at", "above"],
)
async def test_threshold_below_at_above(
    redis: fakeredis.FakeAsyncRedis, count: int, alerted: bool
) -> None:
    clock = FixedClock()
    with capture_logs() as logs:
        result = await run_cost_guard(
            FakeUsage({Resource.EMAILS: count}), redis, config(), clock.now(), dry_run=False
        )
    lines = alerts(logs)
    assert (Resource.EMAILS in result.alerts) is alerted
    assert len(lines) == int(alerted)
    if alerted:
        assert lines[0] == {
            "event": "cost.guard.alert",
            "log_level": "error",
            "resource": "emails",
            "count": count,
            "threshold": 10,
            "day": "2026-10-12",
            "dry_run": False,
        }


@pytest.mark.parametrize("resource", list(Resource))
async def test_every_resource_has_a_threshold(
    redis: fakeredis.FakeAsyncRedis, resource: Resource
) -> None:
    clock = FixedClock()
    if resource is Resource.PLANNER_CALLS:
        await redis.set(hour_key(clock.now()), 1000)
        usage = FakeUsage()
    else:
        usage = FakeUsage({resource: 10})
    result = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert resource in result.alerts


async def test_alert_is_idempotent_per_day(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    usage = FakeUsage({Resource.PACK_DOWNLOADS: 50, Resource.PRESIGNS: 1})
    with capture_logs() as logs:
        first = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
        clock.advance(minutes=15)
        second = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
        clock.advance(days=1)
        next_day = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert first.alerts == [Resource.PACK_DOWNLOADS]
    assert second.alerts == []
    assert second.repeats == [Resource.PACK_DOWNLOADS]
    assert next_day.alerts == [Resource.PACK_DOWNLOADS]
    assert [line["day"] for line in alerts(logs)] == ["2026-10-12", "2026-10-13"]
    assert await redis.ttl(ALERT_PREFIX + "2026-10-12:pack_downloads") > 0


async def test_dry_run_logs_suppressed_and_writes_nothing(
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    clock = FixedClock()
    await redis.set(hour_key(clock.now()), 500)
    with capture_logs() as logs:
        result = await run_cost_guard(
            FakeUsage({Resource.EXPORTS: 20}), redis, config(), clock.now(), dry_run=True
        )
    assert alerts(logs) == []
    suppressed = alerts(logs, "cost.guard.alert_suppressed")
    assert [line["resource"] for line in suppressed] == ["exports"]
    assert alerts(logs, "cost.guard.degrade_suppressed")
    assert result.degrade == "suppressed"
    assert await redis.keys(ALERT_PREFIX + "*") == []
    assert await redis.get(DEGRADE_KEY) is None


async def test_settings_dry_run_wins(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    result = await run_cost_guard(
        FakeUsage({Resource.EMAILS: 99}), redis, config(dry_run=True), clock.now(), dry_run=False
    )
    assert result.dry_run is True
    assert await redis.keys(ALERT_PREFIX + "*") == []


async def test_load_alert_sets_flag_and_clears_after_cool_down(
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    clock = FixedClock()
    usage = FakeUsage()
    await redis.set(hour_key(clock.now()), 100)
    with capture_logs() as logs:
        on = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert on.load_alert is True
    assert on.degrade == "on"
    flag = await read_flag(redis)
    assert flag is not None
    assert (flag.source, flag.reason) == ("cost_guard", "planner_load")
    assert flag.expires_at == clock.now() + timedelta(minutes=30)
    assert 0 < await redis.ttl(DEGRADE_KEY) <= 30 * 60
    assert alerts(logs, "cost.guard.degrade_on")[0]["threshold"] == 100

    # Load still high a quarter later: the flag is re-armed from now.
    clock.advance(minutes=15)
    rearmed = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert rearmed.degrade == "rearmed"
    flag = await read_flag(redis)
    assert flag is not None
    assert flag.expires_at == clock.now() + timedelta(minutes=30)

    # The load stops; the cool-down counts from the last re-arm.
    armed_at = flag.set_at
    await redis.delete(hour_key(armed_at))
    clock.current = armed_at + timedelta(minutes=29)
    cooling = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert cooling.load_alert is False
    assert cooling.degrade == "cooling"
    assert await redis.get(DEGRADE_KEY) is not None

    clock.current = armed_at + timedelta(minutes=30)
    with capture_logs() as logs:
        off = await run_cost_guard(usage, redis, config(), clock.now(), dry_run=False)
    assert off.degrade == "off"
    assert await redis.get(DEGRADE_KEY) is None
    assert alerts(logs, "cost.guard.degrade_off")


async def test_operator_flag_is_left_alone(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    await set_flag(redis, "ops", "manual", clock.now(), 600)
    await redis.set(hour_key(clock.now()), 5000)
    loaded = await run_cost_guard(FakeUsage(), redis, config(), clock.now(), dry_run=False)
    assert loaded.degrade == "operator"
    flag = await read_flag(redis)
    assert flag is not None
    assert flag.source == "ops"
    # Expired operator flag with no load: still not the guard's to delete.
    await redis.delete(hour_key(clock.now()))
    clock.advance(hours=3)
    quiet = await run_cost_guard(FakeUsage(), redis, config(), clock.now(), dry_run=False)
    assert quiet.degrade == "unchanged"
    assert await redis.get(DEGRADE_KEY) is not None


async def test_degrade_on_load_can_be_switched_off(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    await redis.set(hour_key(clock.now()), 5000)
    result = await run_cost_guard(
        FakeUsage(), redis, config(degrade_on_load=False), clock.now(), dry_run=False
    )
    assert result.load_alert is True
    assert result.degrade == "unchanged"
    assert await redis.get(DEGRADE_KEY) is None


async def test_previous_hour_counts_for_the_load(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    await redis.set(hour_key(clock.now() - timedelta(hours=1)), 150)
    await redis.set(hour_key(clock.now() - timedelta(days=1)), 900)
    result = await run_cost_guard(FakeUsage(), redis, config(), clock.now(), dry_run=False)
    assert result.planner_hour == 150
    assert result.counts[Resource.PLANNER_CALLS] == 150
    assert result.load_alert is True


async def test_redis_failure_does_not_crash_the_run() -> None:
    clock = FixedClock()
    broken = BrokenRedis()
    try:
        with capture_logs() as logs:
            result = await run_cost_guard(
                FakeUsage({Resource.EMAILS: 30}), broken, config(), clock.now(), dry_run=False
            )
    finally:
        await broken.aclose()
    # The database alert is still logged: a lost marker repeats an alert, never hides one.
    assert result.alerts == [Resource.EMAILS]
    assert len(alerts(logs)) == 1
    assert result.errors == ["redis:ConnectionError"]
    assert Resource.PLANNER_CALLS not in result.counts
    errors = alerts(logs, "cost.guard.source_error")
    assert errors == [
        {
            "event": "cost.guard.source_error",
            "log_level": "warning",
            "source": "redis",
            "error": "ConnectionError",
        }
    ]
    for fragment in SECRET_LIKE:
        assert fragment not in str(logs)


async def test_redis_failure_while_switching_the_flag() -> None:
    class FlagBroken(fakeredis.FakeAsyncRedis):
        async def get(self, *args: Any, **kwargs: Any) -> Any:
            return None

        async def set(self, *args: Any, **kwargs: Any) -> Any:
            raise RedisConnectionError("down")

    clock = FixedClock()
    connection = FlagBroken()
    try:
        await connection.mset({hour_key(clock.now()): 500})
        result = await run_cost_guard(FakeUsage(), connection, config(), clock.now(), dry_run=False)
    finally:
        await connection.aclose()
    assert result.degrade == "error"
    assert "redis:ConnectionError" in result.errors


async def test_database_failure_does_not_crash_the_run(redis: fakeredis.FakeAsyncRedis) -> None:
    clock = FixedClock()
    await redis.set(hour_key(clock.now()), 2000)
    with capture_logs() as logs:
        result = await run_cost_guard(FailingUsage(), redis, config(), clock.now(), dry_run=False)
    assert result.errors == ["database:OSError"]
    assert result.alerts == [Resource.PLANNER_CALLS]
    assert result.degrade == "on"
    for fragment in SECRET_LIKE:
        assert fragment not in str(logs)


def test_settings_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INECEKVAR_COST_GUARD_EMAILS_PER_DAY", "5")
    monkeypatch.setenv("INECEKVAR_COST_GUARD_COOL_DOWN_MINUTES", "90")
    monkeypatch.setenv("INECEKVAR_COST_GUARD_DRY_RUN", "true")
    settings = CostGuardSettings()
    assert settings.emails_per_day == 5
    assert settings.cool_down_minutes == 90
    assert settings.dry_run is True
    assert CostGuardSettings.model_fields["emails_per_day"].default == 80
    monkeypatch.setenv("INECEKVAR_COST_GUARD_COOL_DOWN_MINUTES", "1")
    with pytest.raises(ValueError, match="cool_down_minutes"):
        CostGuardSettings()


def test_cron_registration() -> None:
    jobs = {job.name: job for job in main.CRON_JOBS}
    guard = jobs["cron:cost_guard_job"]
    assert guard.minute == {7, 22, 37, 52}
    assert guard.second == 0


@pytest.mark.postgis
async def test_database_counts_today_only(services: Services, clock: FixedClock) -> None:
    source = DatabaseUsageSource(services.session_factory)
    before = await source.database_counts(clock.now().date())
    async with services.session_factory() as db:
        for moment in (clock.now(), clock.now(), clock.now() - timedelta(days=1)):
            db.add(
                MagicLink(
                    id=uuid7(),
                    email="guard." + uuid.uuid4().hex[:6] + "@example.com",
                    user_id=None,
                    token_hash=uuid.uuid4().bytes + uuid.uuid4().bytes,
                    purpose="login",
                    expires_at=moment + timedelta(minutes=15),
                    created_at=moment,
                    updated_at=moment,
                )
            )
        await db.commit()
    after = await source.database_counts(clock.now().date())
    assert after[Resource.EMAILS] == before[Resource.EMAILS] + 2
    assert set(after) == {
        Resource.EMAILS,
        Resource.PACK_DOWNLOADS,
        Resource.PRESIGNS,
        Resource.EXPORTS,
    }


@pytest.mark.postgis
async def test_worker_job_runs_against_real_services(services: Services, clock: FixedClock) -> None:
    ctx: dict[str, Any] = {"services": services}
    with capture_logs() as logs:
        result = await main.cost_guard_job(ctx, dry_run=True)
    assert result["dry_run"] is True
    assert result["day"] == clock.now().date().isoformat()
    assert result["errors"] == []
    assert [line for line in logs if line["event"] == "cost.guard.run"]
