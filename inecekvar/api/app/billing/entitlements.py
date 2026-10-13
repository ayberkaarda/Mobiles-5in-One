"""Plus entitlement from the `subscriptions` rows (spec section 3 story 8, ADR-0024, ADR-0050).

A row entitles while its status is `active`, `cancelled` (auto-renew off: the paid period still
runs) or `grace` (billing issue inside the store grace period, `expires_at` is the end of the
grace period) and `expires_at` lies in the future. An `active` row without `expires_at` is a
non-renewing (lifetime) purchase. `expired` and `refunded` never entitle.
"""

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import Subscription
from app.models.enums import SubscriptionStatus

ENTITLING_STATUSES: tuple[str, ...] = (
    SubscriptionStatus.ACTIVE.value,
    SubscriptionStatus.CANCELLED.value,
    SubscriptionStatus.GRACE.value,
)


def entitles(status: str, expires_at: datetime | None, now: datetime) -> bool:
    """The rule of `has_plus` for one row, used by tests and the reconciliation summary."""
    if status not in ENTITLING_STATUSES:
        return False
    if expires_at is None:
        return status == SubscriptionStatus.ACTIVE.value
    return expires_at > now


class SubscriptionEntitlements:
    async def has_plus(self, db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
        return bool(
            await db.scalar(
                select(
                    select(Subscription.id)
                    .where(
                        Subscription.user_id == user_id,
                        Subscription.status.in_(ENTITLING_STATUSES),
                        or_(
                            Subscription.expires_at > now,
                            and_(
                                Subscription.expires_at.is_(None),
                                Subscription.status == SubscriptionStatus.ACTIVE.value,
                            ),
                        ),
                    )
                    .exists()
                )
            )
        )
