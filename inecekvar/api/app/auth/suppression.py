"""Email suppression list (spec section 6.17 b, ADR-0050).

Only a keyed digest of the normalized address is stored: HMAC-SHA256 under the log hash key
with the domain label `email-suppression:` (32 bytes, `email_suppressions.email_hash`). Rotating
`INECEKVAR_LOG_HASH_KEY` therefore empties the effective list (ADR-0050 consequence).
Reason strength: manual > complaint > bounce; a weaker reason never replaces a stronger one.
A later delivery to the address clears a bounce; an admin removes any entry
(`DELETE /v1/admin/suppressions`).
"""

import hashlib
import hmac
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Protocol

import structlog
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import (
    Clock,
    MailCategory,
    MailSender,
    OutgoingMail,
    RateLimiter,
    normalize_email,
)
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.enums import SuppressionReason
from app.models.ops import EmailSuppression

STRONGER: dict[SuppressionReason, list[str]] = {
    SuppressionReason.BOUNCE: [SuppressionReason.MANUAL.value, SuppressionReason.COMPLAINT.value],
    SuppressionReason.COMPLAINT: [SuppressionReason.MANUAL.value],
    SuppressionReason.MANUAL: [],
}
# A hard bounce blocks security mail for this long; afterwards a sign-in link the recipient
# asks for is tried again, at most `SECURITY_AFTER_BOUNCE_RULE` times per address.
SECURITY_AFTER_BOUNCE = timedelta(days=30)
SECURITY_AFTER_BOUNCE_RULE = "mail.security_after_bounce"


class MailDecision(StrEnum):
    SEND = "send"
    BLOCK = "block"
    # Send only while the per-address rate limit allows it.
    LIMITED = "limited"


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


async def clear_bounces(db: AsyncSession, settings: Settings, emails: Iterable[str]) -> int:
    """A delivery proves the mailbox accepts mail again: drop its bounce entry (complaints and
    manual entries stay). Returns the number of entries removed."""
    digests = sorted({suppression_hash(settings, email) for email in emails})
    if not digests:
        return 0
    removed = await db.scalars(
        delete(EmailSuppression)
        .where(
            EmailSuppression.email_hash.in_(digests),
            EmailSuppression.reason == SuppressionReason.BOUNCE.value,
        )
        .returning(EmailSuppression.id)
    )
    return len(list(removed))


async def remove_suppression(db: AsyncSession, settings: Settings, email: str) -> uuid.UUID | None:
    """Remove the entry of one address whatever its reason; the removed row id or None."""
    return await db.scalar(
        delete(EmailSuppression)
        .where(EmailSuppression.email_hash == suppression_hash(settings, email))
        .returning(EmailSuppression.id)
    )


async def suppression_entry(
    db: AsyncSession, settings: Settings, email: str
) -> tuple[str, datetime] | None:
    row = (
        await db.execute(
            select(EmailSuppression.reason, EmailSuppression.suppressed_at).where(
                EmailSuppression.email_hash == suppression_hash(settings, email)
            )
        )
    ).first()
    return (row[0], row[1]) if row is not None else None


def mail_decision(
    reason: str | None,
    category: MailCategory,
    suppressed_at: datetime | None = None,
    now: datetime | None = None,
) -> MailDecision:
    """ADR-0050: a manual entry receives nothing. A hard bounce blocks every message, except
    that `security` mail the recipient requested just now (sign-in link, account-exists notice)
    is tried again `SECURITY_AFTER_BOUNCE` after the bounce, rate limited per address, so a
    one-off rejection cannot lock a passwordless account out for the whole retention. After a
    complaint only that `security` mail is still sent. Request rate limits bound how often such
    mail can be triggered."""
    if reason is None:
        return MailDecision.SEND
    if reason == SuppressionReason.COMPLAINT.value:
        return MailDecision.SEND if category == "security" else MailDecision.BLOCK
    if (
        reason == SuppressionReason.BOUNCE.value
        and category == "security"
        and suppressed_at is not None
        and now is not None
        and now - suppressed_at >= SECURITY_AFTER_BOUNCE
    ):
        return MailDecision.LIMITED
    return MailDecision.BLOCK


class DiscardingMailSender(MailSender, Protocol):
    async def discard(self, mail: OutgoingMail) -> None:
        """Do the work of `send` (build the message, open and close the same session) without
        handing the message over; fails exactly as `send` would."""
        ...


class SuppressionAwareMailSender:
    """Consults the suppression list before every message. The caller sees the same result
    whether or not a message was suppressed, and both paths do the same work up to the hand-over
    (lookup, message build, SMTP session): a suppressed address is not answered measurably
    faster (ADR-0050 item 17 records what remains)."""

    def __init__(
        self,
        inner: DiscardingMailSender,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        rate_limiter: RateLimiter,
        clock: Clock,
    ) -> None:
        self.inner = inner
        self.session_factory = session_factory
        self.settings = settings
        self.rate_limiter = rate_limiter
        self.clock = clock

    async def decide(self, mail: OutgoingMail) -> MailDecision:
        async with self.session_factory() as db:
            entry = await suppression_entry(db, self.settings, mail.to)
        reason, suppressed_at = entry if entry is not None else (None, None)
        decision = mail_decision(reason, mail.category, suppressed_at, self.clock.now())
        if decision != MailDecision.LIMITED:
            return decision
        verdict = await self.rate_limiter.hit(
            SECURITY_AFTER_BOUNCE_RULE, "email:" + normalize_email(mail.to)
        )
        return MailDecision.SEND if verdict.allowed else MailDecision.BLOCK

    async def send(self, mail: OutgoingMail) -> None:
        decision = await self.decide(mail)
        if decision == MailDecision.SEND:
            await self.inner.send(mail)
            return
        structlog.get_logger().info("mail.suppressed", category=mail.category)
        await self.inner.discard(mail)
