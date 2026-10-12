import hashlib
from email.message import EmailMessage

import httpx
import pytest

from app.auth.hibp import HIBP_BASE_URL, HibpRangeClient
from app.auth.mail import SmtpMailSender, magic_link_mail
from app.core.settings import Settings
from tests.auth.conftest import EMAIL, PASSWORD
from tests.support.app import make_test_settings

pytestmark = pytest.mark.anyio


async def test_hibp_range_query_uses_prefix_only() -> None:
    digest = hashlib.sha1(PASSWORD.encode(), usedforsecurity=False).hexdigest().upper()
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path == "/range/" + digest[:5]
        assert request.headers["Add-Padding"] == "true"
        serialized = str(request.url) + str(request.headers) + request.content.decode()
        assert PASSWORD not in serialized
        assert digest not in serialized
        return httpx.Response(200, text=digest[5:] + ":12\r\n" + "0" * 35 + ":0\r\n")

    settings = make_test_settings(hibp_enabled=True)
    checker = HibpRangeClient(settings, httpx.MockTransport(respond))
    assert await checker.is_breached(PASSWORD)
    assert len(requests) == 1
    checker = HibpRangeClient(
        settings, httpx.MockTransport(lambda _: httpx.Response(200, text=digest[5:] + ":0"))
    )
    assert not await checker.is_breached(PASSWORD)


@pytest.mark.parametrize("failure", ["timeout", "transport", "status"])
async def test_hibp_failure_fails_open(failure: str) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if failure == "timeout":
            raise httpx.ReadTimeout("unavailable", request=request)
        if failure == "transport":
            raise httpx.ConnectError("unavailable", request=request)
        return httpx.Response(503)

    checker = HibpRangeClient(make_test_settings(hibp_enabled=True), httpx.MockTransport(respond))
    assert not await checker.is_breached(PASSWORD)


async def test_hibp_never_follows_redirects() -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(302, headers={"Location": "https://example.com/collect"})

    checker = HibpRangeClient(make_test_settings(hibp_enabled=True), httpx.MockTransport(respond))
    assert not await checker.is_breached(PASSWORD)
    assert len(requests) == 1
    assert str(requests[0].url).startswith(HIBP_BASE_URL + "/range/")


async def test_hibp_disabled_makes_no_request(settings: Settings) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        pytest.fail("disabled lookup contacted the network")

    checker = HibpRangeClient(settings, httpx.MockTransport(respond))
    assert not await checker.is_breached(PASSWORD)


async def test_smtp_mail_sender_builds_message(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    messages: list[EmailMessage] = []
    options: list[dict[str, object]] = []

    async def record(message: EmailMessage, **kwargs: object) -> None:
        messages.append(message)
        options.append(kwargs)

    monkeypatch.setattr("app.auth.mail.aiosmtplib.send", record)
    mail = magic_link_mail(EMAIL, "example-link-token-1234567890", settings)
    await SmtpMailSender(settings).send(mail)
    assert len(messages) == 1
    assert messages[0]["From"] == settings.mail_from
    assert messages[0]["To"] == EMAIL
    assert messages[0]["Subject"] == mail.subject
    assert mail.text in str(messages[0].get_content())
    assert settings.magic_link_base_url in str(messages[0].get_content())
    assert options[0]["recipients"] == [EMAIL]
    assert options[0]["start_tls"] == settings.smtp_use_tls
    assert options[0]["use_tls"] is False
