from datetime import timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tokens import decode_access_token, token_hash
from app.core.deps import Clock, Principal
from app.core.errors import AUTH_REQUIRED, ProblemError
from app.core.settings import Settings
from app.models.accounts import RefreshToken, User, UserSession
from app.models.enums import UserRole


class TokenSessionAuthenticator:
    def __init__(self, settings: Settings, clock: Clock) -> None:
        self.settings = settings
        self.clock = clock

    async def authenticate(self, request: Request, db: AsyncSession) -> Principal | None:
        now = self.clock.now()
        authorization = request.headers.get("authorization")
        if authorization is not None:
            scheme, separator, raw = authorization.partition(" ")
            if scheme.lower() != "bearer" or not separator or not raw or " " in raw:
                raise ProblemError(AUTH_REQUIRED, 401)
            identity = decode_access_token(raw, self.settings, now)
            user = await db.get(User, identity.user_id)
            live = await db.scalar(
                select(RefreshToken.id)
                .where(
                    RefreshToken.family_id == identity.family_id,
                    RefreshToken.user_id == identity.user_id,
                    RefreshToken.revoked_at.is_(None),
                    RefreshToken.expires_at > now,
                )
                .limit(1)
            )
            if user is None or user.deactivated_at is not None or live is None:
                raise ProblemError(AUTH_REQUIRED, 401)
            return Principal(user.id, UserRole(user.role), identity.family_id, "bearer")
        cookie = request.cookies.get(self.settings.session_cookie_name)
        if cookie is None:
            return None
        session = await db.scalar(
            select(UserSession).where(
                UserSession.token_hash == token_hash(cookie),
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
        )
        if session is None:
            raise ProblemError(AUTH_REQUIRED, 401)
        user = await db.get(User, session.user_id)
        if user is None or user.deactivated_at is not None:
            raise ProblemError(AUTH_REQUIRED, 401)
        if session.last_seen_at < now - timedelta(hours=1):
            session.expires_at = now + timedelta(days=self.settings.session_ttl_days)
            session.last_seen_at = now
            session.updated_at = now
            await db.commit()
        return Principal(user.id, UserRole(user.role), session.id, "cookie")
