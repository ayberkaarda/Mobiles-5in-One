"""Entitlement matrix: the `subscriptions` rows decide pack downloads beyond the first city
through the real route and `SubscriptionEntitlements` (ADR-0024, ADR-0050)."""

from dataclasses import dataclass
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select

from app.billing import SubscriptionEntitlements
from app.billing.entitlements import entitles
from app.core.deps import Services
from app.core.ids import uuid7
from app.models.billing import Subscription
from app.models.geo import City
from tests.domain.conftest import Account, Sample
from tests.support.billing import PLUS_PRODUCT

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

FIRST = "/v1/cities/ornek-test-sehri/pack"


@dataclass(frozen=True)
class Case:
    name: str
    status: str | None
    expiry_hours: float | None
    entitled: bool


CASES = [
    Case("free-tier", None, None, False),
    Case("plus-active", "active", 720, True),
    Case("plus-lifetime", "active", None, True),
    Case("plus-active-but-expired", "active", -1, False),
    Case("cancelled-paid-period-runs", "cancelled", 48, True),
    Case("cancelled-period-over", "cancelled", -1, False),
    Case("grace-running", "grace", 24, True),
    Case("grace-over", "grace", -0.01, False),
    Case("expired", "expired", -24, False),
    Case("expired-with-future-date", "expired", 24, False),
    Case("refunded", "refunded", 720, False),
    Case("cancelled-without-date", "cancelled", None, False),
]


async def add_city(services: Services, slug: str) -> None:
    async with services.session_factory() as db:
        original = await db.scalar(select(City).where(City.slug == "ornek-test-sehri"))
        assert original is not None
        db.add(
            City(
                id=uuid7(),
                name="[ÖRNEK] " + slug,
                slug=slug,
                bbox=original.bbox,
                centroid=original.centroid,
                is_sample=True,
            )
        )
        await db.commit()


async def add_subscription(
    services: Services, account: Account, status: str, expiry_hours: float | None
) -> None:
    now = services.clock.now()
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=account.identity,
                rc_app_user_id=str(account.identity),
                product_id=PLUS_PRODUCT,
                status=status,
                expires_at=now + timedelta(hours=expiry_hours)
                if expiry_hours is not None
                else None,
            )
        )
        await db.commit()


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
async def test_pack_entitlement_matrix(
    case: Case, client: httpx.AsyncClient, services: Services, sample: Sample, user: Account
) -> None:
    services.entitlements = SubscriptionEntitlements()
    await add_city(services, "ikinci-sehir")
    await add_city(services, "ucuncu-sehir")
    if case.status is not None:
        await add_subscription(services, user, case.status, case.expiry_hours)
    # The first city is free in every case.
    assert (await client.get(FIRST, headers=user.headers)).status_code == 200
    for slug in ("ikinci-sehir", "ucuncu-sehir"):
        response = await client.get("/v1/cities/" + slug + "/pack", headers=user.headers)
        if case.entitled:
            assert response.status_code == 200
        else:
            # The contract the app handles (apps/mobile pack-manager.ts): 403 with this code.
            assert response.status_code == 403
            assert response.json()["code"] == "pack.entitlement_required"
    # An anonymous caller on the same network never borrows the account's Plus.
    assert (await client.get(FIRST)).status_code == 200
    anonymous = await client.get("/v1/cities/ikinci-sehir/pack")
    assert anonymous.status_code == 403


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
async def test_has_plus_matches_row_rule(case: Case, services: Services, user: Account) -> None:
    now = services.clock.now()
    if case.status is not None:
        await add_subscription(services, user, case.status, case.expiry_hours)
    async with services.session_factory() as db:
        assert await SubscriptionEntitlements().has_plus(db, user.identity, now) is case.entitled
    if case.status is not None:
        expires = (
            now + timedelta(hours=case.expiry_hours) if case.expiry_hours is not None else None
        )
        assert entitles(case.status, expires, now) is case.entitled


async def test_other_users_plus_is_not_shared(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    user: Account,
    contributor: Account,
) -> None:
    services.entitlements = SubscriptionEntitlements()
    await add_city(services, "ikinci-sehir")
    await add_subscription(services, contributor, "active", 720)
    assert (await client.get(FIRST, headers=user.headers)).status_code == 200
    denied = await client.get("/v1/cities/ikinci-sehir/pack", headers=user.headers)
    assert denied.status_code == 403
    assert (await client.get(FIRST, headers=contributor.headers)).status_code == 200
    allowed = await client.get("/v1/cities/ikinci-sehir/pack", headers=contributor.headers)
    assert allowed.status_code == 200
