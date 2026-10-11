import uuid
from datetime import datetime, timedelta

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.mail import account_exists_mail, magic_link_mail
from app.auth.passwords import DUMMY_HASH, hash_password, verify_password
from app.auth.schemas import RefreshOut
from app.auth.sessions import new_refresh, refresh_output, revoke_family, revoke_user
from app.auth.tokens import opaque_token, token_hash
from app.core.deps import MailSender, Principal, RateLimiter, enforce_rate_limit
from app.core.errors import (
    AUTH_INVALID_CREDENTIALS,
    AUTH_REQUIRED,
    AUTH_TOKEN_INVALID,
    ProblemError,
)
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.accounts import (
    DeletionRequest,
    Favorite,
    MagicLink,
    RefreshToken,
    User,
    UserSession,
)
from app.models.contributions import Edit, Trace
from app.models.enums import (
    DeletionState,
    EditState,
    MagicLinkPurpose,
    RefreshRevokeReason,
    UserRole,
)
from app.models.ops import AuditLog


async def locked_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or user.deactivated_at is not None:
        raise ProblemError(AUTH_REQUIRED, 401)
    return user


async def send_link(
    db: AsyncSession,
    settings: Settings,
    mail: MailSender,
    email: str,
    now: datetime,
    password: str | None = None,
) -> None:
    password_hash = hash_password(password, settings) if password is not None else None
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None and user.deactivated_at is not None and password is None:
        return
    raw = opaque_token()
    purpose = (
        MagicLinkPurpose.REGISTER
        if password is not None and user is None
        else MagicLinkPurpose.LOGIN
    )
    db.add(
        MagicLink(
            id=uuid7(),
            email=email,
            user_id=user.id if user is not None else None,
            token_hash=token_hash(raw),
            purpose=purpose.value,
            password_hash=password_hash if purpose == MagicLinkPurpose.REGISTER else None,
            expires_at=now + timedelta(minutes=settings.magic_link_ttl_minutes),
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    builder = account_exists_mail if password is not None and user is not None else magic_link_mail
    await mail.send(builder(email, raw, settings))


async def verify_link(db: AsyncSession, raw: str, now: datetime) -> User:
    link = await db.scalar(
        select(MagicLink)
        .where(
            MagicLink.token_hash == token_hash(raw),
            MagicLink.used_at.is_(None),
            MagicLink.expires_at > now,
        )
        .with_for_update()
    )
    if link is None:
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    link.used_at = now
    link.updated_at = now
    await db.execute(
        insert(User)
        .values(
            id=uuid7(),
            email=link.email,
            password_hash=link.password_hash if link.purpose == MagicLinkPurpose.REGISTER else None,
            email_verified_at=now,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[User.email])
    )
    user = await db.scalar(select(User).where(User.email == link.email).with_for_update())
    link.password_hash = None
    if user is None or user.deactivated_at is not None:
        await db.commit()
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    if user.email_verified_at is None:
        user.email_verified_at = now
        user.updated_at = now
    return user


async def password_login(
    db: AsyncSession, settings: Settings, email: str, password: str, now: datetime
) -> User:
    user = await db.scalar(select(User).where(User.email == email).with_for_update())
    stored = user.password_hash if user is not None and user.password_hash else DUMMY_HASH
    ok, rehash = verify_password(password, stored, settings)
    if user is None or user.password_hash is None or not ok or user.deactivated_at is not None:
        structlog.get_logger().info("auth.login.failed")
        raise ProblemError(AUTH_INVALID_CREDENTIALS, 401)
    if rehash:
        user.password_hash = hash_password(password, settings)
        user.updated_at = now
    return user


async def rotate_refresh(
    db: AsyncSession, settings: Settings, limiter: RateLimiter, raw: str, now: datetime
) -> RefreshOut:
    candidate = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw))
    )
    if candidate is None:
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    # The user lock serializes rotation with family revocation and account deletion.
    user = await db.scalar(select(User).where(User.id == candidate.user_id).with_for_update())
    token = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.id == candidate.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if token is None or token.expires_at <= now:
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    if token.used_at is not None or token.revoked_at is not None:
        await revoke_family(db, token.family_id, now, RefreshRevokeReason.REUSE_DETECTED)
        token.revoked_at = now
        token.revoked_reason = RefreshRevokeReason.REUSE_DETECTED.value
        token.updated_at = now
        await db.commit()
        structlog.get_logger().warning(
            "auth.refresh.reuse_detected", family_id=str(token.family_id)
        )
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    if user is None or user.deactivated_at is not None:
        raise ProblemError(AUTH_TOKEN_INVALID, 401)
    await enforce_rate_limit(limiter, "auth.refresh", "family:" + str(token.family_id))
    token.used_at = now
    token.revoked_at = now
    token.revoked_reason = RefreshRevokeReason.ROTATED.value
    token.updated_at = now
    child = new_refresh(db, settings, token.user_id, token.family_id, now, token.id)
    # Sign before committing so a configuration failure cannot consume the token.
    output = refresh_output(settings, token.user_id, token.family_id, child, now)
    await db.commit()
    structlog.get_logger().info("auth.refresh.rotated", family_id=str(token.family_id))
    return output


async def accept_licence(db: AsyncSession, user: User, now: datetime) -> None:
    if user.licence_accepted_at is not None:
        return
    user.licence_accepted_at = now
    user.updated_at = now
    if user.role == UserRole.USER:
        user.role = UserRole.CONTRIBUTOR.value
    db.add(
        AuditLog(
            id=uuid7(),
            actor_id=user.id,
            action="licence.accept",
            target_type="user",
            target_id=user.id,
            created_at=now,
            updated_at=now,
        )
    )


async def request_deletion(
    db: AsyncSession,
    settings: Settings,
    principal: Principal,
    user: User,
    password: str | None,
    now: datetime,
) -> None:
    if user.password_hash is not None:
        ok, _ = verify_password(password or "", user.password_hash, settings)
        if password is None or not ok:
            raise ProblemError(AUTH_INVALID_CREDENTIALS, 401)
    else:
        verify_password(password or "", DUMMY_HASH, settings)
        created: datetime | None
        if principal.auth_mode == "cookie":
            created = await db.scalar(
                select(UserSession.created_at).where(UserSession.id == principal.session_id)
            )
        else:
            created = await db.scalar(
                select(func.min(RefreshToken.created_at)).where(
                    RefreshToken.family_id == principal.session_id,
                    RefreshToken.user_id == user.id,
                )
            )
        if created is None or created < now - timedelta(minutes=10):
            raise ProblemError("auth.reauth_required", 401)
    user.deactivated_at = now
    user.updated_at = now
    scheduled = await db.scalar(
        select(DeletionRequest.id).where(
            DeletionRequest.user_id == user.id, DeletionRequest.state == DeletionState.SCHEDULED
        )
    )
    if scheduled is None:
        db.add(
            DeletionRequest(
                id=uuid7(),
                user_id=user.id,
                state=DeletionState.SCHEDULED.value,
                scheduled_for=now + timedelta(days=7),
                created_at=now,
                updated_at=now,
            )
        )
    await revoke_user(db, user.id, now, RefreshRevokeReason.ACCOUNT_DELETED)
    await db.execute(delete(Favorite).where(Favorite.user_id == user.id))
    await db.execute(delete(Trace).where(Trace.author_id == user.id))
    await db.execute(
        update(Edit)
        .where(Edit.author_id == user.id, Edit.state == EditState.PENDING)
        .values(state=EditState.WITHDRAWN.value, updated_at=now)
    )
    db.add(
        AuditLog(
            id=uuid7(),
            actor_id=None,
            action="account.delete_requested",
            target_type="user",
            target_id=user.id,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    structlog.get_logger().info("auth.account.delete_requested", user_id=str(user.id))
