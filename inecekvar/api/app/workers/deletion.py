from typing import TypedDict

import structlog
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import Clock, MailSender, OutgoingMail, SubscriberDeleter
from app.core.settings import Settings
from app.core.storage import ObjectStore
from app.models.accounts import (
    DeletionRequest,
    Favorite,
    MagicLink,
    RefreshToken,
    User,
    UserSession,
)
from app.models.billing import PackDownload, Subscription
from app.models.contributions import Edit, Photo, Trace
from app.models.ops import AuditLog


class DeletionRunSummary(TypedDict):
    deleted: int
    deferred: int


async def hard_delete_due(
    session_factory: async_sessionmaker[AsyncSession],
    store: ObjectStore | None,
    settings: Settings,
    clock: Clock,
    mail_sender: MailSender,
    subscriber_deleter: SubscriberDeleter | None,
) -> DeletionRunSummary:
    now = clock.now()
    summary: DeletionRunSummary = {"deleted": 0, "deferred": 0}
    logger = structlog.get_logger()
    async with session_factory() as db:
        identities = list(
            await db.scalars(
                select(DeletionRequest.user_id)
                .join(User, User.id == DeletionRequest.user_id)
                .where(
                    DeletionRequest.state == "scheduled",
                    DeletionRequest.scheduled_for <= now,
                    User.deactivated_at.is_not(None),
                )
                .order_by(DeletionRequest.user_id)
            )
        )
    for identity in identities:
        async with session_factory() as db, db.begin():
            user = await db.scalar(select(User).where(User.id == identity).with_for_update())
            if user is None or user.deactivated_at is None:
                continue
            request = await db.scalar(
                select(DeletionRequest)
                .where(
                    DeletionRequest.user_id == identity,
                    DeletionRequest.state == "scheduled",
                    DeletionRequest.scheduled_for <= now,
                )
                .with_for_update()
            )
            if request is None:
                continue
            subscriptions = list(
                await db.scalars(select(Subscription).where(Subscription.user_id == identity))
            )
            photos = list(
                await db.scalars(select(Photo).where(Photo.owner_id == identity).with_for_update())
            )
            if (subscriptions and subscriber_deleter is None) or (photos and store is None):
                summary["deferred"] += 1
                continue
            try:
                if subscriber_deleter is not None:
                    # The app identifies every signed-in user at RevenueCat by the account id,
                    # so that subscriber exists for non-paying users too (404 counts as gone).
                    app_user_ids = {str(identity)} | {row.rc_app_user_id for row in subscriptions}
                    for app_user_id in sorted(app_user_ids):
                        await subscriber_deleter.delete_subscriber(app_user_id)
                if store is not None:
                    for photo in photos:
                        for key in (
                            "photos/" + str(photo.id) + ".webp",
                            "incoming/" + str(photo.id),
                            "quarantine/" + str(photo.id),
                        ):
                            await store.delete(settings.media_bucket, key)
            except Exception:
                logger.warning("account.erasure_deferred", user_id=str(identity))
                summary["deferred"] += 1
                continue
            try:
                await mail_sender.send(
                    OutgoingMail(
                        to=user.email,
                        subject="İnecek Var hesabın silindi",
                        text="İnecek Var hesabın ve kişisel verilerin silindi. "
                        "Onaylanmış katkıların silinmiş katkıcı adıyla korunur.",
                    )
                )
            except Exception:
                logger.warning("account.erasure_mail_failed", user_id=str(identity))
            await db.execute(delete(Subscription).where(Subscription.user_id == identity))
            await db.execute(delete(Photo).where(Photo.owner_id == identity))
            await db.execute(delete(UserSession).where(UserSession.user_id == identity))
            await db.execute(delete(RefreshToken).where(RefreshToken.user_id == identity))
            await db.execute(
                delete(MagicLink).where(
                    or_(MagicLink.user_id == identity, MagicLink.email == user.email)
                )
            )
            await db.execute(delete(Favorite).where(Favorite.user_id == identity))
            await db.execute(delete(Trace).where(Trace.author_id == identity))
            await db.execute(
                delete(Edit).where(Edit.author_id == identity, Edit.state != "approved")
            )
            # SET NULL would violate identity_present for signed-in pack records.
            await db.execute(delete(PackDownload).where(PackDownload.user_id == identity))
            await db.execute(
                update(AuditLog)
                .where(AuditLog.target_type == "user", AuditLog.target_id == identity)
                .values(target_id=None)
            )
            db.add(
                AuditLog(
                    actor_id=None,
                    action="account.deleted",
                    target_type="user",
                    target_id=None,
                    created_at=now,
                    updated_at=now,
                )
            )
            await db.delete(user)
        summary["deleted"] += 1
    logger.info("account.erasure_completed", **summary)
    return summary
