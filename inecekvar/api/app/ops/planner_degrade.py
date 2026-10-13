"""Switch the planner degrade flag by hand (spec section 6 item 22, ADR-0054).

    uv run python -m app.ops.planner_degrade on [--minutes 60] [--reason cpu_alert]
        [--operator NAME]
    uv run python -m app.ops.planner_degrade off [--operator NAME]
    uv run python -m app.ops.planner_degrade status

`on` sets the flag with source `ops` for `--minutes` (1 to 1440, default 60); the `cost.guard`
job never clears an operator flag, it expires or is switched `off`. `off` removes any flag,
including one the guard set. Every switch writes one `ops.planner_degrade` audit line to stderr
(action, previous state, source, reason, lifetime, operator label; no address, no credential)
and every command prints the resulting state as JSON on stdout.

Only `INECEKVAR_REDIS_URL` is read, so the command runs on the API host without the API secrets.
Reasons and operator labels are short slugs (`[a-z0-9_-]{1,40}`), never free text.
"""

import argparse
import asyncio
import json
import re
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

import structlog
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis

from app.planner.degrade import (
    DEFAULT_FLAG_SECONDS,
    MAX_FLAG_SECONDS,
    clear_flag,
    read_flag,
    set_flag,
)

SLUG = r"^[a-z0-9_-]{1,40}$"


class OpsRedisSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="INECEKVAR_", extra="ignore", frozen=True, case_sensitive=False
    )

    redis_url: SecretStr | None = None


def slug(value: str) -> str:
    if re.fullmatch(SLUG, value) is None:
        raise argparse.ArgumentTypeError("use 1 to 40 characters of a-z, 0-9, _ and -")
    return value


def minutes(value: str) -> int:
    number = int(value)
    if not 1 <= number <= MAX_FLAG_SECONDS // 60:
        raise argparse.ArgumentTypeError("minutes must be between 1 and 1440")
    return number


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="python -m app.ops.planner_degrade")
    commands = root.add_subparsers(dest="command", required=True)
    on = commands.add_parser("on", help="force degraded planning")
    on.add_argument("--minutes", type=minutes, default=DEFAULT_FLAG_SECONDS // 60)
    on.add_argument("--reason", type=slug, default="manual")
    on.add_argument("--operator", type=slug, default="unspecified")
    off = commands.add_parser("off", help="end degraded planning")
    off.add_argument("--operator", type=slug, default="unspecified")
    commands.add_parser("status", help="print the flag")
    return root


def state(flag_dict: dict[str, str] | None, now: datetime) -> dict[str, object]:
    if flag_dict is None:
        return {"active": False, "flag": None}
    expires = datetime.fromisoformat(flag_dict["expires_at"])
    return {"active": expires > now, "flag": flag_dict}


async def run(
    args: argparse.Namespace, redis: Redis, now: datetime, logger: Any
) -> dict[str, object]:
    before = await read_flag(redis)
    previous = "on" if before is not None and before.active(now) else "off"
    if args.command == "on":
        flag = await set_flag(redis, "ops", args.reason, now, args.minutes * 60)
        logger.warning(
            "ops.planner_degrade",
            action="on",
            previous=previous,
            source="ops",
            reason=args.reason,
            ttl_seconds=args.minutes * 60,
            operator=args.operator,
        )
        return state(flag.as_dict(), now)
    if args.command == "off":
        removed = await clear_flag(redis)
        logger.warning(
            "ops.planner_degrade",
            action="off",
            previous=previous,
            removed=removed,
            previous_source=before.source if before is not None else None,
            operator=args.operator,
        )
        return state(None, now)
    return state(before.as_dict() if before is not None else None, now)


RedisFactory = Callable[[], Redis]


def redis_from_environment() -> Redis:
    url = OpsRedisSettings().redis_url
    if url is None:
        raise SystemExit("INECEKVAR_REDIS_URL is required")
    return Redis.from_url(url.get_secret_value())


async def _main(args: argparse.Namespace, factory: RedisFactory, logger: Any) -> dict[str, object]:
    redis = factory()
    try:
        return await run(args, redis, datetime.now(UTC), logger)
    finally:
        await redis.aclose()


def audit_logger() -> Any:
    """A JSON logger on stderr, local to the command (no global logging configuration)."""
    return structlog.wrap_logger(
        structlog.PrintLogger(sys.stderr),
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
    )


def main(argv: Sequence[str] | None = None, factory: RedisFactory | None = None) -> int:
    args = parser().parse_args(argv)
    result = asyncio.run(_main(args, factory or redis_from_environment, audit_logger()))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
