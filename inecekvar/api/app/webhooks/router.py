"""Provider webhooks (spec section 5 `POST webhooks/revenuecat`, `POST webhooks/resend`,
section 6.17, ADR-0050).

Both routes authenticate the provider before reading anything else, accept JSON only and read
the raw body (bounded by `INECEKVAR_MAX_WEBHOOK_BODY_BYTES` in the body limit middleware). They
are provider-to-server endpoints with no human role, so they are left out of the public OpenAPI
contract. Without the provider secret a route answers 503 and accepts nothing.

RevenueCat: the event is stored (unique per provider and event id, minimized to the fields the
job reads) and the processing job is enqueued; the route answers 200 after one insert, well
inside the provider's time budget. Resend: the event is applied in the request (one upsert per
recipient digest) and stores no payload.
"""

import asyncio
import json

import structlog
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert

from app.auth.suppression import clear_bounces, suppress
from app.billing.events import TEST, RevenueCatEnvelope, subject_ids
from app.billing.subscriptions import known_user_ids
from app.core.deps import DbDep, ServicesDep
from app.core.errors import UNSUPPORTED_MEDIA_TYPE, ProblemError
from app.core.ids import uuid7
from app.core.settings import svix_key
from app.models.enums import SuppressionReason, WebhookOutcome, WebhookProvider
from app.models.ops import WebhookEvent
from app.webhooks.signatures import verify_shared_secret, verify_svix

router = APIRouter(prefix="/webhooks", tags=["webhooks"], include_in_schema=False)

WEBHOOK_NOT_CONFIGURED = "webhook.not_configured"
WEBHOOK_PAYLOAD_INVALID = "webhook.payload_invalid"
WEBHOOK_UNKNOWN_SUBSCRIBER = "webhook.unknown_subscriber"
REVENUECAT_JOB = "revenuecat_event_job"
ENQUEUE_TIMEOUT_SECONDS = 1.0


class WebhookAck(BaseModel):
    status: str


def require_json(request: Request) -> None:
    types = request.headers.getlist("content-type")
    if len(types) != 1 or types[0].split(";", 1)[0].strip().lower() != "application/json":
        raise ProblemError(UNSUPPORTED_MEDIA_TYPE, 415)


@router.post("/revenuecat")
async def revenuecat_webhook(request: Request, services: ServicesDep, db: DbDep) -> WebhookAck:
    secret = services.settings.revenuecat_webhook_secret
    if secret is None:
        raise ProblemError(WEBHOOK_NOT_CONFIGURED, 503)
    verify_shared_secret(request.headers.get("authorization"), secret)
    require_json(request)
    raw = await request.body()
    try:
        envelope = RevenueCatEnvelope.model_validate_json(raw)
    except ValidationError:
        raise ProblemError(WEBHOOK_PAYLOAD_INVALID, 400) from None
    event = envelope.event
    # A test event from the dashboard changes nothing, so it needs no known account.
    if event.type != TEST and not await known_user_ids(db, subject_ids(event)):
        raise ProblemError(WEBHOOK_UNKNOWN_SUBSCRIBER, 422)
    now = services.clock.now()
    row_id = await db.scalar(
        insert(WebhookEvent)
        .values(
            id=uuid7(),
            provider=WebhookProvider.REVENUECAT.value,
            event_id=event.id,
            event_type=event.type,
            payload=json.loads(envelope.model_dump_json()),
            received_at=now,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["provider", "event_id"])
        .returning(WebhookEvent.id)
    )
    await db.commit()
    logger = structlog.get_logger()
    if row_id is None:
        logger.info(
            "webhook.received", provider="revenuecat", event_type=event.type, duplicate=True
        )
        return WebhookAck(status="duplicate")
    logger.info("webhook.received", provider="revenuecat", event_type=event.type, duplicate=False)
    if services.job_queue is not None:
        try:
            await asyncio.wait_for(
                services.job_queue.enqueue(REVENUECAT_JOB, str(row_id), job_id="rc:" + str(row_id)),
                ENQUEUE_TIMEOUT_SECONDS,
            )
        except Exception:
            # The event is stored; the worker's pending-event sweep processes it.
            logger.warning("webhook.enqueue_deferred", provider="revenuecat")
    return WebhookAck(status="accepted")


class ResendBounce(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    type: str | None = Field(default=None, max_length=64)


class ResendData(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    to: list[str] | str | None = None
    bounce: ResendBounce | None = None

    def recipients(self) -> list[str]:
        values = [self.to] if isinstance(self.to, str) else list(self.to or [])
        if len(values) > 50 or any(len(value) > 320 for value in values):
            raise ValueError("recipient list out of bounds")
        return [value for value in values if "@" in value]


class ResendEvent(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    type: str = Field(min_length=1, max_length=64)
    data: ResendData


def suppression_for(event: ResendEvent) -> SuppressionReason | None:
    if event.type == "email.complained":
        return SuppressionReason.COMPLAINT
    if event.type == "email.bounced":
        # Only a hard (`Permanent`) bounce suppresses; `Transient`, `Undetermined` and a bounce
        # without a type may deliver later and suppress nothing (ADR-0050 item 12).
        bounce_type = event.data.bounce.type if event.data.bounce is not None else None
        return SuppressionReason.BOUNCE if bounce_type == "Permanent" else None
    return None


@router.post("/resend")
async def resend_webhook(request: Request, services: ServicesDep, db: DbDep) -> WebhookAck:
    secret = services.settings.resend_webhook_secret
    if secret is None:
        raise ProblemError(WEBHOOK_NOT_CONFIGURED, 503)
    raw = await request.body()
    now = services.clock.now()
    message_id = verify_svix(
        svix_key(secret),
        request.headers.get("svix-id"),
        request.headers.get("svix-timestamp"),
        request.headers.get("svix-signature"),
        raw,
        now,
    )
    require_json(request)
    try:
        event = ResendEvent.model_validate_json(raw)
        recipients = event.data.recipients()
    except (ValidationError, ValueError):
        raise ProblemError(WEBHOOK_PAYLOAD_INVALID, 400) from None
    row_id = await db.scalar(
        insert(WebhookEvent)
        .values(
            id=uuid7(),
            provider=WebhookProvider.RESEND.value,
            event_id=message_id,
            event_type=event.type,
            received_at=now,
            processed_at=now,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=["provider", "event_id"])
        .returning(WebhookEvent.id)
    )
    logger = structlog.get_logger()
    if row_id is None:
        await db.rollback()
        logger.info("webhook.received", provider="resend", event_type=event.type, duplicate=True)
        return WebhookAck(status="duplicate")
    reason = suppression_for(event)
    suppressed = cleared = 0
    if reason is not None and recipients:
        suppressed = await suppress(db, services.settings, recipients, reason, now)
    elif event.type == "email.delivered" and recipients:
        # A later delivery proves the mailbox accepts mail again.
        cleared = await clear_bounces(db, services.settings, recipients)
    outcome = WebhookOutcome.APPLIED if suppressed + cleared else WebhookOutcome.IGNORED
    await db.execute(
        update(WebhookEvent).where(WebhookEvent.id == row_id).values(outcome=outcome.value)
    )
    await db.commit()
    logger.info(
        "webhook.received",
        provider="resend",
        event_type=event.type,
        duplicate=False,
        outcome=outcome.value,
        suppressed=suppressed,
        cleared=cleared,
    )
    return WebhookAck(status="accepted")
