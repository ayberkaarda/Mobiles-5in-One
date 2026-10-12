"""RevenueCat webhook events: payload model, status mapping and the processing job
(spec section 6.17 a, ADR-0050).

The route stores a verified event in `webhook_events` (unique per provider and event id) and
enqueues `process_revenuecat_event`; the job locks the row with SKIP LOCKED, so a duplicate
delivery or a second worker never applies an event twice. Events older than the newest event
already applied to a subscription row (`last_event_at`) are stale and change nothing.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

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

type AppUserId = Annotated[str, Field(max_length=255)]


class RevenueCatEvent(BaseModel):
    # Provider payloads gain fields over time; unknown members are ignored, known ones bounded.
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    app_user_id: str | None = Field(default=None, max_length=255)
    original_app_user_id: str | None = Field(default=None, max_length=255)
    aliases: list[AppUserId] = Field(default_factory=list, max_length=32)
    product_id: str | None = Field(default=None, max_length=128)
    entitlement_ids: list[str] | None = Field(default=None, max_length=32)
    event_timestamp_ms: int = Field(ge=0)
    expiration_at_ms: int | None = Field(default=None, ge=0)
    grace_period_expiration_at_ms: int | None = Field(default=None, ge=0)
    cancel_reason: str | None = Field(default=None, max_length=64)
    environment: str | None = Field(default=None, max_length=32)
    transferred_from: list[AppUserId] = Field(default_factory=list, max_length=32)
    transferred_to: list[AppUserId] = Field(default_factory=list, max_length=32)

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
    """The app user ids an event acts on; the route rejects events naming none we know. Besides
    `app_user_id` an event names the subscriber's `original_app_user_id` and `aliases`: a
    purchase made under an anonymous id before sign-in still reaches the account it was
    aliased to."""
    if event.type == TRANSFER:
        return [*event.transferred_from, *event.transferred_to]
    candidates = [event.app_user_id, event.original_app_user_id, *event.aliases]
    return list(dict.fromkeys(value for value in candidates if value))


async def event_account(db: AsyncSession, event: RevenueCatEvent) -> uuid.UUID | None:
    """The one account an event acts on: `app_user_id` when it is an account, otherwise the
    single account among `original_app_user_id` and `aliases` (none or several: no account)."""
    if event.app_user_id is not None:
        direct = parse_user_id(event.app_user_id)
        if direct is not None and await known_user_ids(db, [event.app_user_id]):
            return direct
    known = await known_user_ids(db, subject_ids(event))
    return next(iter(known)) if len(known) == 1 else None


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
    user_id = await event_account(db, event)
    if user_id is None:
        return WebhookOutcome.IGNORED
    # The row is keyed to the account id, which the reconciliation fetches by.
    app_user_id = str(user_id)
    row, _ = await locked_subscription(db, user_id, app_user_id, event.product_id, now)
    if row.last_event_at is not None and event.at < row.last_event_at:
        return WebhookOutcome.STALE
    status, expires_at = mapped
    set_state(row, status, expires_at, event.at, app_user_id, now)
    return WebhookOutcome.APPLIED


async def apply_transfer(
    db: AsyncSession,
    event: RevenueCatEvent,
    settings: Settings,
    now: datetime,
    directory: SubscriberDirectory | None,
) -> WebhookOutcome:
    """Purchases moved between app user ids: the source accounts lose their Plus rows; the
    target accounts take the provider's current view through REST. Without a REST key the
    target accounts receive the moved products as `expired` rows, so no purchase is lost: the
    nightly reconciliation (which iterates stored rows) restores them once a key is set."""
    applied = False
    moved: set[str] = {event.product_id} if event.product_id else set()
    for user_id in sorted(await known_user_ids(db, event.transferred_from)):
        rows = await db.scalars(
            select(Subscription).where(Subscription.user_id == user_id).with_for_update()
        )
        for row in rows:
            moved.add(row.product_id)
            if row.last_event_at is not None and event.at < row.last_event_at:
                continue
            set_state(
                row, SubscriptionStatus.EXPIRED.value, event.at, event.at, row.rc_app_user_id, now
            )
            applied = True
    for user_id in sorted(await known_user_ids(db, event.transferred_to)):
        if directory is not None:
            snapshot = await directory.get_subscriber(str(user_id))
            changes = await apply_snapshot(db, user_id, snapshot, settings, now, dry_run=False)
            applied = applied or changes.changed + changes.inserted > 0
            continue
        for product_id in sorted(moved):
            _, created = await locked_subscription(db, user_id, str(user_id), product_id, now)
            applied = applied or created
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
