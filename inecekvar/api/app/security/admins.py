import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.errors import AUTH_FORBIDDEN, AUTH_REQUIRED, STEP_UP_REQUIRED, ProblemError
from app.models.accounts import RefreshToken, SessionStepUp, User, UserSession
from app.models.enums import UserRole
from app.security.policy import STEP_UP_TTL

ADMIN_LOCK_ID = 731942608154


async def lock_admins(db: AsyncSession) -> list[User]:
    await db.execute(text("SELECT pg_advisory_xact_lock(:identity)"), {"identity": ADMIN_LOCK_ID})
    return list(
        await db.scalars(
            select(User)
            .where(User.role == UserRole.ADMIN.value, User.deactivated_at.is_(None))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )


def ensure_admin_remains(active_admins: Sequence[User], leaving_user_id: uuid.UUID) -> None:
    if len(active_admins) == 1 and active_admins[0].id == leaving_user_id:
        raise ProblemError("admin.last_admin", 409)


async def revalidate_admin_actor(db: AsyncSession, principal: Principal, now: datetime) -> None:
    user = await db.scalar(
        select(User)
        .where(User.id == principal.user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or user.role != UserRole.ADMIN.value or user.deactivated_at is not None:
        raise ProblemError(AUTH_FORBIDDEN, 403)
    if principal.auth_mode == "cookie":
        live = await db.scalar(
            select(UserSession.id).where(
                UserSession.id == principal.session_id,
                UserSession.user_id == principal.user_id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
        )
    else:
        live = await db.scalar(
            select(RefreshToken.id)
            .where(
                RefreshToken.family_id == principal.session_id,
                RefreshToken.user_id == principal.user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .limit(1)
        )
    if live is None:
        raise ProblemError(AUTH_REQUIRED, 401)
    verified_at = await db.scalar(
        select(SessionStepUp.verified_at).where(
            SessionStepUp.session_id == principal.session_id,
            SessionStepUp.user_id == principal.user_id,
        )
    )
    if (
        user.totp_enabled_at is None
        or verified_at is None
        or not timedelta(0) <= now - verified_at <= STEP_UP_TTL
    ):
        raise ProblemError(STEP_UP_REQUIRED, 403)
