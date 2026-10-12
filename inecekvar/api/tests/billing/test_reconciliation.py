"""Nightly reconciliation against a fake RevenueCat REST view and the real REST client over a
recorded-shape transport (ADR-0050). No real RevenueCat account exists."""

import json
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.billing.reconcile import reconcile_subscriptions
from app.billing.revenuecat import ProductState, RevenueCatRestClient
from app.core.deps import Services
from app.models.billing import Subscription
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import PLUS_PRODUCT, FakeRevenueCat, snapshot

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

API_KEY = SecretStr("sk_test_reconcile_0123456789abcdefghij")


async def no_sleep(seconds: float) -> None:
    return None


async def seed(
    services: Services, account: Account, status: str, expires_at: datetime | None
) -> None:
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=account.identity,
                rc_app_user_id=str(account.identity),
                product_id=PLUS_PRODUCT,
                status=status,
                expires_at=expires_at,
            )
        )
        await db.commit()


async def rows(services: Services) -> dict[tuple[str, str], tuple[str, datetime | None]]:
    async with services.session_factory() as db:
        return {
            (str(row.user_id), row.product_id): (row.status, row.expires_at)
            for row in await db.scalars(select(Subscription))
        }


async def test_drift_is_fixed_and_second_run_is_a_no_op(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    now = clock.now()
    renewed = now + timedelta(days=30)
    # A lost RENEWAL webhook: the row expired locally, the provider renewed it.
    await seed(services, user, "expired", now - timedelta(days=1))
    await seed(services, contributor, "active", renewed)
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(str(user.identity), ProductState(PLUS_PRODUCT, renewed)),
            str(contributor.identity): snapshot(
                str(contributor.identity), ProductState(PLUS_PRODUCT, renewed)
            ),
        }
    )
    first = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (first.checked, first.changed, first.unchanged, first.failed) == (2, 1, 1, 0)
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)] == ("active", renewed)
    second = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (second.changed, second.inserted, second.unchanged) == (0, 0, 2)


async def test_dry_run_counts_without_writing(
    services: Services, user: Account, clock: FixedClock
) -> None:
    now = clock.now()
    await seed(services, user, "active", now + timedelta(days=3))
    before = await rows(services)
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity),
                ProductState(PLUS_PRODUCT, now + timedelta(days=3), refunded_at=now),
            )
        }
    )
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=True
    )
    assert (summary.dry_run, summary.changed) == (True, 1)
    assert await rows(services) == before


@pytest.mark.parametrize(
    ("name", "product", "expected"),
    [
        ("refund", {"refunded_at": "now"}, "refunded"),
        ("unsubscribed", {"unsubscribed_at": "now"}, "cancelled"),
        ("billing-grace", {"billing_issue_at": "now", "grace_expires_at": "+2d"}, "grace"),
        ("expired", {"expires_at": "-1d"}, "expired"),
    ],
)
async def test_snapshot_states(
    name: str,
    product: dict[str, str],
    expected: str,
    services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    now = clock.now()
    offsets = {"now": now, "+2d": now + timedelta(days=2), "-1d": now - timedelta(days=1)}
    values: dict[str, Any] = {key: offsets[value] for key, value in product.items()}
    values.setdefault("expires_at", now + timedelta(days=10))
    await seed(services, user, "active", now + timedelta(days=10))
    directory = FakeRevenueCat(
        snapshots={
            str(user.identity): snapshot(
                str(user.identity), replace(ProductState(PLUS_PRODUCT, None), **values)
            )
        }
    )
    await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)][0] == expected


async def test_rest_failure_does_not_wipe_entitlements(
    services: Services, user: Account, contributor: Account, clock: FixedClock
) -> None:
    now = clock.now()
    await seed(services, user, "active", now + timedelta(days=5))
    await seed(services, contributor, "grace", now + timedelta(days=2))
    before = await rows(services)
    directory = FakeRevenueCat(failing={str(user.identity), str(contributor.identity)})
    summary = await reconcile_subscriptions(
        services.session_factory, directory, services.settings, clock, dry_run=False
    )
    assert (summary.checked, summary.failed, summary.changed) == (2, 2, 0)
    assert await rows(services) == before


async def test_empty_snapshot_does_not_wipe_stored_products(
    services: Services, user: Account, clock: FixedClock
) -> None:
    # A wrong key or project answers with an empty subscriber: nothing is downgraded.
    await seed(services, user, "active", clock.now() + timedelta(days=5))
    before = await rows(services)
    summary = await reconcile_subscriptions(
        services.session_factory, FakeRevenueCat(), services.settings, clock, dry_run=False
    )
    assert (summary.checked, summary.changed, summary.failed) == (1, 0, 0)
    assert await rows(services) == before


def subscriber_body(user_id: str, expires: datetime) -> bytes:
    """The documented v1 `GET /subscribers/{id}` shape (not a captured provider response)."""
    stamp = expires.strftime("%Y-%m-%dT%H:%M:%SZ")
    return json.dumps(
        {
            "request_date": "2026-10-12T09:00:00Z",
            "request_date_ms": 1791795600000,
            "subscriber": {
                "original_app_user_id": user_id,
                "first_seen": "2026-09-01T09:00:00Z",
                "entitlements": {
                    "plus": {
                        "expires_date": stamp,
                        "grace_period_expires_date": None,
                        "product_identifier": PLUS_PRODUCT,
                        "purchase_date": "2026-10-01T09:00:00Z",
                    }
                },
                "subscriptions": {
                    PLUS_PRODUCT: {
                        "billing_issues_detected_at": None,
                        "expires_date": stamp,
                        "grace_period_expires_date": None,
                        "is_sandbox": False,
                        "original_purchase_date": "2026-09-01T09:00:00Z",
                        "period_type": "normal",
                        "purchase_date": "2026-10-01T09:00:00Z",
                        "refunded_at": None,
                        "store": "play_store",
                        "unsubscribe_detected_at": None,
                    }
                },
                "non_subscriptions": {},
            },
        }
    ).encode()


@pytest.mark.parametrize(
    ("name", "status", "body"),
    [
        ("server-error", 500, b"{}"),
        ("unauthorized", 401, b'{"message": "invalid key"}'),
        ("rate-limited", 429, b"{}"),
        ("malformed", 200, b"<html>"),
        ("wrong-shape", 200, b'{"subscriber": []}'),
    ],
)
async def test_rest_client_errors_change_nothing(
    name: str,
    status: int,
    body: bytes,
    services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    await seed(services, user, "active", clock.now() + timedelta(days=5))
    before = await rows(services)
    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    client = RevenueCatRestClient(
        settings,
        transport=httpx.MockTransport(lambda request: httpx.Response(status, content=body)),
    )
    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False, sleep=no_sleep
    )
    assert summary.failed == 1
    assert await rows(services) == before


async def test_rest_client_network_error_changes_nothing(
    services: Services, user: Account, clock: FixedClock
) -> None:
    await seed(services, user, "active", clock.now() + timedelta(days=5))
    before = await rows(services)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    client = RevenueCatRestClient(settings, transport=httpx.MockTransport(refuse))
    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False
    )
    assert summary.failed == 1
    assert await rows(services) == before


async def test_rest_client_request_and_parse(
    services: Services, user: Account, clock: FixedClock
) -> None:
    renewed = (clock.now() + timedelta(days=30)).replace(microsecond=0)
    await seed(services, user, "expired", clock.now() - timedelta(days=1))
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=subscriber_body(str(user.identity), renewed))

    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    client = RevenueCatRestClient(settings, transport=httpx.MockTransport(answer))
    summary = await reconcile_subscriptions(
        services.session_factory, client, services.settings, clock, dry_run=False
    )
    assert summary.changed == 1
    assert (await rows(services))[(str(user.identity), PLUS_PRODUCT)] == ("active", renewed)
    (request,) = seen
    assert str(request.url) == "https://api.revenuecat.com/v1/subscribers/" + str(user.identity)
    assert request.headers["Authorization"] == "Bearer " + API_KEY.get_secret_value()


async def test_rest_client_quotes_ids_and_deletes() -> None:
    from tests.support.app import make_test_settings

    seen: list[httpx.Request] = []
    statuses = iter([200, 404, 500])

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(next(statuses))

    client = RevenueCatRestClient(
        make_test_settings(revenuecat_api_key=API_KEY), transport=httpx.MockTransport(answer)
    )
    await client.delete_subscriber("a/b c")
    await client.delete_subscriber("gone")
    with pytest.raises(Exception, match="error status") as raised:
        await client.delete_subscriber("broken")
    assert API_KEY.get_secret_value() not in str(raised.value)
    assert [request.method for request in seen] == ["DELETE"] * 3
    assert seen[0].url.raw_path == b"/v1/subscribers/a%2Fb%20c"
