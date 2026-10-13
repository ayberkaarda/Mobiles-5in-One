"""`backup.verify`: is the newest database dump fresh and plausible (spec section 6 item 20)?

`ops/backup/backup.sh` uploads `<prefix>inecekvar-<UTC stamp>.dump.age` and a `.sha256` sidecar
once a day. This job lists the backup prefix with a list-only identity (it can read neither the
dumps nor anything else), takes the newest dump and checks its age and size against the
thresholds below. A failed check logs one structured `backup.verify.alert` line at error level
(status, key, age, size and thresholds; never a credential or an endpoint) for the log-based
alert, and the result is kept in Redis under `RESULT_KEY` for the ops documents
(docs/ops/backup-restore.md, ADR-0053). A dry run logs `backup.verify.alert_suppressed`
instead and writes nothing.

Tamper checks (phase 6 review F3): the write-only identity of the backup host may overwrite an
existing key. The job therefore also alerts when a dump's key stamp lies in the future
(`future_stamp`), when the stamp and the object's `LastModified` differ by more than
`max_stamp_skew_hours` (`stamp_skew`: an overwrite of an old key shows a large skew), and, in
the worker, when the ETag or size of a key seen on an earlier run has changed (`changed`; the
last listing is kept in the Redis hash `SEEN_KEY`). A change alerts once: the new listing is
remembered after the alert.

Settings come from `INECEKVAR_BACKUP_VERIFY_*` environment values (docs/ops/env.md). Outside
`local` an unconfigured verifier is itself an alert in production and a logged skip otherwise.

`uv run python -m app.workers.backup_verify [--dry-run]` runs the check once with explicit
settings only and prints the result as JSON (exit 0 ok, 1 alert); the restore drill uses it.
"""

import argparse
import asyncio
import json
import re
import sys
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Protocol

import anyio
import boto3
import structlog
from botocore.config import Config
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client
    from redis.asyncio import Redis

RESULT_KEY = "inecekvar:ops:backup-verify:last"
RESULT_TTL_SECONDS = 8 * 24 * 60 * 60
SEEN_KEY = "inecekvar:ops:backup-verify:seen"
SEEN_TTL_SECONDS = 40 * 24 * 60 * 60
DUMP_NAME = re.compile(r"inecekvar-([0-9]{8}T[0-9]{6}Z)\.dump\.age")
STAMP_FORMAT = "%Y%m%dT%H%M%SZ"


class BackupVerifySettings(BaseSettings):
    """Thresholds and the list-only identity of the backup bucket."""

    model_config = SettingsConfigDict(
        env_prefix="INECEKVAR_BACKUP_VERIFY_",
        extra="ignore",
        frozen=True,
        case_sensitive=False,
    )

    endpoint_url: str | None = None
    region: str = "auto"
    access_key_id: SecretStr | None = None
    secret_access_key: SecretStr | None = None
    bucket: str = "inecekvar-backups"
    prefix: str = Field(default="inecekvar/", pattern=r"^([A-Za-z0-9._-]+/)*$")
    # A daily dump plus two hours of slack for a slow run.
    max_age_hours: float = Field(default=26.0, gt=0, le=24 * 14)
    # The schema alone dumps to several kilobytes; anything smaller is not a usable backup.
    min_size_bytes: int = Field(default=4096, ge=1)
    # The dump is uploaded minutes after its stamp; an overwrite days later shows as skew.
    max_stamp_skew_hours: float = Field(default=6.0, gt=0, le=48)
    # Clock skew allowed between the backup host and the verifier before a stamp is "future".
    future_tolerance_minutes: int = Field(default=10, ge=0, le=120)


@dataclass(frozen=True, slots=True)
class BackupObject:
    key: str
    size: int
    last_modified: datetime
    etag: str | None = None

    def fingerprint(self) -> str:
        return f"{self.etag or ''}:{self.size}"


class BackupLister(Protocol):
    async def list_objects(self, bucket: str, prefix: str) -> list[BackupObject]: ...


class S3BackupLister:
    """ListObjectsV2 only: size and modification time come with the listing."""

    def __init__(self, client: "S3Client") -> None:
        self.client = client

    async def list_objects(self, bucket: str, prefix: str) -> list[BackupObject]:
        def collect() -> list[BackupObject]:
            found: list[BackupObject] = []
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for item in page.get("Contents", []):
                    found.append(
                        BackupObject(
                            key=str(item["Key"]),
                            size=int(item.get("Size", 0)),
                            last_modified=item["LastModified"],
                            etag=str(item["ETag"]) if item.get("ETag") else None,
                        )
                    )
            return found

        return await anyio.to_thread.run_sync(collect)


def lister_from_settings(
    config: BackupVerifySettings, app_settings: Settings | None = None
) -> S3BackupLister | None:
    """The S3 lister, or None when no endpoint is configured. Only `local` falls back to the
    compose MinIO endpoint and identity of the API settings."""
    endpoint = config.endpoint_url
    access = config.access_key_id
    secret = config.secret_access_key
    if app_settings is not None and app_settings.env == "local":
        endpoint = endpoint or app_settings.s3_endpoint_url
        if access is None and secret is None:
            access = app_settings.s3_access_key_id
            secret = app_settings.s3_secret_access_key
    if endpoint is None:
        return None
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=config.region,
        aws_access_key_id=access.get_secret_value() if access is not None else None,
        aws_secret_access_key=secret.get_secret_value() if secret is not None else None,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=10,
            read_timeout=30,
        ),
    )
    return S3BackupLister(client)


class VerifyStatus(StrEnum):
    OK = "ok"
    STALE = "stale"
    MISSING = "missing"
    EMPTY = "empty"
    TOO_SMALL = "too_small"
    NO_CHECKSUM = "no_checksum"
    FUTURE_STAMP = "future_stamp"
    STAMP_SKEW = "stamp_skew"
    CHANGED = "changed"
    LISTING_ERROR = "listing_error"
    NOT_CONFIGURED = "not_configured"


@dataclass(frozen=True, slots=True)
class BackupVerifyResult:
    status: VerifyStatus
    checked_at: datetime
    bucket: str
    prefix: str
    max_age_seconds: int
    min_size_bytes: int
    dumps: int = 0
    newest_key: str | None = None
    age_seconds: int | None = None
    size_bytes: int | None = None
    error: str | None = None
    suspect_key: str | None = None
    changed: int = 0

    @property
    def ok(self) -> bool:
        return self.status is VerifyStatus.OK

    def as_dict(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "checked_at": self.checked_at.astimezone(UTC).isoformat(),
            "bucket": self.bucket,
            "prefix": self.prefix,
            "dumps": self.dumps,
            "newest_key": self.newest_key,
            "age_seconds": self.age_seconds,
            "size_bytes": self.size_bytes,
            "max_age_seconds": self.max_age_seconds,
            "min_size_bytes": self.min_size_bytes,
            "error": self.error,
            "suspect_key": self.suspect_key,
            "changed": self.changed,
        }


def _result(
    status: VerifyStatus,
    config: BackupVerifySettings,
    now: datetime,
    *,
    dumps: int = 0,
    newest: BackupObject | None = None,
    age: timedelta | None = None,
    error: str | None = None,
    suspect: str | None = None,
    changed: int = 0,
) -> BackupVerifyResult:
    return BackupVerifyResult(
        status=status,
        checked_at=now,
        bucket=config.bucket,
        prefix=config.prefix,
        max_age_seconds=int(timedelta(hours=config.max_age_hours).total_seconds()),
        min_size_bytes=config.min_size_bytes,
        dumps=dumps,
        newest_key=newest.key if newest is not None else None,
        age_seconds=int(age.total_seconds()) if age is not None else None,
        size_bytes=newest.size if newest is not None else None,
        error=error,
        suspect_key=suspect,
        changed=changed,
    )


def key_stamp(key: str) -> datetime | None:
    """The UTC stamp embedded in a dump key, or None when it is not a valid date."""
    match = DUMP_NAME.search(key)
    if match is None:
        return None
    try:
        return datetime.strptime(match[1], STAMP_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None


def stamp_problem(
    item: BackupObject, config: BackupVerifySettings, now: datetime
) -> VerifyStatus | None:
    """`future_stamp` or `stamp_skew` for one dump, None when its stamp is plausible."""
    stamp = key_stamp(item.key)
    if stamp is None:
        return VerifyStatus.STAMP_SKEW
    if stamp > now + timedelta(minutes=config.future_tolerance_minutes):
        return VerifyStatus.FUTURE_STAMP
    if abs(item.last_modified - stamp) > timedelta(hours=config.max_stamp_skew_hours):
        return VerifyStatus.STAMP_SKEW
    return None


def changed_keys(objects: Sequence[BackupObject], seen: Mapping[str, str]) -> list[str]:
    """Keys of an earlier listing whose ETag or size is different now."""
    return sorted(
        item.key for item in objects if item.key in seen and seen[item.key] != item.fingerprint()
    )


def evaluate(
    objects: Sequence[BackupObject],
    config: BackupVerifySettings,
    now: datetime,
    seen: Mapping[str, str] | None = None,
) -> BackupVerifyResult:
    """Pure decision over one listing: tamper signs first, then the newest dump decides."""
    keys = {item.key for item in objects}
    dumps = [
        item
        for item in objects
        if item.key.startswith(config.prefix)
        and DUMP_NAME.fullmatch(item.key[len(config.prefix) :]) is not None
    ]
    if not dumps:
        return _result(VerifyStatus.MISSING, config, now)
    newest = max(dumps, key=lambda item: (item.last_modified, item.key))
    age = max(now - newest.last_modified, timedelta(0))
    changed = changed_keys(objects, seen) if seen is not None else []
    if changed:
        return _result(
            VerifyStatus.CHANGED,
            config,
            now,
            dumps=len(dumps),
            newest=newest,
            age=age,
            suspect=changed[0],
            changed=len(changed),
        )
    for problem in (VerifyStatus.FUTURE_STAMP, VerifyStatus.STAMP_SKEW):
        suspects = sorted(item.key for item in dumps if stamp_problem(item, config, now) is problem)
        if suspects:
            return _result(
                problem, config, now, dumps=len(dumps), newest=newest, age=age, suspect=suspects[0]
            )
    if newest.size <= 0:
        status = VerifyStatus.EMPTY
    elif newest.size < config.min_size_bytes:
        status = VerifyStatus.TOO_SMALL
    elif age > timedelta(hours=config.max_age_hours):
        status = VerifyStatus.STALE
    elif newest.key + ".sha256" not in keys:
        status = VerifyStatus.NO_CHECKSUM
    else:
        status = VerifyStatus.OK
    return _result(status, config, now, dumps=len(dumps), newest=newest, age=age)


class SeenStore(Protocol):
    """The ETag and size of every key of the last listing (the worker keeps it in Redis)."""

    async def load(self) -> dict[str, str]: ...

    async def save(self, fingerprints: dict[str, str]) -> None: ...


class RedisSeenStore:
    def __init__(self, redis: "Redis") -> None:
        self.redis = redis

    async def load(self) -> dict[str, str]:
        raw = await self.redis.hgetall(SEEN_KEY)
        return {_text(key): _text(value) for key, value in raw.items()}

    async def save(self, fingerprints: dict[str, str]) -> None:
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.delete(SEEN_KEY)
            if fingerprints:
                mapping: dict[Any, Any] = dict(fingerprints)
                pipe.hset(SEEN_KEY, mapping=mapping)
                pipe.expire(SEEN_KEY, SEEN_TTL_SECONDS)
            await pipe.execute()


def _text(value: object) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


async def verify_backups(
    lister: BackupLister,
    config: BackupVerifySettings,
    now: datetime,
    seen: SeenStore | None = None,
    *,
    remember: bool = False,
) -> BackupVerifyResult:
    try:
        objects = await lister.list_objects(config.bucket, config.prefix)
    except Exception as error:
        # The class name only: messages of storage clients may carry the endpoint or a request
        # URL, and an alert line must never carry either.
        return _result(VerifyStatus.LISTING_ERROR, config, now, error=type(error).__name__)
    previous: dict[str, str] | None = None
    if seen is not None:
        try:
            previous = await seen.load()
        except Exception as error:
            structlog.get_logger().warning(
                "backup.verify.seen_unavailable", error=type(error).__name__
            )
    result = evaluate(objects, config, now, previous)
    if seen is not None and remember and previous is not None:
        try:
            await seen.save({item.key: item.fingerprint() for item in objects})
        except Exception as error:
            structlog.get_logger().warning(
                "backup.verify.seen_unavailable", error=type(error).__name__
            )
    return result


Publisher = Callable[[str], Awaitable[None]]


async def run_backup_verify(
    lister: BackupLister | None,
    config: BackupVerifySettings,
    now: datetime,
    publish: Publisher | None,
    *,
    dry_run: bool,
    require_configured: bool,
    seen: SeenStore | None = None,
) -> BackupVerifyResult:
    """One run: check, log one line, keep the result and the listing (not in a dry run)."""
    logger = structlog.get_logger()
    if lister is None:
        result = _result(VerifyStatus.NOT_CONFIGURED, config, now)
        if not require_configured:
            logger.warning("backup.verify.skipped_not_configured", dry_run=dry_run)
            return result
    else:
        result = await verify_backups(lister, config, now, seen, remember=not dry_run)
    fields = {key: value for key, value in result.as_dict().items() if key != "checked_at"}
    if result.ok:
        logger.info("backup.verify.ok", dry_run=dry_run, **fields)
    elif dry_run:
        logger.warning("backup.verify.alert_suppressed", dry_run=True, **fields)
    else:
        logger.error("backup.verify.alert", dry_run=False, **fields)
    if not dry_run and publish is not None:
        await publish(json.dumps(result.as_dict(), sort_keys=True))
    return result


async def _run_once(dry_run: bool) -> BackupVerifyResult:
    config = BackupVerifySettings()
    lister = lister_from_settings(config)
    return await run_backup_verify(
        lister, config, datetime.now(UTC), None, dry_run=dry_run, require_configured=True
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.workers.backup_verify")
    parser.add_argument("--dry-run", action="store_true", help="log a suppressed alert only")
    args = parser.parse_args(argv)
    structlog.configure(logger_factory=structlog.PrintLoggerFactory(sys.stderr))
    result = asyncio.run(_run_once(args.dry_run))
    print(json.dumps(result.as_dict(), sort_keys=True))
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
