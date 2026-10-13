"""The mailer consults the suppression list (spec section 6.17 b, ADR-0050 item 12): a manual
entry suppresses everything; a hard bounce suppresses everything, security mail only for 30
days and then rate limited per address; a complaint suppresses all but the security mail the
recipient asked for. Suppressed and delivered mail take the same path up to the hand-over."""

import re
from datetime import timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.auth.mail import SmtpMailSender, magic_link_mail
from app.auth.suppression import (
    SECURITY_AFTER_BOUNCE,
    MailDecision,
    SuppressionAwareMailSender,
    mail_decision,
    suppress,
)
from app.core.deps import MailCategory, OutgoingMail, Services
from app.core.errors import ProblemError
from app.main import build_services
from app.models.enums import SuppressionReason
from app.workers.deletion import hard_delete_due
from tests.support.app import FixedClock, RecordingMailSender, make_test_settings
from tests.support.domain import PASSWORD, create_account, sign_in
from tests.webhooks.conftest import encode, resend_event, svix_headers

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

DAY = timedelta(days=1)
MATRIX: list[tuple[str | None, MailCategory, timedelta, MailDecision]] = [
    (None, "security", DAY, MailDecision.SEND),
    (None, "transactional", DAY, MailDecision.SEND),
    ("bounce", "security", DAY, MailDecision.BLOCK),
    ("bounce", "security", SECURITY_AFTER_BOUNCE - DAY, MailDecision.BLOCK),
    ("bounce", "security", SECURITY_AFTER_BOUNCE, MailDecision.LIMITED),
    ("bounce", "transactional", SECURITY_AFTER_BOUNCE * 6, MailDecision.BLOCK),
    ("complaint", "security", DAY, MailDecision.SEND),
    ("complaint", "transactional", DAY, MailDecision.BLOCK),
    ("manual", "security", SECURITY_AFTER_BOUNCE * 6, MailDecision.BLOCK),
    ("manual", "transactional", DAY, MailDecision.BLOCK),
]


def suppression_aware(services: Services, clock: FixedClock) -> tuple[Any, RecordingMailSender]:
    inner = RecordingMailSender()
    sender = SuppressionAwareMailSender(
        inner,
        services.session_factory,
        services.settings,
        rate_limiter=services.rate_limiter,
        clock=clock,
    )
    return sender, inner


async def add(services: Services, address: str, reason: str, clock: FixedClock) -> None:
    async with services.session_factory() as db:
        await suppress(db, services.settings, [address], SuppressionReason(reason), clock.now())
        await db.commit()


@pytest.mark.parametrize(
    ("reason", "category", "age", "decision"),
    MATRIX,
    ids=[f"{reason}-{category}-{age.days}d" for reason, category, age, _ in MATRIX],
)
async def test_suppression_matrix(
    reason: str | None,
    category: MailCategory,
    age: timedelta,
    decision: MailDecision,
    webhook_services: Services,
    clock: FixedClock,
) -> None:
    suppressed_at = clock.now()
    assert mail_decision(reason, category, suppressed_at, suppressed_at + age) == decision
    sender, inner = suppression_aware(webhook_services, clock)
    if reason is not None:
        await add(webhook_services, "Someone@Example.com", reason, clock)
    clock.advance(seconds=age.total_seconds())
    await sender.send(OutgoingMail("someone@example.com", "Konu", "Metin", category))
    await sender.send(OutgoingMail("other@example.com", "Konu", "Metin", category))
    delivered = decision != MailDecision.BLOCK
    assert [mail.to for mail in inner.sent] == (
        ["someone@example.com", "other@example.com"] if delivered else ["other@example.com"]
    )
    # A suppressed message takes the same path up to the hand-over (ADR-0050 item 17).
    assert [mail.to for mail in inner.discarded] == ([] if delivered else ["someone@example.com"])


async def test_security_mail_after_an_old_bounce_is_rate_limited_per_address(
    webhook_services: Services, clock: FixedClock
) -> None:
    sender, inner = suppression_aware(webhook_services, clock)
    await add(webhook_services, "someone@example.com", "bounce", clock)
    clock.advance(days=31)
    for _ in range(4):
        await sender.send(OutgoingMail("Someone@Example.com", "Konu", "Metin", "security"))
    await sender.send(OutgoingMail("someone@example.com", "Konu", "Metin", "transactional"))
    assert (len(inner.sent), len(inner.discarded)) == (3, 2)
    clock.advance(days=1, seconds=1)
    await sender.send(OutgoingMail("someone@example.com", "Konu", "Metin", "security"))
    assert len(inner.sent) == 4


async def test_bounce_webhook_stops_magic_links_without_an_oracle(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    sender, inner = suppression_aware(webhook_services, clock)
    webhook_services.mail_sender = sender
    _, email = await create_account(webhook_services)
    first = await client.post("/v1/auth/magic-link", json={"email": email})
    assert first.status_code == 202
    assert len(inner.sent) == 1
    assert inner.sent[0].category == "security"
    body = encode(resend_event("email.bounced", email.upper(), bounce="Permanent"))
    bounced = await client.post(
        "/v1/webhooks/resend", content=body, headers=svix_headers(body, clock)
    )
    assert bounced.status_code == 200
    second = await client.post("/v1/auth/magic-link", json={"email": email})
    # Same answer as for any address; nothing goes to the bounced mailbox.
    assert (second.status_code, second.content) == (first.status_code, first.content)
    assert (len(inner.sent), len(inner.discarded)) == (1, 1)
    # A month later the sign-in link is tried again: one bounce does not lock the account out.
    clock.advance(days=30)
    assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
    assert len(inner.sent) == 2


async def test_complaint_keeps_sign_in_links_but_stops_other_mail(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    sender, inner = suppression_aware(webhook_services, clock)
    webhook_services.mail_sender = sender
    _, email = await create_account(webhook_services)
    body = encode(resend_event("email.complained", email))
    assert (
        await client.post("/v1/webhooks/resend", content=body, headers=svix_headers(body, clock))
    ).status_code == 200
    assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
    assert len(inner.sent) == 1
    assert re.search(r"#token=", inner.sent[0].text)
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=await sign_in(client, email)
    )
    assert response.status_code == 202
    clock.advance(days=7)
    summary = await hard_delete_due(
        webhook_services.session_factory,
        None,
        webhook_services.settings,
        clock,
        webhook_services.mail_sender,
        None,
    )
    assert summary == {"deleted": 1, "deferred": 0}
    # The deletion confirmation is transactional mail: suppressed after the complaint.
    assert len(inner.sent) == 1


def test_production_composition_wraps_the_smtp_sender() -> None:
    services = build_services(make_test_settings())
    assert isinstance(services.mail_sender, SuppressionAwareMailSender)
    assert isinstance(services.mail_sender.inner, SmtpMailSender)
    assert services.mail_sender.rate_limiter is services.rate_limiter


class FakeSmtp:
    """Records the SMTP session `discard` opens; `fail` makes the connection fail."""

    instances: list["FakeSmtp"] = []  # noqa: RUF012 (per-test registry, reset by the test)
    fail = False

    def __init__(self, **options: object) -> None:
        self.options = options
        self.calls: list[str] = []
        self.is_connected = False
        FakeSmtp.instances.append(self)

    async def connect(self) -> None:
        self.calls.append("connect")
        if FakeSmtp.fail:
            raise OSError("connection refused")
        self.is_connected = True

    async def quit(self) -> None:
        self.calls.append("quit")
        self.is_connected = False

    def close(self) -> None:
        self.calls.append("close")
        self.is_connected = False


@pytest.mark.parametrize("fail", [False, True])
async def test_smtp_discard_opens_the_same_session_and_fails_like_send(
    fail: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = make_test_settings(
        smtp_username="mailer", smtp_password=SecretStr("smtp-test-password-value")
    )
    sent: list[dict[str, object]] = []

    async def record(message: object, **options: object) -> None:
        if fail:
            raise OSError("connection refused")
        sent.append(options)

    FakeSmtp.instances = []
    FakeSmtp.fail = fail
    monkeypatch.setattr("app.auth.mail.aiosmtplib.SMTP", FakeSmtp)
    monkeypatch.setattr("app.auth.mail.aiosmtplib.send", record)
    mail = magic_link_mail("someone@example.com", "example-link-token-1234567890", settings)
    sender = SmtpMailSender(settings)
    outcomes: list[int | None] = []
    for action in (sender.send, sender.discard):
        try:
            await action(mail)
            outcomes.append(None)
        except ProblemError as error:
            outcomes.append(error.status)
    # Both paths fail or succeed together, so neither answers differently for an address.
    assert outcomes == ([503, 503] if fail else [None, None])
    (session,) = FakeSmtp.instances
    assert session.calls == (["connect"] if fail else ["connect", "quit"])
    shared = ("hostname", "port", "use_tls", "start_tls", "username", "password")
    expected = {
        "hostname": settings.smtp_host,
        "port": settings.smtp_port,
        "use_tls": False,
        "start_tls": settings.smtp_use_tls,
        "username": "mailer",
        "password": "smtp-test-password-value",
    }
    assert {key: session.options[key] for key in shared} == expected
    if not fail:
        assert {key: sent[0][key] for key in shared} == expected
