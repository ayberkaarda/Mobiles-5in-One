"""`POST /v1/webhooks/resend` (spec section 6.17 b, ADR-0050): Svix signature over the raw body,
five-minute timestamp tolerance, idempotency by `svix-id`, suppression list stores digests only."""

import asyncio
import base64
import hmac
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select, text

from app.auth.suppression import suppression_hash
from app.core.deps import Services
from app.models.ops import EmailSuppression, WebhookEvent
from app.webhooks.signatures import svix_signature, verify_svix
from tests.domain.conftest import Account
from tests.support.app import FixedClock
from tests.support.billing import rc_event
from tests.webhooks.conftest import (
    RESEND_KEY,
    encode,
    rc_headers,
    resend_event,
    svix_headers,
)

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

URL = "/v1/webhooks/resend"
ADDRESS = "Bounce.Target@Example.com"

type Builder = Callable[[bytes, FixedClock], tuple[bytes, dict[str, str]]]


async def rows(services: Services) -> tuple[int, int]:
    async with services.session_factory() as db:
        events = await db.scalar(select(func.count()).select_from(WebhookEvent))
        suppressions = await db.scalar(select(func.count()).select_from(EmailSuppression))
        return int(events or 0), int(suppressions or 0)


async def reason_of(services: Services, email: str) -> str | None:
    async with services.session_factory() as db:
        return await db.scalar(
            select(EmailSuppression.reason).where(
                EmailSuppression.email_hash == suppression_hash(services.settings, email)
            )
        )


@dataclass(frozen=True)
class Case:
    name: str
    status: int
    code: str


def tampered(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    headers = svix_headers(body, clock)
    return body.replace(b"bounced", b"complained"), headers


def without(header: str) -> Builder:
    def build(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
        headers = svix_headers(body, clock)
        del headers[header]
        return body, headers

    return build


def variant(*, offset: int = 0, key: bytes = RESEND_KEY) -> Builder:
    def build(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
        return body, svix_headers(body, clock, offset=offset, key=key)

    return build


def edit(**changes: str) -> Builder:
    def build(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
        return body, svix_headers(body, clock) | changes

    return build


def v2_signature(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    headers = svix_headers(body, clock)
    headers["svix-signature"] = headers["svix-signature"].replace("v1,", "v2,")
    return body, headers


def oversized(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    big = b'{"pad":"' + b"x" * (64 * 1024) + b'"}'
    return big, svix_headers(big, clock)


def malformed(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    broken = b'{"type": "email.bounced", "data": '
    return broken, svix_headers(broken, clock)


def too_many_recipients(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    many = encode(resend_event("email.bounced", *[f"a{i}@example.com" for i in range(51)]))
    return many, svix_headers(many, clock)


def revenuecat_auth(body: bytes, clock: FixedClock) -> tuple[bytes, dict[str, str]]:
    # Replay across providers: the RevenueCat shared secret is no Svix signature.
    return body, rc_headers()


CASES: list[tuple[Case, Builder]] = [
    (Case("missing-svix-id", 401, "webhook.signature_invalid"), without("svix-id")),
    (Case("missing-timestamp", 401, "webhook.signature_invalid"), without("svix-timestamp")),
    (Case("missing-signature", 401, "webhook.signature_invalid"), without("svix-signature")),
    (Case("wrong-secret", 401, "webhook.signature_invalid"), variant(key=bytes(32))),
    (Case("tampered-body", 401, "webhook.signature_invalid"), tampered),
    (Case("stale-timestamp", 401, "webhook.timestamp_invalid"), variant(offset=-301)),
    (Case("future-timestamp", 401, "webhook.timestamp_invalid"), variant(offset=301)),
    (
        Case("non-numeric-timestamp", 401, "webhook.timestamp_invalid"),
        edit(**{"svix-timestamp": "1e9"}),
    ),
    (
        Case("signature-for-other-id", 401, "webhook.signature_invalid"),
        edit(**{"svix-id": "msg_other"}),
    ),
    (Case("unknown-version", 401, "webhook.signature_invalid"), v2_signature),
    (Case("empty-signature", 401, "webhook.signature_invalid"), edit(**{"svix-signature": "v1,"})),
    (Case("revenuecat-secret", 401, "webhook.signature_invalid"), revenuecat_auth),
    (
        Case("wrong-content-type", 415, "request.unsupported_media_type"),
        edit(**{"Content-Type": "text/plain"}),
    ),
    (Case("oversized-body", 413, "request.body_too_large"), oversized),
    (Case("malformed-json", 400, "webhook.payload_invalid"), malformed),
    (Case("too-many-recipients", 400, "webhook.payload_invalid"), too_many_recipients),
]


@pytest.mark.parametrize(("case", "build"), CASES, ids=[case.name for case, _ in CASES])
async def test_resend_rejections(
    case: Case,
    build: Builder,
    client: httpx.AsyncClient,
    webhook_services: Services,
    clock: FixedClock,
) -> None:
    body, headers = build(encode(resend_event("email.bounced", ADDRESS)), clock)
    response = await client.post(URL, content=body, headers=headers)
    assert response.status_code == case.status
    assert response.json()["code"] == case.code
    assert await rows(webhook_services) == (0, 0)


async def test_not_configured_accepts_nothing(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    webhook_services.settings = webhook_services.settings.model_copy(
        update={"resend_webhook_secret": None}
    )
    body = encode(resend_event("email.bounced", ADDRESS))
    response = await client.post(URL, content=body, headers=svix_headers(body, clock))
    assert response.status_code == 503
    assert await rows(webhook_services) == (0, 0)


@pytest.mark.parametrize("offset", [-299, 0, 299])
async def test_timestamp_inside_tolerance_is_accepted(
    offset: int, client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    body = encode(resend_event("email.bounced", ADDRESS))
    response = await client.post(
        URL, content=body, headers=svix_headers(body, clock, offset=offset)
    )
    assert response.status_code == 200


async def test_rotated_secret_list_accepts_any_valid_signature(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    body = encode(resend_event("email.bounced", ADDRESS))
    headers = svix_headers(body, clock)
    stale = svix_signature(bytes(32), headers["svix-id"], headers["svix-timestamp"], body)
    headers["svix-signature"] = "v1," + stale + " " + headers["svix-signature"]
    assert (await client.post(URL, content=body, headers=headers)).status_code == 200


async def test_bounce_suppresses_digest_only(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    body = encode(resend_event("email.bounced", ADDRESS, bounce="Permanent"))
    response = await client.post(URL, content=body, headers=svix_headers(body, clock))
    assert response.json() == {"status": "accepted"}
    # Normalized before hashing: the stored digest matches the lower-case address.
    assert await reason_of(webhook_services, "bounce.target@example.com") == "bounce"
    async with webhook_services.session_factory() as db:
        dump = await db.scalar(
            text(
                "SELECT string_agg(t::text, ' ') FROM ("
                " SELECT row_to_json(s)::text AS t FROM email_suppressions s"
                " UNION ALL SELECT row_to_json(w)::text FROM webhook_events w) rows"
            )
        )
        stored = await db.scalar(select(EmailSuppression.email_hash))
    assert dump is not None
    assert "example.com" not in dump.lower()
    assert "bounce.target" not in dump.lower()
    assert stored is not None
    assert len(stored) == 32


@pytest.mark.parametrize(
    ("event_type", "bounce", "expected"),
    [
        ("email.bounced", "Permanent", "bounce"),
        ("email.bounced", None, "bounce"),
        ("email.bounced", "Undetermined", "bounce"),
        ("email.bounced", "Transient", None),
        ("email.complained", None, "complaint"),
        ("email.delivered", None, None),
        ("email.sent", None, None),
        ("email.opened", None, None),
    ],
)
async def test_event_kinds(
    event_type: str,
    bounce: str | None,
    expected: str | None,
    client: httpx.AsyncClient,
    webhook_services: Services,
    clock: FixedClock,
) -> None:
    body = encode(resend_event(event_type, ADDRESS, bounce=bounce))
    assert (
        await client.post(URL, content=body, headers=svix_headers(body, clock))
    ).status_code == 200
    assert await reason_of(webhook_services, ADDRESS) == expected
    async with webhook_services.session_factory() as db:
        outcome = await db.scalar(select(WebhookEvent.outcome))
    assert outcome == ("applied" if expected else "ignored")


async def test_complaint_is_not_downgraded_by_a_later_bounce(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    for event_type in ("email.complained", "email.bounced"):
        body = encode(resend_event(event_type, ADDRESS))
        assert (
            await client.post(URL, content=body, headers=svix_headers(body, clock))
        ).status_code == 200
    assert await reason_of(webhook_services, ADDRESS) == "complaint"
    assert (await rows(webhook_services)) == (2, 1)


async def test_replayed_svix_id_has_no_second_effect(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    body = encode(resend_event("email.bounced", ADDRESS))
    headers = svix_headers(body, clock, message_id="msg_replayed")
    assert (await client.post(URL, content=body, headers=headers)).json() == {"status": "accepted"}
    replay = await client.post(URL, content=body, headers=headers)
    assert replay.json() == {"status": "duplicate"}
    # A new, validly signed body under the same id is still the same event.
    other = encode(resend_event("email.complained", "other@example.com"))
    resent = await client.post(
        URL, content=other, headers=svix_headers(other, clock, message_id="msg_replayed")
    )
    assert resent.json() == {"status": "duplicate"}
    assert await reason_of(webhook_services, "other@example.com") is None
    assert await rows(webhook_services) == (1, 1)


async def test_concurrent_delivery_has_one_effect(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    body = encode(resend_event("email.complained", ADDRESS))
    headers = svix_headers(body, clock, message_id="msg_concurrent")
    responses = await asyncio.gather(
        *[client.post(URL, content=body, headers=headers) for _ in range(8)]
    )
    assert (
        sorted(response.json()["status"] for response in responses)
        == ["accepted"] + ["duplicate"] * 7
    )
    assert await rows(webhook_services) == (1, 1)


async def test_same_id_in_both_providers_is_not_a_replay(
    client: httpx.AsyncClient,
    webhook_services: Services,
    clock: FixedClock,
    user: Account,
) -> None:
    body = encode(resend_event("email.bounced", ADDRESS))
    headers = svix_headers(body, clock, message_id="shared-id-1")
    assert (await client.post(URL, content=body, headers=headers)).json() == {"status": "accepted"}
    purchase = rc_event("INITIAL_PURCHASE", str(user.identity), clock.now(), event_id="shared-id-1")
    response = await client.post(
        "/v1/webhooks/revenuecat", content=encode(purchase), headers=rc_headers()
    )
    assert response.json() == {"status": "accepted"}
    assert (await rows(webhook_services))[0] == 2


async def test_signature_comparison_is_constant_time(
    client: httpx.AsyncClient,
    webhook_services: Services,
    clock: FixedClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[bytes] = []
    original = hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        calls.append(b)
        return original(a, b)

    monkeypatch.setattr(hmac, "compare_digest", spy)
    body = encode(resend_event("email.bounced", ADDRESS))
    headers = svix_headers(body, clock)
    assert (await client.post(URL, content=body, headers=headers)).status_code == 200
    expected = svix_signature(RESEND_KEY, headers["svix-id"], headers["svix-timestamp"], body)
    assert calls == [expected.encode()]


def test_published_svix_vector() -> None:
    """The example from the Svix documentation for manual verification."""
    key = base64.b64decode("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")
    body = b'{"test": 2432232314}'
    now = datetime.fromtimestamp(1614265330 + 10).astimezone()
    message = "msg_" + "p5jXN8AQM9LWM0D4loKWxJek"
    published = "v1," + "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
    assert verify_svix(key, message, "1614265330", published, body, now) == message
    from app.core.settings import svix_key

    # The endpoint secret is the `whsec_` prefix plus the base64 key above.
    assert svix_key(SecretStr("whsec_" + base64.b64encode(key).decode())) == key
