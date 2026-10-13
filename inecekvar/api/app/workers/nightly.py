"""Nightly jobs (spec section 10 phase 5, ADR-0050).

Every job is idempotent (a second run on the same data changes nothing) and takes `dry_run`:
it then counts what it would change and writes nothing. Jobs log counts only.

- Entitlement sweep: `active`, `cancelled` and `grace` rows whose `expires_at` has passed become
  `expired` (bookkeeping; `has_plus` already denies them by date).
- Retention purge: processed `webhook_events` older than `webhook_event_retention_days`; bounce
  suppressions older than `bounce_suppression_retention_days` (complaints and manual entries
  stay until removed by hand).
- Pack download roll-up: per-identity `pack_downloads` rows older than
  `pack_download_retention_days` are counted into `pack_download_stats` (once per city and day)
  and deleted, except the earliest row of each account, which keeps its free first city
  (ADR-0024). Anonymous network rows are deleted completely.
"""

from dataclasses import dataclass
from datetime import timedelta

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import distinct_on, insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.entitlements import ENTITLING_STATUSES
from app.core.deps import Clock
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.billing import PackDownload, PackDownloadStat, Subscription
from app.models.enums import SubscriptionStatus, SuppressionReason
from app.models.ops import EmailSuppression, WebhookEvent


@dataclass(frozen=True, slots=True)
class RetentionSummary:
    webhook_events: int
    bounce_suppressions: int


@dataclass(frozen=True, slots=True)
class RollupSummary:
    days_counted: int
    rows_deleted: int


async def sweep_expired_entitlements(
    session_factory: async_sessionmaker[AsyncSession], clock: Clock, *, dry_run: bool
) -> int:
    now = clock.now()
    condition = (
        Subscription.status.in_(ENTITLING_STATUSES),
        Subscription.expires_at.is_not(None),
        Subscription.expires_at <= now,
    )
    async with session_factory() as db, db.begin():
        if dry_run:
            count = await db.scalar(
                select(func.count()).select_from(Subscription).where(*condition)
            )
        else:
            result = await db.execute(
                update(Subscription)
                .where(*condition)
                .values(status=SubscriptionStatus.EXPIRED.value, updated_at=now)
                .returning(Subscription.id)
            )
            count = len(result.all())
    structlog.get_logger().info("worker.entitlements.swept", count=count or 0, dry_run=dry_run)
    return int(count or 0)


async def purge_retention(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: Clock,
    *,
    dry_run: bool,
) -> RetentionSummary:
    now = clock.now()
    events = (
        WebhookEvent.processed_at.is_not(None),
        WebhookEvent.received_at < now - timedelta(days=settings.webhook_event_retention_days),
    )
    bounces = (
        EmailSuppression.reason == SuppressionReason.BOUNCE.value,
        EmailSuppression.suppressed_at
        < now - timedelta(days=settings.bounce_suppression_retention_days),
    )
    async with session_factory() as db, db.begin():
        if dry_run:
            event_count = await db.scalar(
                select(func.count()).select_from(WebhookEvent).where(*events)
            )
            bounce_count = await db.scalar(
                select(func.count()).select_from(EmailSuppression).where(*bounces)
            )
        else:
            event_count = len(
                (
                    await db.execute(delete(WebhookEvent).where(*events).returning(WebhookEvent.id))
                ).all()
            )
            bounce_count = len(
                (
                    await db.execute(
                        delete(EmailSuppression).where(*bounces).returning(EmailSuppression.id)
                    )
                ).all()
            )
    summary = RetentionSummary(int(event_count or 0), int(bounce_count or 0))
    structlog.get_logger().info(
        "worker.retention.purged",
        webhook_events=summary.webhook_events,
        bounce_suppressions=summary.bounce_suppressions,
        dry_run=dry_run,
    )
    return summary


async def roll_up_pack_downloads(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: Clock,
    *,
    dry_run: bool,
) -> RollupSummary:
    now = clock.now()
    cutoff = (now - timedelta(days=settings.pack_download_retention_days)).date()
    first_rows = (
        select(PackDownload.id)
        .where(PackDownload.user_id.is_not(None))
        .ext(distinct_on(PackDownload.user_id))
        .order_by(PackDownload.user_id, PackDownload.created_at, PackDownload.id)
    )
    deletable = (PackDownload.day < cutoff, PackDownload.id.not_in(first_rows))
    async with session_factory() as db, db.begin():
        counted = await db.execute(
            select(PackDownload.city_id, PackDownload.day, func.count())
            .where(PackDownload.day < cutoff)
            .group_by(PackDownload.city_id, PackDownload.day)
            .order_by(PackDownload.day, PackDownload.city_id)
        )
        days = 0
        for city_id, day, downloads in counted.all():
            # A (city, day) pair is counted once: later runs see only the kept first-city rows
            # of that day and must not count them again.
            exists = await db.scalar(
                select(PackDownloadStat.id).where(
                    PackDownloadStat.city_id == city_id, PackDownloadStat.day == day
                )
            )
            if exists is not None:
                continue
            days += 1
            if not dry_run:
                await db.execute(
                    insert(PackDownloadStat)
                    .values(
                        id=uuid7(),
                        city_id=city_id,
                        day=day,
                        downloads=downloads,
                        created_at=now,
                        updated_at=now,
                    )
                    .on_conflict_do_nothing(index_elements=["city_id", "day"])
                )
        if dry_run:
            rows = await db.scalar(select(func.count()).select_from(PackDownload).where(*deletable))
        else:
            rows = len(
                (
                    await db.execute(
                        delete(PackDownload).where(*deletable).returning(PackDownload.id)
                    )
                ).all()
            )
    summary = RollupSummary(days, int(rows or 0))
    structlog.get_logger().info(
        "worker.packs.rolled_up",
        days_counted=summary.days_counted,
        rows_deleted=summary.rows_deleted,
        dry_run=dry_run,
    )
    return summary
