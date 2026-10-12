"""RevenueCat event processing: status mapping, ordering, duplicates and event kinds
(ADR-0050). Events are stored as the webhook route stores them, then processed by the job."""

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.billing.events import (
    RevenueCatEnvelope,
    event_status,
    pending_revenuecat_events,
    process_revenuecat_event,
)
from app.billing.reconcile import reconcile_subscriptions
from app.billing.revenuecat import ProductState
from app.core.deps import Services
from app.models.billing import Subscription
from app.models.enums import WebhookOutcome
from app.models.ops import WebhookEvent
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import (
    PLUS_PRODUCT,
    FakeRevenueCat,
    rc_event,
    snapshot,
)

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def alias_fields(app_user_id: str, *aliases: str) -> dict[str, Any]:
    """`original_app_user_id` and `aliases` of an event (the provider lists the current id
    among the aliases)."""
    return {"original_app_user_id": app_user_id, "aliases": [app_user_id, *aliases]}


def subscriber_ids(app_user_id: str, *aliases: str) -> dict[str, object]:
    return {"app_user_id": app_user_id, **alias_fields(app_user_id, *aliases)}


async def store(services: Services, body: dict[str, object]) -> uuid.UUID:
    event = RevenueCatEnvelope.model_validate(body).event
    async with services.session_factory() as db:
        row = WebhookEvent(
            provider="revenuecat",
            event_id=event.id,
            event_type=event.type,
            payload=body,
            received_at=services.clock.now(),
        )
        db.add(row)
        await db.commit()
        return row.id


async def run(
    services: Services, body: dict[str, object], directory: FakeRevenueCat | None = None
) -> WebhookOutcome | None:
    row_id = await store(services, body)
    return await process_revenuecat_event(
        services.session_factory, row_id, services.settings, services.clock, directory
    )


async def state(services: Services, account: Account) -> tuple[str, datetime | None] | None:
    async with services.session_factory() as db:
        row = await db.scalar(
            select(Subscription).where(
                Subscription.user_id == account.identity, Subscription.product_id == PLUS_PRODUCT
            )
        )
        return (row.status, row.expires_at) if row is not None else None


@pytest.mark.parametrize(
    ("event_type", "extra", "expected"),
    [
        ("INITIAL_PURCHASE", {}, "active"),
        ("RENEWAL", {}, "active"),
        ("UNCANCELLATION", {}, "active"),
        ("NON_RENEWING_PURCHASE", {}, "active"),
        ("SUBSCRIPTION_EXTENDED", {}, "active"),
        ("TEMPORARY_ENTITLEMENT_GRANT", {}, "active"),
        ("REFUND_REVERSED", {}, "active"),
        ("CANCELLATION", {"cancel_reason": "UNSUBSCRIBE"}, "cancelled"),
        ("CANCELLATION", {"cancel_reason": "BILLING_ERROR"}, "cancelled"),
        ("CANCELLATION", {"cancel_reason": "CUSTOMER_SUPPORT"}, "refunded"),
        ("SUBSCRIPTION_PAUSED", {}, "cancelled"),
        ("BILLING_ISSUE", {}, "grace"),
        ("EXPIRATION", {}, "expired"),
        ("PRODUCT_CHANGE", {}, None),
        ("TRANSFER", {}, None),
        ("TEST", {}, None),
        ("INVOICE_ISSUANCE", {}, None),
        ("SOMETHING_NEW", {}, None),
    ],
)
def test_event_status_mapping(
    event_type: str, extra: dict[str, object], expected: str | None
) -> None:
    now = FixedClock().now()
    body = rc_event(event_type, str(uuid.uuid4()), now, expires=now + timedelta(days=30))
    event = body["event"]
    assert isinstance(event, dict)
    event.update(extra)
    mapped = event_status(RevenueCatEnvelope.model_validate(body).event)
    assert (mapped[0] if mapped else None) == expected


async def test_purchase_then_lifecycle(
    services: Services, user: Account, clock: FixedClock
) -> None:
    subject = str(user.identity)
    now = clock.now()
    period = now + timedelta(days=30)
    purchase = rc_event("INITIAL_PURCHASE", subject, now, expires=period)
    assert await run(services, purchase) == WebhookOutcome.APPLIED
    assert await state(services, user) == ("active", period)
    grace_end = period + timedelta(days=16)
    issue = rc_event(
        "BILLING_ISSUE",
        subject,
        now + timedelta(days=30),
        expires=period,
        grace_period_expiration_at_ms=int(grace_end.timestamp() * 1000),
    )
    assert await run(services, issue) == WebhookOutcome.APPLIED
    assert await state(services, user) == ("grace", grace_end)
    renewal_end = period + timedelta(days=30)
    renewal = rc_event("RENEWAL", subject, now + timedelta(days=31), expires=renewal_end)
    assert await run(services, renewal) == WebhookOutcome.APPLIED
    assert await state(services, user) == ("active", renewal_end)
    refund = rc_event(
        "CANCELLATION",
        subject,
        now + timedelta(days=32),
        expires=now + timedelta(days=32),
        cancel_reason="CUSTOMER_SUPPORT",
    )
    assert await run(services, refund) == WebhookOutcome.APPLIED
    assert (await state(services, user) or ("", None))[0] == "refunded"


async def test_out_of_order_event_is_stale(
    services: Services, user: Account, clock: FixedClock
) -> None:
    subject = str(user.identity)
    now = clock.now()
    expiration = rc_event("EXPIRATION", subject, now + timedelta(days=31), expires=now)
    assert await run(services, expiration) == WebhookOutcome.APPLIED
    # The purchase was sent first but arrives last: it must not revive the subscription.
    late = rc_event("INITIAL_PURCHASE", subject, now, expires=now + timedelta(days=30))
    assert await run(services, late) == WebhookOutcome.STALE
    assert await state(services, user) == ("expired", now)


async def test_processing_is_idempotent_per_stored_event(
    services: Services, user: Account, clock: FixedClock
) -> None:
    body = rc_event("INITIAL_PURCHASE", str(user.identity), clock.now(), expires=clock.now())
    row_id = await store(services, body)
    outcomes = await asyncio.gather(
        *[
            process_revenuecat_event(
                services.session_factory, row_id, services.settings, services.clock, None
            )
            for _ in range(5)
        ]
    )
    assert outcomes.count(WebhookOutcome.APPLIED) == 1
    assert outcomes.count(None) == 4
    async with services.session_factory() as db:
        row = await db.get(WebhookEvent, row_id)
        assert row is not None
        assert (row.outcome, row.attempts, row.payload) == ("applied", 1, None)
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 1


@pytest.mark.parametrize(
    ("name", "override"),
    [
        ("test-event", {"type": "TEST"}),
        ("unknown-product", {"product_id": "iv_other", "entitlement_ids": []}),
        ("sandbox", {"environment": "SANDBOX"}),
        ("informational", {"type": "PRODUCT_CHANGE"}),
        ("deleted-account", subscriber_ids(str(uuid.UUID(int=7)))),
        ("anonymous-id", subscriber_ids("$RCAnonymousID:abc")),
    ],
)
async def test_events_without_effect(
    name: str,
    override: dict[str, object],
    services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    body = rc_event(
        "INITIAL_PURCHASE", str(user.identity), clock.now(), expires=clock.now() + timedelta(days=3)
    )
    event = body["event"]
    assert isinstance(event, dict)
    event.update(override)
    assert await run(services, body) == WebhookOutcome.IGNORED
    assert await state(services, user) is None


async def test_product_id_mapping_without_entitlement_ids(
    services: Services, user: Account, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(
        update={"revenuecat_plus_product_ids": (PLUS_PRODUCT,)}
    )
    body = rc_event(
        "INITIAL_PURCHASE",
        str(user.identity),
        clock.now(),
        entitlement_ids=[],
        expires=clock.now() + timedelta(days=3),
    )
    assert await run(services, body) == WebhookOutcome.APPLIED


async def test_sandbox_allowed_when_configured(
    services: Services, user: Account, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(update={"revenuecat_allow_sandbox": True})
    body = rc_event(
        "INITIAL_PURCHASE",
        str(user.identity),
        clock.now(),
        expires=clock.now() + timedelta(days=3),
        environment="SANDBOX",
    )
    assert await run(services, body) == WebhookOutcome.APPLIED


async def test_transfer_moves_plus(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    now = clock.now()
    period = now + timedelta(days=30)
    purchase = rc_event("INITIAL_PURCHASE", str(user.identity), now, expires=period)
    assert await run(services, purchase) == WebhookOutcome.APPLIED
    directory = FakeRevenueCat(
        snapshots={
            str(contributor.identity): snapshot(
                str(contributor.identity), ProductState(PLUS_PRODUCT, period)
            )
        }
    )
    transfer = rc_event(
        "TRANSFER",
        None,
        now + timedelta(hours=1),
        product_id=None,
        transferred_from=[str(user.identity)],
        transferred_to=[str(contributor.identity)],
    )
    assert await run(services, transfer, directory) == WebhookOutcome.APPLIED
    assert (await state(services, user) or ("", None))[0] == "expired"
    assert await state(services, contributor) == ("active", period)
    assert directory.calls == [str(contributor.identity)]


async def test_rest_failure_during_transfer_is_retried(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    directory = FakeRevenueCat(failing={str(contributor.identity)})
    transfer = rc_event(
        "TRANSFER",
        None,
        clock.now(),
        product_id=None,
        transferred_from=[str(user.identity)],
        transferred_to=[str(contributor.identity)],
    )
    row_id = await store(services, transfer)
    for attempt in range(1, 6):
        outcome = await process_revenuecat_event(
            services.session_factory, row_id, services.settings, services.clock, directory
        )
        assert outcome == WebhookOutcome.FAILED
        async with services.session_factory() as db:
            row = await db.get(WebhookEvent, row_id)
            assert row is not None
            assert row.attempts == attempt
            # Kept for the retry sweep until the last attempt, then closed without payload.
            assert (row.processed_at is None) is (attempt < 5)
            assert (row.payload is None) is (attempt == 5)
    clock.advance(minutes=10)
    assert await pending_revenuecat_events(services.session_factory, clock.now()) == []


async def test_pending_events_are_listed_for_the_sweep(
    services: Services, user: Account, clock: FixedClock
) -> None:
    body = rc_event("INITIAL_PURCHASE", str(user.identity), clock.now(), expires=clock.now())
    row_id = await store(services, body)
    assert await pending_revenuecat_events(services.session_factory, clock.now()) == []
    clock.advance(minutes=2)
    assert await pending_revenuecat_events(services.session_factory, clock.now()) == [row_id]


async def test_transfer_without_rest_key_keeps_the_purchase_for_the_target(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    now = clock.now()
    # A lifetime purchase on the source account (no expiry: nothing else ever repairs it).
    lifetime = rc_event("NON_RENEWING_PURCHASE", str(user.identity), now)
    assert await run(services, lifetime) == WebhookOutcome.APPLIED
    transfer = rc_event(
        "TRANSFER",
        None,
        now + timedelta(hours=1),
        product_id=None,
        transferred_from=[str(user.identity)],
        transferred_to=[str(contributor.identity)],
    )
    assert await run(services, transfer) == WebhookOutcome.APPLIED
    assert (await state(services, user) or ("", None))[0] == "expired"
    # The target holds the moved product as a stored row, so the nightly reconciliation (which
    # iterates stored rows) fetches the target and restores the purchase once a key is set.
    assert (await state(services, contributor) or ("", None))[0] == "expired"
    directory = FakeRevenueCat(
        snapshots={
            str(contributor.identity): snapshot(
                str(contributor.identity), ProductState(PLUS_PRODUCT, None, non_subscription=True)
            )
        }
    )
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert str(contributor.identity) in directory.calls
    assert summary.failed == 0
    assert await state(services, contributor) == ("active", None)


async def test_event_for_an_aliased_anonymous_id_reaches_the_account(
    services: Services, user: Account, clock: FixedClock
) -> None:
    body = rc_event(
        "INITIAL_PURCHASE",
        "$RCAnonymousID:abc",
        clock.now(),
        expires=clock.now() + timedelta(days=3),
        **alias_fields("$RCAnonymousID:abc", str(user.identity)),
    )
    assert await run(services, body) == WebhookOutcome.APPLIED
    assert await state(services, user) == ("active", clock.now() + timedelta(days=3))
    async with services.session_factory() as db:
        # The row is keyed to the account id, which the reconciliation fetches by.
        assert await db.scalar(select(Subscription.rc_app_user_id)) == str(user.identity)


async def test_aliases_naming_two_accounts_choose_neither(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    body = rc_event(
        "INITIAL_PURCHASE",
        "$RCAnonymousID:abc",
        clock.now(),
        expires=clock.now() + timedelta(days=3),
        **alias_fields("$RCAnonymousID:abc", str(user.identity), str(contributor.identity)),
    )
    assert await run(services, body) == WebhookOutcome.IGNORED
    assert await state(services, user) is None
    assert await state(services, contributor) is None
