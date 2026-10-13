"""`cost.guard`: daily usage counters against thresholds (spec section 6 item 22, ADR-0054).

Every run (cron in `app/workers/main.py`) counts, for the current UTC day:

- `emails`: `magic_links` rows created today (one mail each) plus `deletion_requests`
  completed today (the erasure notice);
- `pack_downloads`: `pack_downloads` rows of today;
- `presigns`: `photos` rows created today (one per presigned upload);
- `exports`: `exports` rows created today (weekly job and admin runs);
- `planner_calls`: the Redis hour buckets of today written by the planner
  (`app/planner/degrade.py`).

A count at or above its threshold logs one `cost.guard.alert` line at error level (resource,
count, threshold, UTC day; nothing else) once per resource and day: a marker key in Redis
suppresses repeats, and when Redis cannot be written the alert is logged again rather than lost.

Load: when the planner calls of the current or the previous UTC hour reach
`planner_calls_per_hour`, the guard sets the planner degrade flag (source `cost_guard`) for the
cool-down and re-arms it on every run while the load holds. Once the load has dropped and the
cool-down since the last re-arm has passed, the guard removes its own flag. A flag set by an
operator (`python -m app.ops.planner_degrade`) is never touched here.

A dry run (`INECEKVAR_COST_GUARD_DRY_RUN`, `INECEKVAR_JOBS_DRY_RUN` or the job argument) logs
`cost.guard.alert_suppressed` and `cost.guard.degrade_suppressed` and writes nothing. A failing
database or Redis is logged as `cost.guard.source_error` with the error class only; the run
evaluates what it could read and never raises.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum
from typing import Protocol

import structlog
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import DeletionRequest, MagicLink, PackDownload, Photo
from app.models.ops import Export
from app.planner.degrade import clear_flag, hour_key, read_flag, set_flag

ALERT_PREFIX = "inecekvar:cost:alerted:"
ALERT_TTL_SECONDS = 2 * 24 * 60 * 60


class Resource(StrEnum):
    EMAILS = "emails"
    PACK_DOWNLOADS = "pack_downloads"
    PRESIGNS = "presigns"
    EXPORTS = "exports"
    PLANNER_CALLS = "planner_calls"


class CostGuardSettings(BaseSettings):
    """Daily thresholds; a count at or above its threshold alerts (docs/ops/cost-alerts.md)."""

    model_config = SettingsConfigDict(
        env_prefix="INECEKVAR_COST_GUARD_",
        extra="ignore",
        frozen=True,
        case_sensitive=False,
    )

    # 80 % of the 100 mails a day of the Resend free tier.
    emails_per_day: int = Field(default=80, ge=1)
    pack_downloads_per_day: int = Field(default=1000, ge=1)
    # 300 uploads of at most 4 MiB are 1.2 GiB a day against the 10 GB R2 free storage.
    presigns_per_day: int = Field(default=300, ge=1)
    # One weekly run per city plus admin runs (10 per admin and hour).
    exports_per_day: int = Field(default=20, ge=1)
    planner_calls_per_day: int = Field(default=20_000, ge=1)
    # Load trigger of the degrade flag: about 50 uncached and cached plans a minute for an hour.
    planner_calls_per_hour: int = Field(default=3_000, ge=1)
    degrade_on_load: bool = True
    cool_down_minutes: int = Field(default=60, ge=5, le=24 * 60)
    dry_run: bool = False

    def thresholds(self) -> dict[Resource, int]:
        return {
            Resource.EMAILS: self.emails_per_day,
            Resource.PACK_DOWNLOADS: self.pack_downloads_per_day,
            Resource.PRESIGNS: self.presigns_per_day,
            Resource.EXPORTS: self.exports_per_day,
            Resource.PLANNER_CALLS: self.planner_calls_per_day,
        }


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0), tzinfo=UTC)
    return start, start + timedelta(days=1)


class UsageSource(Protocol):
    async def database_counts(self, day: date) -> dict[Resource, int]: ...


class DatabaseUsageSource:
    """Counts of today's rows; every query is an indexed or bounded `count(*)`."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory

    async def database_counts(self, day: date) -> dict[Resource, int]:
        start, end = day_bounds(day)
        async with self.session_factory() as db:

            async def count(statement: Select[int]) -> int:
                return int(await db.scalar(statement) or 0)

            links = await count(
                select(func.count())
                .select_from(MagicLink)
                .where(MagicLink.created_at >= start, MagicLink.created_at < end)
            )
            erased = await count(
                select(func.count())
                .select_from(DeletionRequest)
                .where(DeletionRequest.completed_at >= start, DeletionRequest.completed_at < end)
            )
            packs = await count(
                select(func.count()).select_from(PackDownload).where(PackDownload.day == day)
            )
            photos = await count(
                select(func.count())
                .select_from(Photo)
                .where(Photo.created_at >= start, Photo.created_at < end)
            )
            exports = await count(
                select(func.count())
                .select_from(Export)
                .where(Export.created_at >= start, Export.created_at < end)
            )
        return {
            Resource.EMAILS: links + erased,
            Resource.PACK_DOWNLOADS: packs,
            Resource.PRESIGNS: photos,
            Resource.EXPORTS: exports,
        }


async def planner_counts(redis: Redis, now: datetime) -> tuple[int, int]:
    """(calls today, calls in the busier of the current and the previous hour)."""
    current = now.astimezone(UTC)
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    hours = [start + timedelta(hours=offset) for offset in range(current.hour + 1)]
    previous = current - timedelta(hours=1)
    keys = [hour_key(moment) for moment in hours] + [hour_key(previous)]
    values = await redis.mget(keys)
    numbers = [int(value) if value is not None else 0 for value in values]
    today = sum(numbers[:-1])
    return today, max(numbers[-2], numbers[-1])


def over(count: int, threshold: int) -> bool:
    """At the threshold counts as reached: the threshold is the alert line, not the limit."""
    return count >= threshold


@dataclass(slots=True)
class CostGuardResult:
    day: date
    dry_run: bool
    counts: dict[Resource, int] = field(default_factory=dict)
    alerts: list[Resource] = field(default_factory=list)
    repeats: list[Resource] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    planner_hour: int | None = None
    load_alert: bool = False
    degrade: str = "unchanged"

    def as_dict(self) -> dict[str, object]:
        return {
            "day": self.day.isoformat(),
            "dry_run": self.dry_run,
            "counts": {key.value: value for key, value in self.counts.items()},
            "alerts": [item.value for item in self.alerts],
            "repeats": [item.value for item in self.repeats],
            "errors": list(self.errors),
            "planner_hour": self.planner_hour,
            "load_alert": self.load_alert,
            "degrade": self.degrade,
        }


async def first_alert_today(redis: Redis, day: date, resource: Resource) -> bool:
    """True when this resource has not alerted today; a Redis error counts as first."""
    try:
        created = await redis.set(
            ALERT_PREFIX + day.isoformat() + ":" + resource.value,
            "1",
            ex=ALERT_TTL_SECONDS,
            nx=True,
        )
    except RedisError:
        return True
    return bool(created)


async def evaluate_degrade(
    redis: Redis,
    config: CostGuardSettings,
    now: datetime,
    result: CostGuardResult,
) -> None:
    logger = structlog.get_logger()
    seconds = config.cool_down_minutes * 60
    try:
        flag = await read_flag(redis)
        if result.load_alert and config.degrade_on_load:
            if result.dry_run:
                logger.warning(
                    "cost.guard.degrade_suppressed",
                    planner_hour=result.planner_hour,
                    threshold=config.planner_calls_per_hour,
                )
                result.degrade = "suppressed"
                return
            if flag is not None and flag.source == "ops" and flag.active(now):
                result.degrade = "operator"
                return
            await set_flag(redis, "cost_guard", "planner_load", now, seconds)
            result.degrade = "rearmed" if flag is not None and flag.active(now) else "on"
            logger.error(
                "cost.guard.degrade_on",
                state=result.degrade,
                planner_hour=result.planner_hour,
                threshold=config.planner_calls_per_hour,
                cool_down_seconds=seconds,
            )
            return
        if flag is None or flag.source != "cost_guard":
            return
        if flag.active(now):
            result.degrade = "cooling"
            return
        if result.dry_run:
            result.degrade = "clear_suppressed"
            return
        await clear_flag(redis)
        result.degrade = "off"
        logger.warning("cost.guard.degrade_off", planner_hour=result.planner_hour)
    except RedisError as error:
        result.errors.append("redis:" + type(error).__name__)
        result.degrade = "error"
        logger.warning("cost.guard.source_error", source="redis", error=type(error).__name__)


async def run_cost_guard(
    source: UsageSource,
    redis: Redis,
    config: CostGuardSettings,
    now: datetime,
    *,
    dry_run: bool,
) -> CostGuardResult:
    """One run: count, alert once per resource and day, then set or clear the degrade flag."""
    logger = structlog.get_logger()
    dry_run = dry_run or config.dry_run
    day = now.astimezone(UTC).date()
    result = CostGuardResult(day=day, dry_run=dry_run)
    counts: dict[Resource, int] = {}
    try:
        counts.update(await source.database_counts(day))
    except Exception as error:
        result.errors.append("database:" + type(error).__name__)
        logger.warning("cost.guard.source_error", source="database", error=type(error).__name__)
    try:
        today, busiest_hour = await planner_counts(redis, now)
        counts[Resource.PLANNER_CALLS] = today
        result.planner_hour = busiest_hour
        result.load_alert = over(busiest_hour, config.planner_calls_per_hour)
    except RedisError as error:
        result.errors.append("redis:" + type(error).__name__)
        logger.warning("cost.guard.source_error", source="redis", error=type(error).__name__)
    result.counts = counts
    thresholds: Mapping[Resource, int] = config.thresholds()
    for resource, count in counts.items():
        threshold = thresholds[resource]
        if not over(count, threshold):
            continue
        fields = {
            "resource": resource.value,
            "count": count,
            "threshold": threshold,
            "day": day.isoformat(),
        }
        if dry_run:
            logger.warning("cost.guard.alert_suppressed", dry_run=True, **fields)
            result.alerts.append(resource)
        elif await first_alert_today(redis, day, resource):
            logger.error("cost.guard.alert", dry_run=False, **fields)
            result.alerts.append(resource)
        else:
            result.repeats.append(resource)
    await evaluate_degrade(redis, config, now, result)
    logger.info(
        "cost.guard.run",
        day=day.isoformat(),
        dry_run=dry_run,
        alerts=len(result.alerts),
        errors=len(result.errors),
        degrade=result.degrade,
        **{"count_" + key.value: value for key, value in counts.items()},
    )
    return result
