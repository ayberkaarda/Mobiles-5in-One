"""Reconciliation repairs downgrades, keeps lifetime refunds, isolates one bad subscriber,
uses the provider clock and handles 401 and 429 (ADR-0050 items 4 and 8). RevenueCat is a
double: an in-memory view or the real REST client over a mock transport."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.billing.events import RevenueCatEnvelope, process_revenuecat_event
from app.billing.reconcile import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_CAP_SECONDS,
    RATE_LIMIT_RETRIES,
    reconcile_subscriptions,
)
from app.billing.revenuecat import ProductState, RevenueCatRestClient, parse_subscriber
from app.core.deps import Services
from app.models.billing import Subscription
from app.models.enums import WebhookOutcome
from app.models.ops import WebhookEvent
from tests.billing.test_reconciliation import rows, seed, subscriber_body
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import PLUS_PRODUCT, FakeRevenueCat, rc_event, snapshot

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

API_KEY = SecretStr("sk_test_downgrade_0123456789abcdefghij")
OTHER_PRODUCT = "iv_other_product"


@pytest.mark.parametrize(
    ("name", "markers", "expected"),
    [
        # A refund or a revocation removes the product from the Plus entitlement.
        ("refunded", ("refunded_at",), "refunded"),
        ("revoked", (), "expired"),
        ("unsubscribed", ("unsubscribed_at",), "expired"),
    ],
)
async def test_dropped_entitlement_downgrades_stored_product(
    name: str,
    markers: tuple[str, ...],
    expected: str,
    services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    now = clock.now()
    values: dict[str, Any] = dict.fromkeys(markers, now)
    await seed(services, user, "active", now + timedelta(days=20))
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                replace(ProductState(PLUS_PRODUCT, now + timedelta(days=20)), **values),
                entitled=(),
            )
        }
    )
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (summary.changed, summary.failed) == (1, 0)
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)][0] == expected
    second = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (second.changed, second.unchanged) == (0, 1)


async def test_dropped_entitlement_does_not_insert_unknown_products(
    services: Services, user: Account, clock: FixedClock
) -> None:
    expires = clock.now() + timedelta(days=5)
    await seed(services, user, "active", expires)
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                ProductState(PLUS_PRODUCT, expires),
                ProductState(OTHER_PRODUCT, expires),
                entitled=[PLUS_PRODUCT],
            )
        }
    )
    await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert set(await rows(services)) == {(str(user.identity), PLUS_PRODUCT)}


async def test_expired_entitlement_date_is_honoured(
    services: Services, user: Account, clock: FixedClock
) -> None:
    now = clock.now()
    await seed(services, user, "active", now + timedelta(days=20))
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                ProductState(PLUS_PRODUCT, now + timedelta(days=20)),
                entitlement_expires_at=now - timedelta(hours=1),
            )
        }
    )
    await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)] == (
        "expired",
        now - timedelta(hours=1),
    )


def lifetime_body(entitlement: dict[str, object] | None) -> bytes:
    """The documented v1 shape for a `non_subscriptions` purchase."""
    return json.dumps(
        {
            "request_date": "2026-10-12T09:00:00Z",
            "subscriber": {
                "entitlements": {} if entitlement is None else {"plus": entitlement},
                "subscriptions": {},
                "non_subscriptions": {
                    PLUS_PRODUCT: [
                        {
                            "id": "GPA.lifetime",
                            "is_sandbox": False,
                            "purchase_date": "2026-09-01T00:00:00Z",
                            "store": "play_store",
                        }
                    ]
                },
            },
        }
    ).encode()


async def test_refunded_lifetime_row_is_not_reactivated(
    services: Services, user: Account, clock: FixedClock
) -> None:
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=user.identity,
                rc_app_user_id=str(user.identity),
                product_id=PLUS_PRODUCT,
                status="refunded",
                expires_at=None,
                last_event_at=clock.now() - timedelta(days=1),
            )
        )
        await db.commit()
    view = parse_subscriber(
        str(user.identity),
        lifetime_body({"expires_date": None, "product_identifier": PLUS_PRODUCT}),
        "plus",
    )
    summary = await reconcile_subscriptions(
        services.session_factory,
        FakeRevenueCat(snapshots={str(user.identity): view}),
        services.settings,
        clock,
        dry_run=False,
    )
    assert (summary.changed, summary.unchanged) == (0, 1)
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)] == ("refunded", None)


@pytest.mark.parametrize(
    ("entitlement", "expected"),
    [
        ({"expires_date": None, "product_identifier": PLUS_PRODUCT}, "active"),
        (None, "expired"),
        ({"expires_date": None, "product_identifier": OTHER_PRODUCT}, "expired"),
    ],
    ids=["entitled", "no-entitlement", "entitlement-names-other"],
)
async def test_lifetime_status_follows_the_entitlement(
    entitlement: dict[str, object] | None,
    expected: str,
    services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    await seed(services, user, "active", None)
    view = parse_subscriber(str(user.identity), lifetime_body(entitlement), "plus")
    assert view.products[0].non_subscription
    await reconcile_subscriptions(
        services.session_factory,
        FakeRevenueCat(snapshots={str(user.identity): view}),
        services.settings,
        clock,
        dry_run=False,
    )
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)][0] == expected


async def test_one_unusable_subscriber_does_not_stop_the_run(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    now = clock.now()
    renewed = now + timedelta(days=30)
    await seed(services, user, "expired", now - timedelta(days=1))
    await seed(services, contributor, "expired", now - timedelta(days=1))
    # A value the model does not bound (longer than the column) fails inside the transaction.
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(str(user.identity), ProductState("p" * 200, renewed)),
            str(contributor.identity): snapshot(
                str(contributor.identity), ProductState(PLUS_PRODUCT, renewed)
            ),
        }
    )
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (summary.checked, summary.failed, summary.changed) == (2, 1, 1)
    assert (await rows(services))[(str(contributor.identity), PLUS_PRODUCT)] == (
        "active",
        renewed,
    )


def test_parse_drops_product_ids_longer_than_the_column() -> None:
    body = json.dumps(
        {
            "subscriber": {
                "entitlements": {"plus": {"product_identifier": "p" * 129}},
                "subscriptions": {"p" * 129: {"expires_date": "2026-11-01T00:00:00Z"}},
                "non_subscriptions": {"q" * 129: [{"id": "x"}]},
            }
        }
    ).encode()
    assert parse_subscriber("u", body, "plus").products == ()


async def test_event_just_before_the_rest_answer_still_applies(
    services: Services, user: Account, clock: FixedClock
) -> None:
    now = clock.now()
    await seed(services, user, "active", now + timedelta(days=5))
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                ProductState(PLUS_PRODUCT, now + timedelta(days=6)),
                request_date=now,
            )
        }
    )
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert summary.changed == 1
    # A refund created one second before the REST answer and delivered after it.
    refund = rc_event(
        "CANCELLATION",
        str(user.identity),
        now - timedelta(seconds=1),
        expires=now + timedelta(days=6),
        cancel_reason="CUSTOMER_SUPPORT",
    )
    async with services.session_factory() as db:
        stored = WebhookEvent(
            provider="revenuecat",
            event_id=RevenueCatEnvelope.model_validate(refund).event.id,
            event_type="CANCELLATION",
            payload=refund,
            received_at=now,
        )
        db.add(stored)
        await db.commit()
        row_id = stored.id
    outcome = await process_revenuecat_event(
        services.session_factory, row_id, services.settings, clock, None
    )
    assert outcome == WebhookOutcome.APPLIED
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)][0] == "refunded"


async def test_reconciliation_stamp_uses_the_provider_clock(
    services: Services, user: Account, clock: FixedClock
) -> None:
    now = clock.now()
    provider_now = now - timedelta(minutes=30)
    await seed(services, user, "expired", now - timedelta(days=1))
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                ProductState(PLUS_PRODUCT, now + timedelta(days=6)),
                request_date=provider_now,
            )
        }
    )
    await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    async with services.session_factory() as db:
        stamp = await db.scalar(select(Subscription.last_event_at))
    assert stamp is not None
    assert stamp < provider_now


def counting_client(
    services: Services, statuses: list[int], headers: dict[str, str] | None = None
) -> tuple[RevenueCatRestClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []
    answers = iter(statuses)

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        status = next(answers, statuses[-1])
        user_id = request.url.path.rsplit("/", 1)[-1]
        body = subscriber_body(user_id, datetime(2026, 11, 12, tzinfo=UTC))
        return httpx.Response(status, content=body if status == 200 else b"{}", headers=headers)

    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    return RevenueCatRestClient(settings, transport=httpx.MockTransport(answer)), seen


@pytest.mark.parametrize("status", [401, 403])
async def test_refused_key_stops_the_run(
    status: int, services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    await seed(services, user, "active", clock.now() + timedelta(days=5))
    await seed(services, contributor, "active", clock.now() + timedelta(days=5))
    client, seen = counting_client(services, [status])
    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False
    )
    assert len(seen) == 1
    assert (summary.checked, summary.failed, summary.aborted) == (1, 1, True)


async def test_rate_limit_backs_off_exponentially_then_continues(
    services: Services, user: Account, clock: FixedClock
) -> None:
    await seed(services, user, "expired", clock.now() - timedelta(days=1))
    client, seen = counting_client(services, [429, 429, 200])
    pauses: list[float] = []

    async def record(seconds: float) -> None:
        pauses.append(seconds)

    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False, sleep=record
    )
    assert pauses == [BACKOFF_BASE_SECONDS, BACKOFF_BASE_SECONDS * 2]
    assert len(seen) == 3
    assert (summary.changed, summary.failed, summary.aborted) == (1, 0, False)


async def test_persistent_rate_limit_is_capped_and_stops_the_run(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    await seed(services, user, "active", clock.now() + timedelta(days=5))
    await seed(services, contributor, "active", clock.now() + timedelta(days=5))
    client, seen = counting_client(services, [429], headers={"Retry-After": "600"})
    pauses: list[float] = []

    async def record(seconds: float) -> None:
        pauses.append(seconds)

    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False, sleep=record
    )
    assert pauses == [BACKOFF_CAP_SECONDS] * RATE_LIMIT_RETRIES
    assert len(seen) == RATE_LIMIT_RETRIES + 1
    assert (summary.checked, summary.failed, summary.aborted) == (1, 1, True)
