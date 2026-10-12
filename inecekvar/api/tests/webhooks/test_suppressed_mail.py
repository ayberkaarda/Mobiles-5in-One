"""The mailer consults the suppression list (spec section 6.17 b, ADR-0050): bounce and manual
suppress everything, a complaint suppresses all but the security mail the recipient asked for."""

import re

import httpx
import pytest

from app.auth.suppression import SuppressionAwareMailSender, blocks, suppress
from app.core.deps import MailCategory, OutgoingMail, Services
from app.main import build_services
from app.models.enums import SuppressionReason
from app.workers.deletion import hard_delete_due
from tests.support.app import FixedClock, RecordingMailSender, make_test_settings
from tests.support.domain import PASSWORD, create_account, sign_in
from tests.webhooks.conftest import encode, resend_event, svix_headers

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

MATRIX: list[tuple[str | None, MailCategory, bool]] = [
    (None, "security", True),
    (None, "transactional", True),
    ("bounce", "security", False),
    ("bounce", "transactional", False),
    ("complaint", "security", True),
    ("complaint", "transactional", False),
    ("manual", "security", False),
    ("manual", "transactional", False),
]


@pytest.mark.parametrize(("reason", "category", "delivered"), MATRIX)
async def test_suppression_matrix(
    reason: str | None,
    category: MailCategory,
    delivered: bool,
    webhook_services: Services,
    clock: FixedClock,
) -> None:
    assert blocks(reason, category) is not delivered
    inner = RecordingMailSender()
    sender = SuppressionAwareMailSender(
        inner, webhook_services.session_factory, webhook_services.settings
    )
    if reason is not None:
        async with webhook_services.session_factory() as db:
            await suppress(
                db,
                webhook_services.settings,
                ["Someone@Example.com"],
                SuppressionReason(reason),
                clock.now(),
            )
            await db.commit()
    await sender.send(OutgoingMail("someone@example.com", "Konu", "Metin", category))
    await sender.send(OutgoingMail("other@example.com", "Konu", "Metin", category))
    assert [mail.to for mail in inner.sent] == (
        ["someone@example.com", "other@example.com"] if delivered else ["other@example.com"]
    )


async def test_bounce_webhook_stops_magic_links_without_an_oracle(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    inner = RecordingMailSender()
    webhook_services.mail_sender = SuppressionAwareMailSender(
        inner, webhook_services.session_factory, webhook_services.settings
    )
    _, email = await create_account(webhook_services)
    first = await client.post("/v1/auth/magic-link", json={"email": email})
    assert first.status_code == 202
    assert len(inner.sent) == 1
    assert inner.sent[0].category == "security"
    body = encode(resend_event("email.bounced", email.upper()))
    bounced = await client.post(
        "/v1/webhooks/resend", content=body, headers=svix_headers(body, clock)
    )
    assert bounced.status_code == 200
    second = await client.post("/v1/auth/magic-link", json={"email": email})
    # Same answer as for any address; nothing goes to the bounced mailbox.
    assert (second.status_code, second.content) == (first.status_code, first.content)
    assert len(inner.sent) == 1


async def test_complaint_keeps_sign_in_links_but_stops_other_mail(
    client: httpx.AsyncClient, webhook_services: Services, clock: FixedClock
) -> None:
    inner = RecordingMailSender()
    webhook_services.mail_sender = SuppressionAwareMailSender(
        inner, webhook_services.session_factory, webhook_services.settings
    )
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
