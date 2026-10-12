"""Shared writes on `subscriptions` for webhook events and the REST reconciliation."""

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.revenuecat import ProductState
from app.core.ids import uuid7
from app.models.accounts import User
from app.models.billing import Subscription
from app.models.enums import SubscriptionStatus


def parse_user_id(value: str) -> uuid.UUID | None:
    """App user ids are API account ids (`apps/mobile` identifies with `user.id`); anonymous
    RevenueCat ids and aliases are not accounts."""
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def known_user_ids(db: AsyncSession, values: Iterable[str]) -> set[uuid.UUID]:
    candidates = {parsed for parsed in map(parse_user_id, values) if parsed is not None}
    if not candidates:
        return set()
    return set(await db.scalars(select(User.id).where(User.id.in_(candidates))))


def snapshot_status(product: ProductState, now: datetime) -> tuple[str, datetime | None]:
    """The (status, expires_at) of one product in a REST snapshot at `now`."""
    if product.refunded_at is not None:
        return SubscriptionStatus.REFUNDED.value, product.expires_at
    if (
        product.billing_issue_at is not None
        and product.grace_expires_at is not None
        and product.grace_expires_at > now
    ):
        return SubscriptionStatus.GRACE.value, product.grace_expires_at
    if product.expires_at is not None and product.expires_at <= now:
        return SubscriptionStatus.EXPIRED.value, product.expires_at
    if product.unsubscribed_at is not None:
        return SubscriptionStatus.CANCELLED.value, product.expires_at
    return SubscriptionStatus.ACTIVE.value, product.expires_at


async def locked_subscription(
    db: AsyncSession, user_id: uuid.UUID, app_user_id: str, product_id: str, now: datetime
) -> tuple[Subscription, bool]:
    """The row for (user, product), locked for update, and whether it was created now (as
    `expired`). INSERT ... ON CONFLICT DO NOTHING first, so concurrent jobs cannot both insert."""
    inserted = await db.scalar(
        insert(Subscription)
        .values(
            id=uuid7(),
            user_id=user_id,
            rc_app_user_id=app_user_id,
            product_id=product_id,
            status=SubscriptionStatus.EXPIRED.value,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "product_id"])
        .returning(Subscription.id)
    )
    row = await db.scalar(
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.product_id == product_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise RuntimeError("subscription row vanished inside its transaction")
    return row, inserted is not None


def set_state(
    row: Subscription,
    status: str,
    expires_at: datetime | None,
    at: datetime,
    app_user_id: str,
    now: datetime,
) -> None:
    row.status = status
    row.expires_at = expires_at
    row.last_event_at = at
    row.rc_app_user_id = app_user_id
    row.updated_at = now
