"""Email suppression list (spec section 6.17 b, ADR-0050).

Only a keyed digest of the normalized address is stored: HMAC-SHA256 under the log hash key
with the domain label `email-suppression:` (32 bytes, `email_suppressions.email_hash`). Rotating
`INECEKVAR_LOG_HASH_KEY` therefore empties the effective list (ADR-0050 consequence).
Reason strength: manual > complaint > bounce; a weaker reason never replaces a stronger one.
"""

import hashlib
import hmac
from collections.abc import Iterable
from datetime import datetime

import structlog
from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import MailCategory, MailSender, OutgoingMail, normalize_email
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.enums import SuppressionReason
from app.models.ops import EmailSuppression

STRONGER: dict[SuppressionReason, list[str]] = {
    SuppressionReason.BOUNCE: [SuppressionReason.MANUAL.value, SuppressionReason.COMPLAINT.value],
    SuppressionReason.COMPLAINT: [SuppressionReason.MANUAL.value],
    SuppressionReason.MANUAL: [],
}


def suppression_hash(settings: Settings, email: str) -> bytes:
    return hmac.new(
        settings.require_secret("log_hash_key"),
        b"email-suppression:" + normalize_email(email).encode(),
        hashlib.sha256,
    ).digest()


async def suppress(
    db: AsyncSession,
    settings: Settings,
    emails: Iterable[str],
    reason: SuppressionReason,
    now: datetime,
) -> int:
    """Upsert one row per distinct address; returns the number of addresses."""
    digests = sorted({suppression_hash(settings, email) for email in emails})
    for digest in digests:
        statement = insert(EmailSuppression).values(
            id=uuid7(),
            email_hash=digest,
            reason=reason.value,
            suppressed_at=now,
            created_at=now,
            updated_at=now,
        )
        stronger = EmailSuppression.reason.in_(STRONGER[reason])
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=["email_hash"],
                set_={
                    "reason": case(
                        (stronger, EmailSuppression.reason), else_=statement.excluded.reason
                    ),
                    "suppressed_at": statement.excluded.suppressed_at,
                    "updated_at": statement.excluded.updated_at,
                },
            )
        )
    return len(digests)


async def suppression_reason(db: AsyncSession, settings: Settings, email: str) -> str | None:
    return await db.scalar(
        select(EmailSuppression.reason).where(
            EmailSuppression.email_hash == suppression_hash(settings, email)
        )
    )


def blocks(reason: str | None, category: MailCategory) -> bool:
    """ADR-0050: a bounced or manually suppressed address receives nothing (it cannot or must
    not receive mail); after a complaint only `security` mail the recipient requested just now
    (sign-in links, the account-exists notice) is still sent, so a passwordless account is not
    locked out. Request rate limits bound how often such mail can be triggered."""
    if reason is None:
        return False
    if reason == SuppressionReason.COMPLAINT.value:
        return category != "security"
    return True


class SuppressionAwareMailSender:
    """Consults the suppression list before every message; the caller sees the same result
    whether or not a message was suppressed (no address oracle)."""

    def __init__(
        self,
        inner: MailSender,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
    ) -> None:
        self.inner = inner
        self.session_factory = session_factory
        self.settings = settings

    async def send(self, mail: OutgoingMail) -> None:
        async with self.session_factory() as db:
            reason = await suppression_reason(db, self.settings, mail.to)
        if blocks(reason, mail.category):
            structlog.get_logger().info("mail.suppressed", category=mail.category, reason=reason)
            return
        await self.inner.send(mail)
