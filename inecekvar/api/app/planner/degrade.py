"""Planner degrade flag and planner call counter (spec section 6 item 22, ADR-0054).

The flag lives in Redis under `DEGRADE_KEY` as JSON (`source`, `reason`, `set_at`,
`expires_at`) with a Redis expiry equal to its lifetime. While it is active the planner answers
with at most one transfer, a short search budget, `degraded=true` and a longer cache lifetime.
Two writers exist: the `cost.guard` worker job when the hourly planner load alert fires (source
`cost_guard`, cleared after the cool-down) and the operator command
`python -m app.ops.planner_degrade` (source `ops`).

A flag counts as active only while its key exists and `expires_at` lies in the future, so an
expiry holds even when the Redis expiry was lost. A Redis error or an unreadable value reads as
inactive: the planner keeps its own timeout and the hourly rate limit either way.

`count_planner_call` adds one computed plan (a cache miss) to the hour bucket the guard reads;
it never fails a plan.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from redis.asyncio import Redis
from redis.exceptions import RedisError

DEGRADE_KEY = "inecekvar:ops:planner-degrade"
PLANNER_CALLS_PREFIX = "inecekvar:cost:planner-calls:"
PLANNER_CALLS_TTL_SECONDS = 3 * 24 * 60 * 60

DEGRADED_MAX_TRANSFERS = 1
DEGRADED_TIMEOUT_SECONDS = 1.0
# Degraded answers stay cached three times longer than the default ten minutes.
DEGRADED_CACHE_TTL_SECONDS = 1800
DEFAULT_FLAG_SECONDS = 60 * 60
MAX_FLAG_SECONDS = 24 * 60 * 60

Source = Literal["cost_guard", "ops"]


@dataclass(frozen=True, slots=True)
class DegradeFlag:
    source: str
    reason: str
    set_at: datetime
    expires_at: datetime

    def active(self, now: datetime) -> bool:
        return self.expires_at > now

    def as_dict(self) -> dict[str, str]:
        return {
            "source": self.source,
            "reason": self.reason,
            "set_at": self.set_at.astimezone(UTC).isoformat(),
            "expires_at": self.expires_at.astimezone(UTC).isoformat(),
        }


def hour_key(moment: datetime) -> str:
    return PLANNER_CALLS_PREFIX + moment.astimezone(UTC).strftime("%Y%m%d%H")


def parse_flag(raw: bytes | str | None) -> DegradeFlag | None:
    if raw is None:
        return None
    try:
        data = json.loads(raw)
        return DegradeFlag(
            source=str(data["source"]),
            reason=str(data["reason"]),
            set_at=datetime.fromisoformat(data["set_at"]),
            expires_at=datetime.fromisoformat(data["expires_at"]),
        )
    except (ValueError, KeyError, TypeError):
        return None


async def read_flag(redis: Redis) -> DegradeFlag | None:
    """The stored flag, expired or not; None when absent, unreadable or Redis fails."""
    try:
        raw = await redis.get(DEGRADE_KEY)
    except RedisError:
        return None
    return parse_flag(raw)


async def degrade_active(redis: Redis, now: datetime) -> bool:
    flag = await read_flag(redis)
    return flag is not None and flag.active(now)


async def set_flag(
    redis: Redis, source: Source, reason: str, now: datetime, seconds: int
) -> DegradeFlag:
    """Write (or re-arm) the flag for `seconds`; Redis errors propagate to the caller."""
    if not 1 <= seconds <= MAX_FLAG_SECONDS:
        raise ValueError("flag lifetime must be between 1 second and 24 hours")
    flag = DegradeFlag(source, reason, now, now + timedelta(seconds=seconds))
    await redis.set(DEGRADE_KEY, json.dumps(flag.as_dict(), sort_keys=True), ex=seconds)
    return flag


async def clear_flag(redis: Redis) -> bool:
    return bool(await redis.delete(DEGRADE_KEY))


async def count_planner_call(redis: Redis, now: datetime) -> None:
    key = hour_key(now)
    try:
        async with redis.pipeline(transaction=False) as pipe:
            pipe.incr(key)
            pipe.expire(key, PLANNER_CALLS_TTL_SECONDS)
            await pipe.execute()
    except RedisError:
        return
