from typing import Any

import pytest

from app.core.deps import Services
from app.workers import main
from tests.support.storage import S3Buckets

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def test_schedule() -> None:
    jobs = {job.name: job for job in main.CRON_JOBS}
    assert set(jobs) == {
        "cron:photos_job",
        "cron:traces_job",
        "cron:deletion_job",
        "cron:export_job",
        "cron:webhooks_pending_job",
    }
    export = jobs["cron:export_job"]
    assert (export.weekday, export.hour, export.minute) == ("mon", 3, 0)
    assert jobs["cron:traces_job"].minute == 5
    assert jobs["cron:deletion_job"].minute == 20
    assert jobs["cron:webhooks_pending_job"].minute == set(range(0, 60, 5))


def test_worker_settings_resolve_lazily(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INECEKVAR_ENV", "local")
    monkeypatch.setenv("INECEKVAR_REDIS_URL", "redis://127.0.0.1:57379/3")
    settings = main.WorkerSettings
    assert settings.redis_settings.database == 3
    assert str(settings.timezone) == "Europe/Istanbul"
    with pytest.raises(AttributeError):
        _ = main.NotAWorkerSetting


async def test_jobs_run_against_real_services(
    services: Services, sample: object, s3_buckets: S3Buckets
) -> None:
    ctx: dict[str, Any] = {"services": services}
    services.object_store = None
    assert await main.photos_job(ctx) == 0
    assert await main.export_job(ctx) == 0
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    services.object_store = s3_buckets.store
    assert await main.traces_job(ctx) == 0
    assert await main.photos_job(ctx) == 0
    assert await main.deletion_job(ctx) == 0
    assert await main.export_job(ctx) == 1
