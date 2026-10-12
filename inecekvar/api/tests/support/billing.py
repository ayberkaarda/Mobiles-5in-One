import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.revenuecat import ProductState, RevenueCatError, SubscriberSnapshot


@dataclass(slots=True)
class StaticEntitlements:
    plus_users: set[uuid.UUID]

    async def has_plus(self, db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
        return user_id in self.plus_users


@dataclass(slots=True)
class RecordingSubscriberDeleter:
    fail_for: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)

    async def delete_subscriber(self, app_user_id: str) -> None:
        self.calls.append(app_user_id)
        if app_user_id in self.fail_for:
            raise RuntimeError("Subscriber deletion failed")


PLUS_PRODUCT = "iv_plus_monthly"


def ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


def rc_event(
    event_type: str,
    app_user_id: str | None,
    at: datetime,
    *,
    event_id: str | None = None,
    product_id: str | None = PLUS_PRODUCT,
    entitlement_ids: list[str] | None = None,
    expires: datetime | None = None,
    **extra: object,
) -> dict[str, object]:
    """A RevenueCat webhook body in the documented shape (`api_version` 1.0, `event`)."""
    event: dict[str, object] = {
        "id": event_id or "evt-" + uuid.uuid4().hex,
        "type": event_type,
        "app_user_id": app_user_id,
        "original_app_user_id": app_user_id,
        "aliases": [app_user_id] if app_user_id else [],
        "product_id": product_id,
        "entitlement_ids": ["plus"] if entitlement_ids is None else entitlement_ids,
        "event_timestamp_ms": ms(at),
        "purchased_at_ms": ms(at),
        "expiration_at_ms": ms(expires) if expires is not None else None,
        "environment": "PRODUCTION",
        "store": "PLAY_STORE",
        "period_type": "NORMAL",
        "currency": "TRY",
        "price": 49.99,
    }
    event.update(extra)
    return {"api_version": "1.0", "event": event}


@dataclass(slots=True)
class FakeRevenueCat:
    """In-memory RevenueCat REST double: snapshots per app user id, failures on demand."""

    snapshots: dict[str, SubscriberSnapshot] = field(default_factory=dict)
    failing: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    async def get_subscriber(self, app_user_id: str) -> SubscriberSnapshot:
        self.calls.append(app_user_id)
        if app_user_id in self.failing:
            raise RevenueCatError("RevenueCat is not reachable")
        return self.snapshots.get(app_user_id, SubscriberSnapshot(app_user_id, frozenset(), ()))

    async def delete_subscriber(self, app_user_id: str) -> None:
        if app_user_id in self.failing:
            raise RevenueCatError("RevenueCat is not reachable")
        self.deleted.append(app_user_id)
        self.snapshots.pop(app_user_id, None)


def snapshot(app_user_id: str, *products: ProductState) -> SubscriberSnapshot:
    return SubscriberSnapshot(
        app_user_id, frozenset(product.product_id for product in products), products
    )
