"""Nightly reconciliation of `subscriptions` with the RevenueCat REST view (spec section 6.17 a,
ADR-0050).

Every stored subscriber is fetched once. A failed or unusable answer changes nothing for that
subscriber (it keeps its rows until the next run); a usable answer updates every product it
lists that is a Plus product (named by the entitlement, configured, or already stored for this
account) and inserts the entitled ones missing locally. A stored product the answer does not
list at all is left alone (it expires by its own `expires_at`): a misconfigured key or project,
which answers with an empty subscriber, cannot wipe entitlements. A listed product the Plus
entitlement no longer names (refund, revocation, transfer) is downgraded to `expired`.

One subscriber that cannot be applied counts as `failed` and the run continues; a refused key
(401/403) stops the run, a rate limit (429) backs off exponentially up to a cap and stops the
run when it persists.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.entitlements import entitles
from app.billing.revenuecat import (
    ProductState,
    RevenueCatError,
    RevenueCatRateLimitedError,
    RevenueCatUnauthorizedError,
    SubscriberDirectory,
    SubscriberSnapshot,
)
from app.billing.subscriptions import locked_subscription, set_state, snapshot_status
from app.core.deps import Clock
from app.core.settings import Settings
from app.models.billing import Subscription
from app.models.enums import SubscriptionStatus

# Reconciled rows are stamped this far before the provider's answer, so a webhook event the
# provider created shortly before the REST fetch but delivered after it still applies
# (ADR-0050 item 8). Events carry the provider's clock, as does `request_date`.
RECONCILE_SKEW = timedelta(minutes=5)
RATE_LIMIT_RETRIES = 4
BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 60.0

type Sleep = Callable[[float], Awaitable[None]]


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
    aborted: bool = False

    def counts(self) -> dict[str, int | bool]:
        return {
            "dry_run": self.dry_run,
            "checked": self.checked,
            "changed": self.changed,
            "inserted": self.inserted,
            "unchanged": self.unchanged,
            "failed": self.failed,
            "aborted": self.aborted,
        }


def plus_products(snapshot: SubscriberSnapshot, settings: Settings) -> set[str]:
    return set(snapshot.entitled_products) | set(settings.revenuecat_plus_product_ids)


def reconciled_status(
    product: ProductState, snapshot: SubscriberSnapshot, now: datetime
) -> tuple[str, datetime | None]:
    """The (status, expires_at) of one listed product, bounded by the Plus entitlement: a
    product the entitlement does not name, or an entitlement past its `expires_date`, does not
    entitle whatever the product's own dates say."""
    status, expires_at = snapshot_status(product, now)
    if not entitles(status, expires_at, now):
        return status, expires_at
    if product.product_id not in snapshot.entitled_products:
        return SubscriptionStatus.EXPIRED.value, expires_at
    limit = snapshot.entitlement_expires_at
    if limit is not None and limit <= now:
        return SubscriptionStatus.EXPIRED.value, limit
    return status, expires_at


def keeps_refund(current: Subscription | None, product: ProductState, status: str) -> bool:
    """A refunded lifetime row is never re-activated from a `non_subscriptions` entry, which
    carries no refund marker (only `REFUND_REVERSED` restores it)."""
    return (
        current is not None
        and product.non_subscription
        and current.status == SubscriptionStatus.REFUNDED.value
        and status != SubscriptionStatus.REFUNDED.value
    )


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
    stored = set(
        await db.scalars(select(Subscription.product_id).where(Subscription.user_id == user_id))
    )
    entitled = plus_products(snapshot, settings)
    as_of = snapshot.request_date or now
    stamp = as_of - RECONCILE_SKEW
    for product in snapshot.products:
        if product.product_id not in entitled | stored:
            continue
        if product.is_sandbox and not settings.revenuecat_allow_sandbox:
            continue
        status, expires_at = reconciled_status(product, snapshot, now)
        if product.product_id not in stored and not entitles(status, expires_at, now):
            # Nothing to record for a Plus product this account never held.
            continue
        if dry_run:
            current = await db.scalar(
                select(Subscription).where(
                    Subscription.user_id == user_id,
                    Subscription.product_id == product.product_id,
                )
            )
            if current is None:
                changes.inserted += 1
            elif keeps_refund(current, product, status) or (
                current.status,
                current.expires_at,
            ) == (status, expires_at):
                changes.unchanged += 1
            else:
                changes.changed += 1
            continue
        row, created = await locked_subscription(
            db, user_id, snapshot.app_user_id, product.product_id, now
        )
        if row.last_event_at is not None and row.last_event_at > as_of:
            changes.unchanged += 1
            continue
        if not created and (
            keeps_refund(row, product, status)
            or (row.status, row.expires_at) == (status, expires_at)
        ):
            changes.unchanged += 1
            continue
        at = stamp if row.last_event_at is None else max(row.last_event_at, stamp)
        set_state(row, status, expires_at, at, snapshot.app_user_id, now)
        if created:
            changes.inserted += 1
        else:
            changes.changed += 1
    return changes


async def fetch_subscriber(
    directory: SubscriberDirectory, app_user_id: str, sleep: Sleep
) -> SubscriberSnapshot:
    """One subscriber; a 429 is retried after an exponentially growing pause (the provider's
    `Retry-After` when longer), capped at `BACKOFF_CAP_SECONDS`, at most `RATE_LIMIT_RETRIES`
    times before the rate limit is raised to the caller."""
    delay = BACKOFF_BASE_SECONDS
    attempt = 0
    while True:
        try:
            return await directory.get_subscriber(app_user_id)
        except RevenueCatRateLimitedError as error:
            if attempt >= RATE_LIMIT_RETRIES:
                raise
            hint = error.retry_after if error.retry_after is not None else 0.0
            await sleep(min(max(delay, hint), BACKOFF_CAP_SECONDS))
            delay = min(delay * 2, BACKOFF_CAP_SECONDS)
            attempt += 1


async def reconcile_subscriptions(
    session_factory: async_sessionmaker[AsyncSession],
    directory: SubscriberDirectory,
    settings: Settings,
    clock: Clock,
    *,
    dry_run: bool,
    sleep: Sleep = asyncio.sleep,
) -> ReconcileSummary:
    summary = ReconcileSummary(dry_run=dry_run)
    logger = structlog.get_logger()
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
            snapshot = await fetch_subscriber(directory, app_user_id, sleep)
        except (RevenueCatUnauthorizedError, RevenueCatRateLimitedError) as error:
            # Every later request would be refused or limited as well: stop the run.
            summary.failed += 1
            summary.aborted = True
            logger.warning("billing.reconcile.aborted", reason=type(error).__name__)
            break
        except RevenueCatError:
            summary.failed += 1
            continue
        now = clock.now()
        try:
            async with session_factory() as db, db.begin():
                changes = await apply_snapshot(
                    db, user_id, snapshot, settings, now, dry_run=dry_run
                )
        except Exception:
            # One unusable value (or an account erased mid-run) must not stop the others.
            summary.failed += 1
            logger.warning("billing.reconcile.subscriber_failed")
            continue
        summary.changed += changes.changed
        summary.inserted += changes.inserted
        summary.unchanged += changes.unchanged
    logger.info("billing.reconcile.run", **summary.counts())
    return summary
