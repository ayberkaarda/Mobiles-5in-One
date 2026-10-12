"""Webhook log sample (spec section 6.14, ADR-0050): counts, event types and keyed digests only;
no address, secret, signature or authorization value."""

import io
from datetime import timedelta

import httpx
import pytest

from app.core.deps import Services
from app.workers import main as worker
from tests.core.test_logging import log_stream
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import rc_event
from tests.webhooks.conftest import (
    RC_SECRET,
    RESEND_SECRET,
    RecordingJobQueue,
    encode,
    rc_headers,
    resend_event,
    svix_headers,
)

__all__ = ["log_stream"]

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_webhook_logs_hold_no_address_secret_or_signature(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
    log_stream: io.StringIO,
) -> None:
    purchase = rc_event(
        "INITIAL_PURCHASE", str(user.identity), clock.now(), expires=clock.now() + timedelta(days=3)
    )
    assert (
        await client.post("/v1/webhooks/revenuecat", content=encode(purchase), headers=rc_headers())
    ).status_code == 200
    await worker.revenuecat_event_job({"services": webhook_services}, queue.jobs[0][1][0])
    body = encode(resend_event("email.bounced", "Leaky.Person@example.org"))
    headers = svix_headers(body, clock)
    assert (
        await client.post("/v1/webhooks/resend", content=body, headers=headers)
    ).status_code == 200
    wrong = await client.post(
        "/v1/webhooks/revenuecat", content=encode(purchase), headers=rc_headers("x" * 40)
    )
    assert wrong.status_code == 401
    output = log_stream.getvalue()
    assert "webhook.received" in output
    assert "webhook.revenuecat.processed" in output
    for secret in (
        RC_SECRET,
        RESEND_SECRET,
        RESEND_SECRET.removeprefix("whsec_"),
        headers["svix-signature"].removeprefix("v1,"),
        "Leaky.Person",
        "leaky.person",
        "example.org",
        str(user.identity),
    ):
        assert secret not in output
