from datetime import timedelta

import pytest

from app.billing import SubscriptionEntitlements
from app.core.deps import Services
from app.core.ids import uuid7
from app.models.billing import Subscription
from tests.support.domain import create_account

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


@pytest.mark.parametrize("status", ["active", "grace", "expired", "cancelled", "refunded"])
@pytest.mark.parametrize("expiry", [None, -1, 0, 1])
async def test_subscription_entitlement_status_and_expiry(
    services: Services, status: str, expiry: int | None
) -> None:
    identity, _ = await create_account(services)
    now = services.clock.now()
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=identity,
                rc_app_user_id="billing-user",
                product_id="plus",
                status=status,
                expires_at=now + timedelta(seconds=expiry) if expiry is not None else None,
            )
        )
        await db.commit()
        source = SubscriptionEntitlements()
        # Phase 5 rule (ADR-0050): cancelled keeps the paid period, a missing date is a
        # lifetime purchase only when active, expired and refunded never entitle.
        assert await source.has_plus(db, identity, now) == (
            (status == "active" and expiry is None)
            or (status in {"active", "grace", "cancelled"} and expiry is not None and expiry > 0)
        )
        assert not await source.has_plus(db, uuid7(), now)
