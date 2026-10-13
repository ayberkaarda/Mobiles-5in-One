"""Nightly jobs (ADR-0050): idempotent, dry-run honoured, counts only."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.core.deps import Services
from app.core.ids import uuid7
from app.models.billing import PackDownload, PackDownloadStat, Subscription
from app.models.ops import EmailSuppression, WebhookEvent
from app.workers import main as worker
from app.workers.nightly import purge_retention, roll_up_pack_downloads, sweep_expired_entitlements
from tests.domain.conftest import Sample
from tests.support.app import FixedClock
from tests.support.billing import PLUS_PRODUCT, FakeRevenueCat
from tests.support.domain import create_account

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def count(services: Services, model: Any) -> int:
    async with services.session_factory() as db:
        return int(await db.scalar(select(func.count()).select_from(model)) or 0)


async def test_entitlement_sweep(services: Services, clock: FixedClock) -> None:
    now = clock.now()
    cases = [
        ("active", now - timedelta(hours=1), "expired"),
        ("cancelled", now - timedelta(days=2), "expired"),
        ("grace", now - timedelta(minutes=1), "expired"),
        ("active", now + timedelta(days=1), "active"),
        ("active", None, "active"),
        ("refunded", now - timedelta(days=1), "refunded"),
        ("expired", now - timedelta(days=9), "expired"),
    ]
    async with services.session_factory() as db:
        for index, (status, expires, _) in enumerate(cases):
            identity, _ = await create_account(services)
            db.add(
                Subscription(
                    user_id=identity,
                    rc_app_user_id=str(identity),
                    product_id=PLUS_PRODUCT + str(index),
                    status=status,
                    expires_at=expires,
                )
            )
        await db.commit()
    assert await sweep_expired_entitlements(services.session_factory, clock, dry_run=True) == 3
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).where(Subscription.status == "expired")) == 1
    assert await sweep_expired_entitlements(services.session_factory, clock, dry_run=False) == 3
    assert await sweep_expired_entitlements(services.session_factory, clock, dry_run=False) == 0
    async with services.session_factory() as db:
        statuses = {row.product_id: row.status for row in await db.scalars(select(Subscription))}
    assert [statuses[PLUS_PRODUCT + str(i)] for i in range(len(cases))] == [
        expected for _, _, expected in cases
    ]


async def test_retention_purge(services: Services, clock: FixedClock) -> None:
    now = clock.now()
    async with services.session_factory() as db:
        for event_id, received, processed in [
            ("old-processed", now - timedelta(days=31), True),
            ("old-unprocessed", now - timedelta(days=31), False),
            ("recent-processed", now - timedelta(days=29), True),
        ]:
            db.add(
                WebhookEvent(
                    provider="revenuecat",
                    event_id=event_id,
                    received_at=received,
                    processed_at=received if processed else None,
                )
            )
        for index, (reason, at) in enumerate(
            [
                ("bounce", now - timedelta(days=366)),
                ("bounce", now - timedelta(days=10)),
                ("complaint", now - timedelta(days=900)),
                ("manual", now - timedelta(days=900)),
            ]
        ):
            db.add(
                EmailSuppression(email_hash=bytes([index]) * 32, reason=reason, suppressed_at=at)
            )
        await db.commit()
    dry = await purge_retention(services.session_factory, services.settings, clock, dry_run=True)
    assert (dry.webhook_events, dry.bounce_suppressions) == (1, 1)
    assert (await count(services, WebhookEvent), await count(services, EmailSuppression)) == (3, 4)
    done = await purge_retention(services.session_factory, services.settings, clock, dry_run=False)
    assert (done.webhook_events, done.bounce_suppressions) == (1, 1)
    again = await purge_retention(services.session_factory, services.settings, clock, dry_run=False)
    assert (again.webhook_events, again.bounce_suppressions) == (0, 0)
    async with services.session_factory() as db:
        assert set(await db.scalars(select(WebhookEvent.event_id))) == {
            "old-unprocessed",
            "recent-processed",
        }
        assert sorted(await db.scalars(select(EmailSuppression.reason))) == [
            "bounce",
            "complaint",
            "manual",
        ]


async def add_download(
    services: Services,
    city_id: uuid.UUID,
    days_ago: int,
    *,
    user_id: uuid.UUID | None = None,
    anon: bytes | None = None,
) -> None:
    moment = services.clock.now() - timedelta(days=days_ago)
    async with services.session_factory() as db:
        db.add(
            PackDownload(
                id=uuid7(),
                user_id=user_id,
                anon_hash=anon,
                city_id=city_id,
                day=moment.date(),
                created_at=moment,
                updated_at=moment,
            )
        )
        await db.commit()


async def test_pack_download_rollup_keeps_account_first_city(
    services: Services, sample: Sample, clock: FixedClock
) -> None:
    from tests.export.test_packs import second_city

    other = await second_city(services)
    city = sample.city_id
    first_user, _ = await create_account(services)
    old_user, _ = await create_account(services)
    anon = b"\x01" * 32
    await add_download(services, city, 100, user_id=first_user)
    await add_download(services, other, 95, user_id=first_user)
    await add_download(services, city, 10, user_id=first_user)
    await add_download(services, city, 100, anon=anon)
    await add_download(services, city, 5, anon=anon)
    await add_download(services, other, 200, user_id=old_user)
    dry = await roll_up_pack_downloads(
        services.session_factory, services.settings, clock, dry_run=True
    )
    assert (dry.days_counted, dry.rows_deleted) == (3, 2)
    assert (await count(services, PackDownload), await count(services, PackDownloadStat)) == (6, 0)
    done = await roll_up_pack_downloads(
        services.session_factory, services.settings, clock, dry_run=False
    )
    assert (done.days_counted, done.rows_deleted) == (3, 2)
    again = await roll_up_pack_downloads(
        services.session_factory, services.settings, clock, dry_run=False
    )
    assert (again.days_counted, again.rows_deleted) == (0, 0)
    async with services.session_factory() as db:
        stats = {
            (row.city_id, (clock.now().date() - row.day).days): row.downloads
            for row in await db.scalars(select(PackDownloadStat))
        }
        kept = {
            (row.user_id, row.anon_hash, (clock.now().date() - row.day).days)
            for row in await db.scalars(select(PackDownload))
        }
    assert stats == {(city, 100): 2, (other, 95): 1, (other, 200): 1}
    assert kept == {
        (first_user, None, 100),
        (first_user, None, 10),
        (None, anon, 5),
        (old_user, None, 200),
    }


async def test_jobs_use_the_dry_run_setting_and_argument(
    services: Services, clock: FixedClock
) -> None:
    identity, _ = await create_account(services)
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=identity,
                rc_app_user_id=str(identity),
                product_id=PLUS_PRODUCT,
                status="active",
                expires_at=clock.now() - timedelta(days=1),
            )
        )
        await db.commit()
    ctx: dict[str, Any] = {"services": services}
    services.settings = services.settings.model_copy(update={"jobs_dry_run": True})
    assert await worker.entitlement_sweep_job(ctx) == 1
    assert await worker.entitlement_sweep_job(ctx) == 1
    assert await worker.entitlement_sweep_job(ctx, dry_run=False) == 1
    assert await worker.entitlement_sweep_job(ctx, dry_run=False) == 0
    assert await worker.retention_job(ctx) == 0
    assert await worker.pack_rollup_job(ctx) == 0


async def test_reconcile_job_needs_a_rest_key(services: Services, clock: FixedClock) -> None:
    identity, _ = await create_account(services)
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=identity,
                rc_app_user_id=str(identity),
                product_id=PLUS_PRODUCT,
                status="active",
                expires_at=clock.now() + timedelta(days=1),
            )
        )
        await db.commit()
    ctx: dict[str, Any] = {"services": services}
    assert await worker.reconcile_job(ctx) == 0
    directory = FakeRevenueCat()
    services.revenuecat = directory
    assert await worker.reconcile_job(ctx, dry_run=True) == 0
    assert directory.calls == [str(identity)]


def test_nightly_jobs_are_registered() -> None:
    jobs = {job.name: job for job in worker.CRON_JOBS}
    expected = {
        "cron:reconcile_job": (4, 10),
        "cron:entitlement_sweep_job": (4, 40),
        "cron:retention_job": (4, 50),
        "cron:pack_rollup_job": (5, 0),
    }
    for name, (hour, minute) in expected.items():
        assert (jobs[name].hour, jobs[name].minute) == (hour, minute)
