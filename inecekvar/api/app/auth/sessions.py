import uuid
from datetime import datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import BearerOut, CookieOut, MeOut, RefreshOut
from app.auth.step_up import revoke_user_step_ups
from app.auth.tokens import access_token, opaque_token, token_hash
from app.core.deps import AuthMode, check_cookie_origin, csrf_token_for
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.accounts import RefreshToken, User, UserSession
from app.models.enums import RefreshRevokeReason


def canonical_cookie_headers(response: Response) -> None:
    response.raw_headers[:] = [
        (name, value.replace(b"SameSite=lax", b"SameSite=Lax") if name == b"set-cookie" else value)
        for name, value in response.raw_headers
    ]


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    canonical_cookie_headers(response)
    response.headers["Cache-Control"] = "no-store"


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name, path="/", secure=True, httponly=True, samesite="lax"
    )
    canonical_cookie_headers(response)
    response.headers["Cache-Control"] = "no-store"


def new_refresh(
    db: AsyncSession,
    settings: Settings,
    user_id: uuid.UUID,
    family_id: uuid.UUID,
    now: datetime,
    parent_id: uuid.UUID | None = None,
) -> str:
    raw = opaque_token()
    db.add(
        RefreshToken(
            id=uuid7(),
            user_id=user_id,
            family_id=family_id,
            parent_id=parent_id,
            token_hash=token_hash(raw),
            expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
            created_at=now,
            updated_at=now,
        )
    )
    return raw


def refresh_output(
    settings: Settings, user_id: uuid.UUID, family_id: uuid.UUID, raw: str, now: datetime
) -> RefreshOut:
    return RefreshOut(
        access_token=access_token(settings, user_id, family_id, now),
        expires_in=settings.access_token_ttl_seconds,
        refresh_token=raw,
    )


async def issue_session(
    db: AsyncSession,
    settings: Settings,
    request: Request,
    response: Response,
    user: User,
    mode: AuthMode,
    now: datetime,
) -> CookieOut | BearerOut:
    response.headers["Cache-Control"] = "no-store"
    if mode == "cookie":
        check_cookie_origin(request, settings)
        raw = opaque_token()
        session_id = uuid7()
        db.add(
            UserSession(
                id=session_id,
                user_id=user.id,
                token_hash=token_hash(raw),
                expires_at=now + timedelta(days=settings.session_ttl_days),
                last_seen_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        await db.commit()
        set_session_cookie(response, settings, raw)
        return CookieOut(
            user=MeOut.from_user(user), csrf_token=csrf_token_for(settings, session_id)
        )
    family_id = uuid7()
    raw = new_refresh(db, settings, user.id, family_id, now)
    output = refresh_output(settings, user.id, family_id, raw, now)
    await db.commit()
    return BearerOut(
        user=MeOut.from_user(user),
        access_token=output.access_token,
        expires_in=output.expires_in,
        refresh_token=output.refresh_token,
    )


async def revoke_family(
    db: AsyncSession, family_id: uuid.UUID, now: datetime, reason: RefreshRevokeReason
) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason=reason.value, updated_at=now)
    )


async def revoke_user(
    db: AsyncSession, user_id: uuid.UUID, now: datetime, reason: RefreshRevokeReason
) -> None:
    await revoke_user_step_ups(db, user_id)
    await db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now, updated_at=now)
    )
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason=reason.value, updated_at=now)
    )


async def roll_session(
    db: AsyncSession,
    settings: Settings,
    request: Request,
    response: Response,
    session_id: uuid.UUID,
    now: datetime,
) -> None:
    session = await db.scalar(select(UserSession).where(UserSession.id == session_id))
    if session is not None:
        session.expires_at = now + timedelta(days=settings.session_ttl_days)
        session.last_seen_at = now
        session.updated_at = now
        await db.commit()
        raw = request.cookies.get(settings.session_cookie_name)
        if raw is not None:
            set_session_cookie(response, settings, raw)
