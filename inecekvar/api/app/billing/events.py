"""RevenueCat webhook events: payload model, status mapping and the processing job
(spec section 6.17 a, ADR-0050).

The route stores a verified event in `webhook_events` (unique per provider and event id) and
enqueues `process_revenuecat_event`; the job locks the row with SKIP LOCKED, so a duplicate
delivery or a second worker never applies an event twice. Events older than the newest event
already applied to a subscription row (`last_event_at`) are stale and change nothing.
"""

import uuid
from datetime import UTC, datetime

import structlog
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.reconcile import apply_snapshot
from app.billing.revenuecat import SubscriberDirectory
from app.billing.subscriptions import known_user_ids, locked_subscription, parse_user_id, set_state
from app.core.deps import Clock
from app.core.logging import hash_for_log
from app.core.settings import Settings
from app.models.billing import Subscription
from app.models.enums import SubscriptionStatus, WebhookOutcome, WebhookProvider
from app.models.ops import WebhookEvent

MAX_ATTEMPTS = 5

# Event types (RevenueCat webhook documentation) and the subscription status they set.
# PRODUCT_CHANGE is informational: the store follows it with a purchase or renewal event of
# the new product, which carries the state.
ACTIVATING = frozenset(
    {
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "NON_RENEWING_PURCHASE",
        "SUBSCRIPTION_EXTENDED",
        "TEMPORARY_ENTITLEMENT_GRANT",
        "REFUND_REVERSED",
    }
)
SUBSCRIPTION_TYPES = ACTIVATING | {
    "CANCELLATION",
    "BILLING_ISSUE",
    "EXPIRATION",
    "SUBSCRIPTION_PAUSED",
}
TRANSFER = "TRANSFER"
TEST = "TEST"
# A cancellation with this reason is a refund issued through the store or the dashboard.
REFUND_REASON = "CUSTOMER_SUPPORT"


class RevenueCatEvent(BaseModel):
    # Provider payloads gain fields over time; unknown members are ignored, known ones bounded.
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    app_user_id: str | None = Field(default=None, max_length=255)
    product_id: str | None = Field(default=None, max_length=128)
    entitlement_ids: list[str] | None = Field(default=None, max_length=32)
    event_timestamp_ms: int = Field(ge=0)
    expiration_at_ms: int | None = Field(default=None, ge=0)
    grace_period_expiration_at_ms: int | None = Field(default=None, ge=0)
    cancel_reason: str | None = Field(default=None, max_length=64)
    environment: str | None = Field(default=None, max_length=32)
    transferred_from: list[str] = Field(default_factory=list, max_length=32)
    transferred_to: list[str] = Field(default_factory=list, max_length=32)

    @property
    def at(self) -> datetime:
        return datetime.fromtimestamp(self.event_timestamp_ms / 1000, UTC)


class RevenueCatEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    api_version: str | None = Field(default=None, max_length=16)
    event: RevenueCatEvent


def from_ms(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, UTC) if value is not None else None


def subject_ids(event: RevenueCatEvent) -> list[str]:
    """The app user ids an event acts on; the route rejects events naming none we know."""
    if event.type == TRANSFER:
        return [*event.transferred_from, *event.transferred_to]
    return [event.app_user_id] if event.app_user_id else []


def is_plus_product(event: RevenueCatEvent, settings: Settings) -> bool:
    entitlements = event.entitlement_ids or []
    return settings.revenuecat_plus_entitlement in entitlements or (
        event.product_id is not None and event.product_id in settings.revenuecat_plus_product_ids
    )


def event_status(event: RevenueCatEvent) -> tuple[str, datetime | None] | None:
    """The (status, expires_at) an event sets, or None for informational events."""
    expires = from_ms(event.expiration_at_ms)
    if event.type in ACTIVATING:
        return SubscriptionStatus.ACTIVE.value, expires
    if event.type == "CANCELLATION":
        if event.cancel_reason == REFUND_REASON:
            return SubscriptionStatus.REFUNDED.value, expires
        return SubscriptionStatus.CANCELLED.value, expires
    if event.type == "SUBSCRIPTION_PAUSED":
        return SubscriptionStatus.CANCELLED.value, expires
    if event.type == "BILLING_ISSUE":
        grace = from_ms(event.grace_period_expiration_at_ms)
        return SubscriptionStatus.GRACE.value, grace if grace is not None else expires
    if event.type == "EXPIRATION":
        return SubscriptionStatus.EXPIRED.value, expires
    return None


async def apply_subscription_event(
    db: AsyncSession, event: RevenueCatEvent, settings: Settings, now: datetime
) -> WebhookOutcome:
    mapped = event_status(event)
    if mapped is None or event.app_user_id is None or event.product_id is None:
        return WebhookOutcome.IGNORED
    if not is_plus_product(event, settings):
        return WebhookOutcome.IGNORED
    user_id = parse_user_id(event.app_user_id)
    if user_id is None or not await known_user_ids(db, [event.app_user_id]):
        return WebhookOutcome.IGNORED
    row, _ = await locked_subscription(db, user_id, event.app_user_id, event.product_id, now)
    if row.last_event_at is not None and event.at < row.last_event_at:
        return WebhookOutcome.STALE
    status, expires_at = mapped
    set_state(row, status, expires_at, event.at, event.app_user_id, now)
    return WebhookOutcome.APPLIED


async def apply_transfer(
    db: AsyncSession,
    event: RevenueCatEvent,
    settings: Settings,
    now: datetime,
    directory: SubscriberDirectory | None,
) -> WebhookOutcome:
    """Purchases moved between app user ids: the source accounts lose their Plus rows; the
    target accounts take the provider's current view through REST (no REST key: only the
    source side is applied)."""
    applied = False
    for user_id in sorted(await known_user_ids(db, event.transferred_from)):
        rows = await db.scalars(
            select(Subscription).where(Subscription.user_id == user_id).with_for_update()
        )
        for row in rows:
            if row.last_event_at is not None and event.at < row.last_event_at:
                continue
            set_state(
                row, SubscriptionStatus.EXPIRED.value, event.at, event.at, row.rc_app_user_id, now
            )
            applied = True
    if directory is not None:
        for user_id in sorted(await known_user_ids(db, event.transferred_to)):
            snapshot = await directory.get_subscriber(str(user_id))
            changes = await apply_snapshot(db, user_id, snapshot, settings, now, dry_run=False)
            applied = applied or changes.changed + changes.inserted > 0
    return WebhookOutcome.APPLIED if applied else WebhookOutcome.IGNORED


async def apply_event(
    db: AsyncSession,
    event: RevenueCatEvent,
    settings: Settings,
    now: datetime,
    directory: SubscriberDirectory | None,
) -> WebhookOutcome:
    if event.type == TEST:
        return WebhookOutcome.IGNORED
    if event.environment == "SANDBOX" and not settings.revenuecat_allow_sandbox:
        return WebhookOutcome.IGNORED
    if event.type == TRANSFER:
        return await apply_transfer(db, event, settings, now, directory)
    if event.type in SUBSCRIPTION_TYPES:
        return await apply_subscription_event(db, event, settings, now)
    return WebhookOutcome.IGNORED


async def process_revenuecat_event(
    session_factory: async_sessionmaker[AsyncSession],
    row_id: uuid.UUID,
    settings: Settings,
    clock: Clock,
    directory: SubscriberDirectory | None,
) -> WebhookOutcome | None:
    """Apply one stored event. None when it is already processed or another worker holds it."""
    logger = structlog.get_logger()
    now = clock.now()
    event_type: str | None = None
    subjects: list[str] = []
    try:
        async with session_factory() as db, db.begin():
            row = await db.scalar(
                select(WebhookEvent)
                .where(
                    WebhookEvent.id == row_id,
                    WebhookEvent.provider == WebhookProvider.REVENUECAT.value,
                    WebhookEvent.processed_at.is_(None),
                )
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return None
            event_type = row.event_type
            try:
                event = RevenueCatEnvelope.model_validate(row.payload or {}).event
            except ValidationError:
                outcome = WebhookOutcome.FAILED
            else:
                subjects = subject_ids(event)
                outcome = await apply_event(db, event, settings, now, directory)
            row.processed_at = now
            row.outcome = outcome.value
            row.payload = None
            row.attempts += 1
            row.updated_at = now
    except Exception:
        # Network or database failure: count the attempt and leave the event for the retry
        # sweep; after MAX_ATTEMPTS it is closed as failed (the nightly reconciliation still
        # repairs the subscription from the provider's REST view).
        async with session_factory() as db, db.begin():
            row = await db.scalar(
                select(WebhookEvent)
                .where(WebhookEvent.id == row_id, WebhookEvent.processed_at.is_(None))
                .with_for_update(skip_locked=True)
            )
            if row is not None:
                row.attempts += 1
                row.updated_at = now
                if row.attempts >= MAX_ATTEMPTS:
                    row.processed_at = now
                    row.outcome = WebhookOutcome.FAILED.value
                    row.payload = None
        logger.warning("webhook.revenuecat.retry", event_type=event_type)
        return WebhookOutcome.FAILED
    logger.info(
        "webhook.revenuecat.processed",
        event_type=event_type,
        outcome=outcome.value,
        subject_hashes=[hash_for_log(settings, subject) for subject in subjects],
    )
    return outcome


async def pending_revenuecat_events(
    session_factory: async_sessionmaker[AsyncSession], before: datetime, limit: int = 500
) -> list[uuid.UUID]:
    """Unprocessed events received before `before` (lost enqueue, worker crash, retries)."""
    async with session_factory() as db:
        return list(
            await db.scalars(
                select(WebhookEvent.id)
                .where(
                    WebhookEvent.provider == WebhookProvider.REVENUECAT.value,
                    WebhookEvent.processed_at.is_(None),
                    WebhookEvent.received_at < before,
                )
                .order_by(WebhookEvent.received_at)
                .limit(limit)
            )
        )
