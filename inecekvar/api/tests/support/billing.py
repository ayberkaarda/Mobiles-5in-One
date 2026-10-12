import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession


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
