import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.models import SessionStepUp


class SessionStepUpSource:
    async def step_up_at(self, db: AsyncSession, principal: Principal) -> datetime | None:
        return await db.scalar(
            select(SessionStepUp.verified_at).where(
                SessionStepUp.session_id == principal.session_id,
                SessionStepUp.user_id == principal.user_id,
            )
        )


async def record_step_up(db: AsyncSession, principal: Principal, now: datetime) -> None:
    await db.execute(
        insert(SessionStepUp)
        .values(
            session_id=principal.session_id,
            user_id=principal.user_id,
            verified_at=now,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[SessionStepUp.session_id],
            set_={"user_id": principal.user_id, "verified_at": now, "updated_at": now},
        )
    )


async def revoke_session_step_up(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(delete(SessionStepUp).where(SessionStepUp.session_id == session_id))


async def revoke_user_step_ups(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(delete(SessionStepUp).where(SessionStepUp.user_id == user_id))
