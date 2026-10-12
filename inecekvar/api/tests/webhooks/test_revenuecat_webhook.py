"""`POST /v1/webhooks/revenuecat` (spec section 6.17 a, ADR-0050): shared-secret
authentication, raw JSON body, unknown subscribers, idempotency by `event.id`, 200 before
processing, and processing in the job."""

import asyncio
import hmac
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.deps import Services
from app.models.billing import Subscription
from app.models.ops import WebhookEvent
from app.workers import main as worker
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import rc_event
from tests.webhooks.conftest import RC_SECRET, RecordingJobQueue, encode, rc_headers, svix_headers

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

URL = "/v1/webhooks/revenuecat"


async def stored(services: Services) -> int:
    async with services.session_factory() as db:
        return int(await db.scalar(select(func.count()).select_from(WebhookEvent)) or 0)


async def subscriptions(services: Services) -> int:
    async with services.session_factory() as db:
        return int(await db.scalar(select(func.count()).select_from(Subscription)) or 0)


def purchase(account: Account, clock: FixedClock, **extra: Any) -> dict[str, object]:
    return rc_event(
        "INITIAL_PURCHASE",
        str(account.identity),
        clock.now(),
        expires=clock.now() + timedelta(days=30),
        **extra,
    )


@dataclass(frozen=True)
class Case:
    name: str
    status: int
    code: str
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None
    app_user_id: str | None = "account"
    secret_configured: bool = True


CASES = [
    Case("secret-not-configured", 503, "webhook.not_configured", secret_configured=False),
    Case("missing-authorization", 401, "webhook.unauthorized", {"Authorization": ""}),
    Case("wrong-secret", 401, "webhook.unauthorized", {"Authorization": "rc-webhook-" + "x" * 40}),
    Case("bearer-prefixed", 401, "webhook.unauthorized", {"Authorization": "Bearer " + RC_SECRET}),
    Case("truncated-secret", 401, "webhook.unauthorized", {"Authorization": RC_SECRET[:-1]}),
    Case("secret-with-suffix", 401, "webhook.unauthorized", {"Authorization": RC_SECRET + "x"}),
    Case(
        "wrong-content-type", 415, "request.unsupported_media_type", {"Content-Type": "text/plain"}
    ),
    Case(
        "form-content-type",
        415,
        "request.unsupported_media_type",
        {"Content-Type": "application/x-www-form-urlencoded"},
    ),
    Case("oversized-body", 413, "request.body_too_large", body=b"{" + b" " * (64 * 1024) + b"}"),
    Case("malformed-json", 400, "webhook.payload_invalid", body=b"{not json"),
    Case("missing-event", 400, "webhook.payload_invalid", body=b'{"api_version":"1.0"}'),
    Case(
        "missing-event-id",
        400,
        "webhook.payload_invalid",
        body=b'{"event":{"type":"RENEWAL","event_timestamp_ms":1}}',
    ),
    Case(
        "unknown-app-user-id",
        422,
        "webhook.unknown_subscriber",
        app_user_id="0190a3c4-0000-7000-8000-000000000000",
    ),
    Case(
        "anonymous-app-user-id",
        422,
        "webhook.unknown_subscriber",
        app_user_id="$RCAnonymousID:8a2b",
    ),
    Case("missing-app-user-id", 422, "webhook.unknown_subscriber", app_user_id=None),
]


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
async def test_revenuecat_rejections(
    case: Case,
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    if not case.secret_configured:
        webhook_services.settings = webhook_services.settings.model_copy(
            update={"revenuecat_webhook_secret": None}
        )
    subject = str(user.identity) if case.app_user_id == "account" else case.app_user_id
    body = case.body or encode(rc_event("RENEWAL", subject, clock.now(), expires=clock.now()))
    headers = rc_headers() | case.headers
    if headers.get("Authorization") == "":
        del headers["Authorization"]
    response = await client.post(URL, content=body, headers=headers)
    assert response.status_code == case.status
    assert response.json()["code"] == case.code
    assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
    assert await stored(webhook_services) == 0
    assert queue.jobs == []


async def test_resend_signature_does_not_authenticate_revenuecat(
    client: httpx.AsyncClient, webhook_services: Services, user: Account, clock: FixedClock
) -> None:
    # Replay across providers: a correctly Svix-signed delivery carries no RevenueCat secret.
    body = encode(purchase(user, clock))
    response = await client.post(URL, content=body, headers=svix_headers(body, clock))
    assert response.status_code == 401
    assert await stored(webhook_services) == 0


async def test_accepted_event_is_stored_enqueued_and_processed_by_the_job(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    body = encode(purchase(user, clock, unknown_future_field={"kept": False}))
    response = await client.post(URL, content=body, headers=rc_headers())
    assert response.status_code == 200
    assert response.json() == {"status": "accepted"}
    # Nothing is applied in the request: the job does it.
    assert await subscriptions(webhook_services) == 0
    ((function, (row_id,), job_id),) = queue.jobs
    assert (function, job_id) == ("revenuecat_event_job", "rc:" + row_id)
    async with webhook_services.session_factory() as db:
        row = await db.scalar(select(WebhookEvent))
        assert row is not None
        assert row.payload is not None
        event = row.payload["event"]
        assert isinstance(event, dict)
        # Stored minimized: only the fields the job reads.
        assert "unknown_future_field" not in event
        assert "price" not in event
    outcome = await worker.revenuecat_event_job({"services": webhook_services}, row_id)
    assert outcome == "applied"
    assert await subscriptions(webhook_services) == 1
    async with webhook_services.session_factory() as db:
        row = await db.scalar(select(WebhookEvent))
        assert row is not None
        assert (row.outcome, row.payload) == ("applied", None)


async def test_replayed_event_id_has_one_effect(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    first = purchase(user, clock, event_id="evt-replayed-1")
    assert (await client.post(URL, content=encode(first), headers=rc_headers())).json() == {
        "status": "accepted"
    }
    # The same id again, also with a changed body: a duplicate, never a second effect.
    changed = rc_event("EXPIRATION", str(user.identity), clock.now(), event_id="evt-replayed-1")
    for body in (first, changed):
        response = await client.post(URL, content=encode(body), headers=rc_headers())
        assert response.status_code == 200
        assert response.json() == {"status": "duplicate"}
    assert await stored(webhook_services) == 1
    assert len(queue.jobs) == 1
    await worker.revenuecat_event_job({"services": webhook_services}, queue.jobs[0][1][0])
    async with webhook_services.session_factory() as db:
        row = await db.scalar(select(Subscription))
        assert row is not None
        assert row.status == "active"


async def test_concurrent_delivery_of_one_event_has_one_effect(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    body = encode(purchase(user, clock, event_id="evt-concurrent-1"))
    responses = await asyncio.gather(
        *[client.post(URL, content=body, headers=rc_headers()) for _ in range(8)]
    )
    assert [response.status_code for response in responses] == [200] * 8
    statuses = sorted(response.json()["status"] for response in responses)
    assert statuses == ["accepted"] + ["duplicate"] * 7
    assert await stored(webhook_services) == 1
    assert len(queue.jobs) == 1
    row_id = queue.jobs[0][1][0]
    ctx = {"services": webhook_services}
    outcomes = await asyncio.gather(*[worker.revenuecat_event_job(ctx, row_id) for _ in range(4)])
    assert sorted(outcome or "" for outcome in outcomes) == ["", "", "", "applied"]
    assert await subscriptions(webhook_services) == 1


async def test_test_event_needs_no_known_account(
    client: httpx.AsyncClient,
    webhook_services: Services,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    body = encode(rc_event("TEST", "dashboard-test-user", clock.now()))
    response = await client.post(URL, content=body, headers=rc_headers())
    assert response.status_code == 200
    outcome = await worker.revenuecat_event_job({"services": webhook_services}, queue.jobs[0][1][0])
    assert outcome == "ignored"
    assert await subscriptions(webhook_services) == 0


async def test_transfer_needs_one_known_account(
    client: httpx.AsyncClient, webhook_services: Services, user: Account, clock: FixedClock
) -> None:
    unknown = rc_event(
        "TRANSFER",
        None,
        clock.now(),
        product_id=None,
        transferred_from=["0190a3c4-0000-7000-8000-000000000001"],
        transferred_to=["$RCAnonymousID:1"],
    )
    response = await client.post(URL, content=encode(unknown), headers=rc_headers())
    assert response.status_code == 422
    known = rc_event(
        "TRANSFER",
        None,
        clock.now(),
        product_id=None,
        transferred_from=["$RCAnonymousID:1"],
        transferred_to=[str(user.identity)],
    )
    assert (await client.post(URL, content=encode(known), headers=rc_headers())).status_code == 200


async def test_answer_within_two_seconds_even_when_the_queue_hangs(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    queue.delay = 10.0
    started = time.perf_counter()
    response = await client.post(URL, content=encode(purchase(user, clock)), headers=rc_headers())
    elapsed = time.perf_counter() - started
    assert response.status_code == 200
    assert elapsed < 2.0
    # Stored durably; the pending sweep processes it after a minute.
    assert await subscriptions(webhook_services) == 0
    clock.advance(minutes=2)
    assert await worker.webhooks_pending_job({"services": webhook_services}) == 1
    assert await subscriptions(webhook_services) == 1


async def test_broken_queue_still_answers_and_the_sweep_processes(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    queue.fail = True
    response = await client.post(URL, content=encode(purchase(user, clock)), headers=rc_headers())
    assert response.json() == {"status": "accepted"}
    webhook_services.job_queue = None
    response = await client.post(URL, content=encode(purchase(user, clock)), headers=rc_headers())
    assert response.json() == {"status": "accepted"}
    clock.advance(minutes=2)
    assert await worker.webhooks_pending_job({"services": webhook_services}) == 2
    assert await worker.webhooks_pending_job({"services": webhook_services}) == 0


async def test_secret_comparison_is_constant_time(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[bytes, bytes]] = []
    original = hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        calls.append((a, b))
        return original(a, b)

    monkeypatch.setattr(hmac, "compare_digest", spy)
    for secret, status in (("rc-webhook-" + "z" * 40, 401), (RC_SECRET, 200)):
        response = await client.post(
            URL, content=encode(purchase(user, clock)), headers=rc_headers(secret)
        )
        assert response.status_code == status
    assert calls == [
        (("rc-webhook-" + "z" * 40).encode(), RC_SECRET.encode()),
        (RC_SECRET.encode(), RC_SECRET.encode()),
    ]


async def test_secret_settings_are_validated() -> None:
    from tests.support.app import make_test_settings

    with pytest.raises(ValueError, match="at least 32"):
        make_test_settings(revenuecat_webhook_secret=SecretStr("short"))
    with pytest.raises(ValueError, match="whsec_"):
        make_test_settings(resend_webhook_secret=SecretStr("no-prefix"))
    with pytest.raises(ValueError, match="too short"):
        make_test_settings(resend_webhook_secret=SecretStr("whsec_c2hvcnQ="))


async def test_aliased_anonymous_id_is_accepted_and_reaches_the_account(
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
    queue: RecordingJobQueue,
) -> None:
    # A purchase made before sign-in: the event names the anonymous id, the aliases the account.
    body = rc_event(
        "INITIAL_PURCHASE",
        "$RCAnonymousID:8a2b",
        clock.now(),
        expires=clock.now() + timedelta(days=30),
        aliases=["$RCAnonymousID:8a2b", str(user.identity)],
    )
    response = await client.post(URL, content=encode(body), headers=rc_headers())
    assert response.json() == {"status": "accepted"}
    ((_, (row_id,), _),) = queue.jobs
    assert await worker.revenuecat_event_job({"services": webhook_services}, row_id) == "applied"
    async with webhook_services.session_factory() as db:
        row = await db.scalar(select(Subscription))
    assert row is not None
    assert (row.user_id, row.rc_app_user_id) == (user.identity, str(user.identity))


@pytest.mark.parametrize("path", ["/v1/webhooks/revenuecat", "/v1/webhooks/resend"])
async def test_body_without_declared_length_is_refused_before_reading(
    path: str,
    client: httpx.AsyncClient,
    webhook_services: Services,
    user: Account,
    clock: FixedClock,
) -> None:
    async def chunks() -> Any:
        for part in (b'{"api_version":"1.0",', b'"event":{}}'):
            yield part

    response = await client.post(path, content=chunks(), headers=rc_headers())
    assert response.request.headers.get("content-length") is None
    assert (response.status_code, response.json()["code"]) == (411, "request.length_required")
    assert await stored(webhook_services) == 0
