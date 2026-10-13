"""`backup.verify` (ADR-0053): newest dump age and size against the thresholds.

The unit tests drive the job with a fake listing (fresh, stale, missing, empty object, too small,
no checksum, listing error); one test lists a real MinIO bucket through the worker job.
"""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import fakeredis
import pytest
from pydantic import SecretStr
from structlog.testing import capture_logs

from app.auth.authenticator import TokenSessionAuthenticator
from app.core.deps import Services
from app.models.session import create_engine, create_session_factory
from app.workers import main
from app.workers.backup_verify import (
    RESULT_KEY,
    SEEN_KEY,
    BackupObject,
    BackupVerifySettings,
    RedisSeenStore,
    VerifyStatus,
    evaluate,
    lister_from_settings,
    run_backup_verify,
)
from tests.support.app import (
    FixedClock,
    InMemoryRateLimiter,
    RecordingMailSender,
    StaticBreachChecker,
    make_test_settings,
)
from tests.support.storage import S3Endpoint

NOW = datetime(2026, 10, 13, 7, 30, tzinfo=UTC)
CANARY = "canary-" + uuid.uuid4().hex
CONFIG = BackupVerifySettings(
    endpoint_url="https://backup.example.test",
    access_key_id=SecretStr("verifier"),
    secret_access_key=SecretStr(CANARY),
    max_age_hours=26,
    min_size_bytes=4096,
)


def dump(hours_ago: float, size: int = 250_000, sidecar: bool = True) -> list[BackupObject]:
    modified = NOW - timedelta(hours=hours_ago)
    key = "inecekvar/inecekvar-" + modified.strftime("%Y%m%dT%H%M%SZ") + ".dump.age"
    objects = [BackupObject(key=key, size=size, last_modified=modified)]
    if sidecar:
        objects.append(BackupObject(key=key + ".sha256", size=99, last_modified=modified))
    return objects


class FakeLister:
    def __init__(self, objects: list[BackupObject] | None = None, error: Exception | None = None):
        self.objects = objects or []
        self.error = error
        self.calls: list[tuple[str, str]] = []

    async def list_objects(self, bucket: str, prefix: str) -> list[BackupObject]:
        self.calls.append((bucket, prefix))
        if self.error is not None:
            raise self.error
        return list(self.objects)


class Published:
    def __init__(self) -> None:
        self.payloads: list[str] = []

    async def __call__(self, payload: str) -> None:
        self.payloads.append(payload)


def test_fresh_dump_is_ok() -> None:
    result = evaluate(dump(hours_ago=5), CONFIG, NOW)
    assert result.status is VerifyStatus.OK
    assert result.age_seconds == 5 * 3600
    assert result.size_bytes == 250_000
    assert result.dumps == 1


def test_stale_dump_alerts() -> None:
    assert evaluate(dump(hours_ago=26.01), CONFIG, NOW).status is VerifyStatus.STALE
    assert evaluate(dump(hours_ago=26), CONFIG, NOW).status is VerifyStatus.OK


def test_missing_dump_alerts() -> None:
    assert evaluate([], CONFIG, NOW).status is VerifyStatus.MISSING
    # A sidecar, another prefix or a foreign name never counts as a dump.
    stray = [
        BackupObject("inecekvar/inecekvar-20261013T030000Z.dump.age.sha256", 99, NOW),
        BackupObject("other/inecekvar-20261013T030000Z.dump.age", 250_000, NOW),
        BackupObject("inecekvar/notes.txt", 250_000, NOW),
        BackupObject("inecekvar/nested/inecekvar-20261013T030000Z.dump.age", 250_000, NOW),
    ]
    assert evaluate(stray, CONFIG, NOW).status is VerifyStatus.MISSING


def test_empty_object_alerts() -> None:
    result = evaluate(dump(hours_ago=1, size=0), CONFIG, NOW)
    assert result.status is VerifyStatus.EMPTY
    assert result.size_bytes == 0


def test_too_small_object_alerts() -> None:
    assert evaluate(dump(hours_ago=1, size=4095), CONFIG, NOW).status is VerifyStatus.TOO_SMALL
    assert evaluate(dump(hours_ago=1, size=4096), CONFIG, NOW).status is VerifyStatus.OK


def test_missing_checksum_alerts() -> None:
    assert evaluate(dump(hours_ago=1, sidecar=False), CONFIG, NOW).status is (
        VerifyStatus.NO_CHECKSUM
    )


def test_newest_dump_decides() -> None:
    objects = dump(hours_ago=25) + dump(hours_ago=1, size=0)
    result = evaluate(objects, CONFIG, NOW)
    assert result.status is VerifyStatus.EMPTY
    assert result.dumps == 2
    older_good_newest_stale = dump(hours_ago=60) + dump(hours_ago=30)
    assert evaluate(older_good_newest_stale, CONFIG, NOW).status is VerifyStatus.STALE


def test_future_key_stamp_alerts() -> None:
    planted = BackupObject("inecekvar/inecekvar-29991231T235959Z.dump.age", 250_000, NOW)
    sidecar = BackupObject(planted.key + ".sha256", 99, NOW)
    result = evaluate([*dump(hours_ago=5), planted, sidecar], CONFIG, NOW)
    assert result.status is VerifyStatus.FUTURE_STAMP
    assert result.suspect_key == planted.key
    # Within the clock tolerance a stamp a few minutes ahead is fine.
    ahead = NOW + timedelta(minutes=5)
    key = "inecekvar/inecekvar-" + ahead.strftime("%Y%m%dT%H%M%SZ") + ".dump.age"
    near = [BackupObject(key, 250_000, NOW), BackupObject(key + ".sha256", 99, NOW)]
    assert evaluate(near, CONFIG, NOW).status is VerifyStatus.OK


def test_stamp_far_from_last_modified_alerts() -> None:
    # An old key overwritten an hour ago: its stamp is days before its LastModified.
    old = dump(hours_ago=24 * 5)
    overwritten = [BackupObject(item.key, item.size, NOW - timedelta(hours=1)) for item in old]
    result = evaluate([*dump(hours_ago=3), *overwritten], CONFIG, NOW)
    assert result.status is VerifyStatus.STAMP_SKEW
    assert result.suspect_key == old[0].key
    # A slow upload within the allowed skew stays fine.
    slow = [
        BackupObject(item.key, item.size, item.last_modified + timedelta(hours=5))
        for item in dump(hours_ago=8)
    ]
    assert evaluate(slow, CONFIG, NOW).status is VerifyStatus.OK
    impossible = [BackupObject("inecekvar/inecekvar-20261399T000000Z.dump.age", 250_000, NOW)]
    assert evaluate(impossible, CONFIG, NOW).status is VerifyStatus.STAMP_SKEW


def test_changed_etag_or_size_of_a_seen_key_alerts() -> None:
    objects = [
        BackupObject(item.key, item.size, item.last_modified, etag='"abc"')
        for item in dump(hours_ago=4)
    ]
    seen = {item.key: item.fingerprint() for item in objects}
    assert evaluate(objects, CONFIG, NOW, seen).status is VerifyStatus.OK
    same_size = [
        BackupObject(objects[0].key, objects[0].size, objects[0].last_modified, '"def"'),
        objects[1],
    ]
    result = evaluate(same_size, CONFIG, NOW, seen)
    assert result.status is VerifyStatus.CHANGED
    assert (result.suspect_key, result.changed) == (objects[0].key, 1)
    resized = [objects[0], BackupObject(objects[1].key, 100, objects[1].last_modified, '"abc"')]
    assert evaluate(resized, CONFIG, NOW, seen).status is VerifyStatus.CHANGED
    # A key not seen before, or one that expired from the bucket, is not a change.
    assert evaluate(objects + dump(hours_ago=1), CONFIG, NOW, seen).status is VerifyStatus.OK


@pytest.mark.anyio
async def test_seen_listing_is_kept_in_redis_and_alerts_once() -> None:
    redis = fakeredis.FakeAsyncRedis()
    try:
        store = RedisSeenStore(redis)
        objects = [
            BackupObject(item.key, item.size, item.last_modified, etag='"abc"')
            for item in dump(hours_ago=2)
        ]
        lister = FakeLister(objects)
        first = await run_backup_verify(
            lister, CONFIG, NOW, None, dry_run=False, require_configured=True, seen=store
        )
        assert first.ok
        assert set(await store.load()) == {item.key for item in objects}
        assert await redis.ttl(SEEN_KEY) > 0
        lister.objects = [
            BackupObject(objects[0].key, objects[0].size, objects[0].last_modified, '"zzz"'),
            objects[1],
        ]
        with capture_logs() as logs:
            dry = await run_backup_verify(
                lister, CONFIG, NOW, None, dry_run=True, require_configured=True, seen=store
            )
            changed = await run_backup_verify(
                lister, CONFIG, NOW, None, dry_run=False, require_configured=True, seen=store
            )
            again = await run_backup_verify(
                lister, CONFIG, NOW, None, dry_run=False, require_configured=True, seen=store
            )
        # A dry run compares but does not remember.
        assert dry.status is changed.status is VerifyStatus.CHANGED
        assert again.ok
        alert = [entry for entry in logs if entry["event"] == "backup.verify.alert"]
        assert [entry["status"] for entry in alert] == ["changed"]
        assert alert[0]["suspect_key"] == objects[0].key
    finally:
        await redis.aclose()


@pytest.mark.anyio
async def test_listing_error_alerts_without_secrets() -> None:
    lister = FakeLister(error=RuntimeError("https://verifier:" + CANARY + "@backup.example.test"))
    published = Published()
    with capture_logs() as logs:
        result = await run_backup_verify(
            lister, CONFIG, NOW, published, dry_run=False, require_configured=True
        )
    assert result.status is VerifyStatus.LISTING_ERROR
    assert result.error == "RuntimeError"
    assert [entry["event"] for entry in logs] == ["backup.verify.alert"]
    assert logs[0]["log_level"] == "error"
    assert CANARY not in json.dumps(logs, default=str)
    assert CANARY not in published.payloads[0]
    assert "backup.example.test" not in json.dumps(logs, default=str)


@pytest.mark.anyio
async def test_alert_line_and_published_result() -> None:
    lister = FakeLister(dump(hours_ago=30))
    published = Published()
    with capture_logs() as logs:
        result = await run_backup_verify(
            lister, CONFIG, NOW, published, dry_run=False, require_configured=True
        )
    assert lister.calls == [("inecekvar-backups", "inecekvar/")]
    assert result.status is VerifyStatus.STALE
    (entry,) = logs
    assert entry["event"] == "backup.verify.alert"
    assert entry["log_level"] == "error"
    assert entry["status"] == "stale"
    assert entry["age_seconds"] == 30 * 3600
    assert entry["max_age_seconds"] == 26 * 3600
    assert entry["newest_key"].startswith("inecekvar/inecekvar-")
    assert CANARY not in json.dumps(logs, default=str)
    (payload,) = published.payloads
    assert json.loads(payload)["status"] == "stale"
    assert json.loads(payload)["checked_at"] == NOW.isoformat()


@pytest.mark.anyio
async def test_ok_logs_info_and_publishes() -> None:
    published = Published()
    with capture_logs() as logs:
        result = await run_backup_verify(
            FakeLister(dump(hours_ago=2)),
            CONFIG,
            NOW,
            published,
            dry_run=False,
            require_configured=True,
        )
    assert result.ok
    assert [(entry["event"], entry["log_level"]) for entry in logs] == [
        ("backup.verify.ok", "info")
    ]
    assert json.loads(published.payloads[0])["status"] == "ok"


@pytest.mark.anyio
async def test_dry_run_suppresses_the_alert_and_writes_nothing() -> None:
    published = Published()
    with capture_logs() as logs:
        result = await run_backup_verify(
            FakeLister([]), CONFIG, NOW, published, dry_run=True, require_configured=True
        )
    assert result.status is VerifyStatus.MISSING
    assert [(entry["event"], entry["log_level"]) for entry in logs] == [
        ("backup.verify.alert_suppressed", "warning")
    ]
    assert published.payloads == []


@pytest.mark.anyio
async def test_unconfigured_verifier_alerts_only_when_required() -> None:
    published = Published()
    with capture_logs() as logs:
        required = await run_backup_verify(
            None, CONFIG, NOW, published, dry_run=False, require_configured=True
        )
        skipped = await run_backup_verify(
            None, CONFIG, NOW, published, dry_run=False, require_configured=False
        )
    assert required.status is skipped.status is VerifyStatus.NOT_CONFIGURED
    assert [entry["event"] for entry in logs] == [
        "backup.verify.alert",
        "backup.verify.skipped_not_configured",
    ]
    assert len(published.payloads) == 1


def test_lister_needs_an_endpoint_outside_local() -> None:
    blank = BackupVerifySettings(endpoint_url=None)
    assert lister_from_settings(blank, make_test_settings()) is None
    local = make_test_settings(env="local", s3_endpoint_url="http://localhost:57900")
    assert lister_from_settings(blank, local) is not None
    assert lister_from_settings(CONFIG, make_test_settings()) is not None


def test_settings_read_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INECEKVAR_BACKUP_VERIFY_MAX_AGE_HOURS", "30")
    monkeypatch.setenv("INECEKVAR_BACKUP_VERIFY_MIN_SIZE_BYTES", "10000")
    monkeypatch.setenv("INECEKVAR_BACKUP_VERIFY_PREFIX", "prod/")
    config = BackupVerifySettings()
    assert (config.max_age_hours, config.min_size_bytes, config.prefix) == (30, 10000, "prod/")
    monkeypatch.setenv("INECEKVAR_BACKUP_VERIFY_PREFIX", "no-slash")
    with pytest.raises(ValueError, match="prefix"):
        BackupVerifySettings()


@pytest.fixture
async def job_services() -> AsyncIterator[Services]:
    settings = make_test_settings()
    clock = FixedClock(current=datetime.now(UTC))
    engine = create_engine("postgresql+asyncpg://unused:unused@127.0.0.1:9/unused")
    redis = fakeredis.FakeAsyncRedis()
    try:
        yield Services(
            settings=settings,
            session_factory=create_session_factory(engine),
            redis=redis,
            rate_limiter=InMemoryRateLimiter(settings.rate_limit_rules, clock),
            authenticator=TokenSessionAuthenticator(settings, clock),
            mail_sender=RecordingMailSender(),
            breach_checker=StaticBreachChecker(),
            clock=clock,
        )
    finally:
        await redis.aclose()
        await engine.dispose()


@pytest.mark.anyio
async def test_job_lists_a_real_bucket(
    job_services: Services, s3_endpoint: S3Endpoint, monkeypatch: pytest.MonkeyPatch
) -> None:
    bucket = "backups-" + uuid.uuid4().hex[:12]
    store = lister_from_settings(
        BackupVerifySettings(
            endpoint_url=s3_endpoint.url,
            region="us-east-1",
            access_key_id=SecretStr(s3_endpoint.access_key),
            secret_access_key=SecretStr(s3_endpoint.secret_key),
        )
    )
    assert store is not None
    store.client.create_bucket(Bucket=bucket)
    for name, value in {
        "ENDPOINT_URL": s3_endpoint.url,
        "REGION": "us-east-1",
        "ACCESS_KEY_ID": s3_endpoint.access_key,
        "SECRET_ACCESS_KEY": s3_endpoint.secret_key,
        "BUCKET": bucket,
    }.items():
        monkeypatch.setenv("INECEKVAR_BACKUP_VERIFY_" + name, value)
    ctx: dict[str, Any] = {"services": job_services}

    assert (await main.backup_verify_job(ctx))["status"] == "missing"

    key = "inecekvar/inecekvar-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".dump.age"
    store.client.put_object(Bucket=bucket, Key=key, Body=b"")
    store.client.put_object(Bucket=bucket, Key=key + ".sha256", Body=b"0" * 64)
    assert (await main.backup_verify_job(ctx))["status"] == "empty"

    # Overwriting a key seen on an earlier run is a tamper sign on real MinIO (ETag and size).
    store.client.put_object(Bucket=bucket, Key=key, Body=b"age-encryption.org/v1\n" * 400)
    changed = await main.backup_verify_job(ctx)
    assert changed["status"] == "changed"
    assert changed["suspect_key"] == key
    # The change alerts once; the new listing is remembered.
    result = await main.backup_verify_job(ctx)
    assert result["status"] == "ok"
    assert result["newest_key"] == key
    stored = await job_services.redis.get(RESULT_KEY)
    assert stored is not None
    assert json.loads(stored)["status"] == "ok"

    dry = await main.backup_verify_job(ctx, dry_run=True)
    assert dry["status"] == "ok"
