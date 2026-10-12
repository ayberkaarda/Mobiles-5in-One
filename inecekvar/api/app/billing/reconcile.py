"""Nightly reconciliation of `subscriptions` with the RevenueCat REST view (spec section 6.17 a,
ADR-0050).

Every stored subscriber is fetched once. A failed or unusable answer changes nothing for that
subscriber (it keeps its rows until the next run); a usable answer updates the Plus products it
names and inserts the ones missing locally. A stored product the answer does not mention is
left alone (it expires by its own `expires_at`): a misconfigured key or project, which answers
with empty subscribers, cannot wipe entitlements.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.revenuecat import RevenueCatError, SubscriberDirectory, SubscriberSnapshot
from app.billing.subscriptions import locked_subscription, set_state, snapshot_status
from app.core.deps import Clock
from app.core.settings import Settings
from app.models.billing import Subscription


@dataclass(slots=True)
class SnapshotChanges:
    changed: int = 0
    inserted: int = 0
    unchanged: int = 0


@dataclass(slots=True)
class ReconcileSummary:
    dry_run: bool
    checked: int = 0
    changed: int = 0
    inserted: int = 0
    unchanged: int = 0
    failed: int = 0

    def counts(self) -> dict[str, int | bool]:
        return {
            "dry_run": self.dry_run,
            "checked": self.checked,
            "changed": self.changed,
            "inserted": self.inserted,
            "unchanged": self.unchanged,
            "failed": self.failed,
        }


def plus_products(snapshot: SubscriberSnapshot, settings: Settings) -> set[str]:
    return set(snapshot.entitled_products) | set(settings.revenuecat_plus_product_ids)


async def apply_snapshot(
    db: AsyncSession,
    user_id: uuid.UUID,
    snapshot: SubscriberSnapshot,
    settings: Settings,
    now: datetime,
    *,
    dry_run: bool,
) -> SnapshotChanges:
    changes = SnapshotChanges()
    wanted = plus_products(snapshot, settings)
    for product in snapshot.products:
        if product.product_id not in wanted:
            continue
        if product.is_sandbox and not settings.revenuecat_allow_sandbox:
            continue
        status, expires_at = snapshot_status(product, now)
        if dry_run:
            current = await db.scalar(
                select(Subscription).where(
                    Subscription.user_id == user_id,
                    Subscription.product_id == product.product_id,
                )
            )
            if current is None:
                changes.inserted += 1
            elif (current.status, current.expires_at) != (status, expires_at):
                changes.changed += 1
            else:
                changes.unchanged += 1
            continue
        row, created = await locked_subscription(
            db, user_id, snapshot.app_user_id, product.product_id, now
        )
        if row.last_event_at is not None and row.last_event_at > now:
            changes.unchanged += 1
            continue
        if not created and (row.status, row.expires_at) == (status, expires_at):
            changes.unchanged += 1
            continue
        set_state(row, status, expires_at, now, snapshot.app_user_id, now)
        if created:
            changes.inserted += 1
        else:
            changes.changed += 1
    return changes


async def reconcile_subscriptions(
    session_factory: async_sessionmaker[AsyncSession],
    directory: SubscriberDirectory,
    settings: Settings,
    clock: Clock,
    *,
    dry_run: bool,
) -> ReconcileSummary:
    summary = ReconcileSummary(dry_run=dry_run)
    async with session_factory() as db:
        subscribers = list(
            (
                await db.execute(
                    select(Subscription.user_id, Subscription.rc_app_user_id)
                    .distinct()
                    .order_by(Subscription.user_id, Subscription.rc_app_user_id)
                )
            ).all()
        )
    for user_id, app_user_id in subscribers:
        summary.checked += 1
        try:
            snapshot = await directory.get_subscriber(app_user_id)
        except RevenueCatError:
            summary.failed += 1
            continue
        now = clock.now()
        async with session_factory() as db, db.begin():
            changes = await apply_snapshot(db, user_id, snapshot, settings, now, dry_run=dry_run)
        summary.changed += changes.changed
        summary.inserted += changes.inserted
        summary.unchanged += changes.unchanged
    structlog.get_logger().info("billing.reconcile.run", **summary.counts())
    return summary
