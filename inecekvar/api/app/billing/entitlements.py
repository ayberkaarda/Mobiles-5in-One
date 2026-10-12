import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import Subscription


class SubscriptionEntitlements:
    async def has_plus(self, db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
        return bool(
            await db.scalar(
                select(
                    select(Subscription.id)
                    .where(
                        Subscription.user_id == user_id,
                        Subscription.status.in_(("active", "grace")),
                        or_(Subscription.expires_at.is_(None), Subscription.expires_at > now),
                    )
                    .exists()
                )
            )
        )
