"""Storage and log scans (spec section 6 items 11 and 14, phase 6 package 6B).

`test_pg_dump_holds_no_plaintext_secret_or_raw_webhook_email` drives a whole account life
through the HTTP API (registration with the mailed link, cookie and bearer sign-in, refresh,
another magic link, TOTP enrolment and step-up, a RevenueCat event carrying an email attribute
and a Resend bounce for another address), then runs `pg_dump` of that test database and greps
the dump: no password, TOTP secret, session, refresh, access, CSRF or magic-link token, no
raw address from the webhooks, `$argon2id$` hashes only and `totp_secret_enc` as ciphertext.

`test_combined_session_log_has_no_email_token_coordinate_or_secret` runs sign-in, trace upload,
planning, both webhooks and account deletion with the production log configuration and greps
everything written to stdout.
"""

import base64
import io
import json
import re
import uuid
from collections.abc import Iterator
from typing import cast

import docker
import pyotp
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.auth.schemas import BearerOut, CookieOut, TotpEnrolOut
from app.auth.step_up import SessionStepUpSource
from app.auth.totp import stored_secret
from app.core.deps import Services
from app.models import User
from tests.auth.conftest import mailed_token
from tests.core.test_logging import log_stream
from tests.security.test_attack_suite import CITY, TRACE_POINTS, connect, sample, trace_body
from tests.support.app import FixedClock, RecordingMailSender, build_test_app
from tests.support.billing import rc_event
from tests.webhooks.conftest import (
    RC_SECRET,
    RESEND_SECRET,
    encode,
    rc_headers,
    resend_event,
    svix_headers,
)

__all__ = ["log_stream"]

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

# Built from parts so the dummy never reads as a literal credential.
PASSWORD = "-".join(("Dump", "Tarama", "Parolasi", "2026"))
WEB_ORIGIN = "https://app.inecekvar.app"
BOUNCED = "geri.donen." + uuid.uuid4().hex[:6] + "@example.com"
ATTRIBUTE_EMAIL = "rc.alici." + uuid.uuid4().hex[:6] + "@example.com"
POSTGIS_IMAGE = "postgis/postgis:16-3.5"
ARGON2_PREFIX = "$argon2id$v=19$m=65536,t=3,p=1$"
COORDINATE = re.compile(r"\d{1,3}\.\d{4,}")


def configure_webhooks(services: Services) -> None:
    services.settings = services.settings.model_copy(
        update={
            "revenuecat_webhook_secret": SecretStr(RC_SECRET),
            "resend_webhook_secret": SecretStr(RESEND_SECRET),
        }
    )
    services.step_up = SessionStepUpSource()


def pg_dump(url: str) -> str:
    """Plain-format `pg_dump` of the test database, run with the server's own client.

    Under Testcontainers the dump runs inside the PostGIS container that publishes the port;
    with INECEKVAR_TEST_DATABASE_URL (a CI service) a throwaway PostGIS container on the host
    network runs it against the URL.
    """
    target = make_url(url)
    engine = docker.from_env()
    for container in engine.containers.list():
        ports = container.attrs["NetworkSettings"]["Ports"] or {}
        bindings = ports.get("5432/tcp") or []
        if any(binding.get("HostPort") == str(target.port) for binding in bindings):
            exit_code, output = container.exec_run(
                ["pg_dump", "--no-owner", "-U", str(target.username), "-d", str(target.database)],
                environment={"PGPASSWORD": str(target.password)},
            )
            text = cast(bytes, output).decode("utf-8")
            assert exit_code == 0, text[-400:]
            return text
    plain = target.set(drivername="postgresql").render_as_string(hide_password=False)
    output = engine.containers.run(
        POSTGIS_IMAGE, ["pg_dump", "--no-owner", plain], network_mode="host", remove=True
    )
    return output.decode("utf-8")


def copy_blocks(dump: str) -> Iterator[tuple[str, str]]:
    """(table, rows) for every `COPY public.<table>` block of a plain dump."""
    pattern = r"^COPY public\.(\w+) .*? FROM stdin;\n(.*?)^\\\.$"
    for match in re.finditer(pattern, dump, re.M | re.S):
        yield match.group(1), match.group(2)


async def test_pg_dump_holds_no_plaintext_secret_or_raw_webhook_email(
    services: Services, clock: FixedClock, migrated_url: str
) -> None:
    configure_webhooks(services)
    mail = cast(RecordingMailSender, services.mail_sender)
    email = "dokum." + uuid.uuid4().hex[:6] + "@example.com"
    application = build_test_app(services)
    secrets: dict[str, str] = {"password": PASSWORD}
    async with connect(application, headers={"Origin": WEB_ORIGIN}) as client:
        registered = await client.post(
            "/v1/auth/register", json={"email": email, "password": PASSWORD, "mode": "cookie"}
        )
        assert registered.status_code == 202
        secrets["registration link"] = mailed_token(mail)
        verified = await client.post(
            "/v1/auth/magic-link/verify",
            json={"token": secrets["registration link"], "mode": "cookie", "password": PASSWORD},
        )
        assert verified.status_code == 200, verified.text
        secrets["csrf"] = CookieOut.model_validate(verified.json()).csrf_token
        secrets["session cookie"] = client.cookies[services.settings.session_cookie_name]
        signed_in = await client.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "bearer"}
        )
        bearer = BearerOut.model_validate(signed_in.json())
        secrets["first refresh"] = bearer.refresh_token
        secrets["first access"] = bearer.access_token
        refreshed = await client.post(
            "/v1/auth/refresh", json={"refresh_token": bearer.refresh_token}
        )
        assert refreshed.status_code == 200
        secrets["second refresh"] = refreshed.json()["refresh_token"]
        access = refreshed.json()["access_token"]
        secrets["second access"] = access
        headers = {"Authorization": "Bearer " + access}
        assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
        secrets["login link"] = mailed_token(mail)
        enrolled = TotpEnrolOut.model_validate(
            (await client.post("/v1/me/totp/enrol", headers=headers, json={})).json()
        )
        secrets["totp secret"] = enrolled.secret
        totp = pyotp.TOTP(enrolled.secret)
        confirmed = await client.post(
            "/v1/me/totp/confirm", headers=headers, json={"code": totp.at(clock.now())}
        )
        assert confirmed.status_code == 200
        clock.advance(seconds=30)
        stepped = await client.post(
            "/v1/auth/step-up", headers=headers, json={"code": totp.at(clock.now())}
        )
        assert stepped.status_code == 200
        async with services.session_factory() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None
            identity = user.id
        event = rc_event(
            "INITIAL_PURCHASE",
            str(identity),
            clock.now(),
            subscriber_attributes={"$email": {"value": ATTRIBUTE_EMAIL, "updated_at_ms": 1}},
        )
        purchase = await client.post(
            "/v1/webhooks/revenuecat", content=encode(event), headers=rc_headers()
        )
        assert purchase.status_code == 200
        body = encode(resend_event("email.bounced", BOUNCED, bounce="Permanent"))
        bounce = await client.post(
            "/v1/webhooks/resend", content=body, headers=svix_headers(body, clock)
        )
        assert bounce.status_code == 200
    dump = pg_dump(migrated_url)
    assert "COPY public.users" in dump
    for name, value in secrets.items():
        assert value not in dump, name
    padding = "=" * (-len(secrets["totp secret"]) % 8)
    raw_secret = base64.b32decode(secrets["totp secret"] + padding)
    assert raw_secret.hex() not in dump
    for address in (BOUNCED, ATTRIBUTE_EMAIL):
        assert address not in dump
        assert address.split("@")[0] not in dump
    tables_with_email = {table for table, rows in copy_blocks(dump) if email in rows}
    assert tables_with_email <= {"users", "magic_links"}
    data = "\n".join(rows for _, rows in copy_blocks(dump))
    hashes = re.findall(r"\$argon2[a-z]*\$[^\t\n]*", data)
    assert hashes
    assert [value for value in hashes if not value.startswith(ARGON2_PREFIX)] == []
    async with services.session_factory() as db:
        stored = await db.get(User, identity)
        assert stored is not None
        assert stored.totp_secret_enc is not None
        ciphertext = bytes(stored.totp_secret_enc)
        assert secrets["totp secret"].encode() not in ciphertext
        assert raw_secret not in ciphertext
        assert len(ciphertext) >= len(secrets["totp secret"]) + 16 + 12
        assert stored_secret(services.settings, stored.id, ciphertext) == secrets["totp secret"]


async def test_combined_session_log_has_no_email_token_coordinate_or_secret(
    services: Services, clock: FixedClock, log_stream: io.StringIO
) -> None:
    configure_webhooks(services)
    await sample(services)
    mail = cast(RecordingMailSender, services.mail_sender)
    email = "gunluk." + uuid.uuid4().hex[:6] + "@example.com"
    application = build_test_app(services)
    secrets: list[str] = [PASSWORD, RC_SECRET, RESEND_SECRET]
    async with connect(
        application, headers={"Origin": WEB_ORIGIN, "X-Request-ID": "log-scan-6b-0001"}
    ) as client:
        registered = await client.post(
            "/v1/auth/register", json={"email": email, "password": PASSWORD, "mode": "bearer"}
        )
        assert registered.status_code == 202
        link = mailed_token(mail)
        secrets.append(link)
        verified = await client.post(
            "/v1/auth/magic-link/verify",
            json={"token": link, "mode": "bearer", "password": PASSWORD},
        )
        assert verified.status_code == 200
        bearer = BearerOut.model_validate(verified.json())
        secrets.extend([bearer.access_token, bearer.refresh_token])
        headers = {"Authorization": "Bearer " + bearer.access_token}
        accepted = await client.post("/v1/me/licence-accept", headers=headers, json={})
        assert accepted.status_code == 200
        cookie = await client.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "cookie"}
        )
        assert cookie.status_code == 200
        secrets.append(cookie.json()["csrf_token"])
        secrets.extend(client.cookies.values())
        failed = await client.post(
            "/v1/auth/login",
            json={"email": email, "password": "Yanlis-" + PASSWORD, "mode": "bearer"},
        )
        assert failed.status_code == 401
        trace = await client.post("/v1/traces", headers=headers, json=trace_body(TRACE_POINTS))
        assert trace.status_code == 201, trace.text
        plan = await client.post(
            "/v1/plan",
            json={
                "city": CITY,
                "from": {"lat": 42.5134567, "lng": 34.0134567},
                "to": {"lat": 42.5654321, "lng": 34.0854321},
            },
        )
        assert plan.status_code == 200
        async with services.session_factory() as db:
            identity = await db.scalar(select(User.id).where(User.email == email))
        event = rc_event(
            "INITIAL_PURCHASE",
            str(identity),
            clock.now(),
            subscriber_attributes={"$email": {"value": ATTRIBUTE_EMAIL, "updated_at_ms": 1}},
        )
        purchase = await client.post(
            "/v1/webhooks/revenuecat", content=encode(event), headers=rc_headers()
        )
        assert purchase.status_code == 200
        body = encode(resend_event("email.bounced", BOUNCED, bounce="Permanent"))
        signed = svix_headers(body, clock)
        secrets.append(signed["svix-signature"].removeprefix("v1,"))
        bounce = await client.post("/v1/webhooks/resend", content=body, headers=signed)
        assert bounce.status_code == 200
        deleted = await client.request(
            "DELETE", "/v1/me", headers=headers, json={"password": PASSWORD}
        )
        assert deleted.status_code == 202
    captured = log_stream.getvalue()
    lines = [json.loads(line) for line in captured.splitlines() if line.strip()]
    events = {line.get("event") for line in lines}
    assert {
        "http.request",
        "auth.login.failed",
        "plan",
        "webhook.received",
        "auth.account.delete_requested",
    } <= events
    assert "@" not in captured
    for value in secrets:
        assert value not in captured
    for address in (email, BOUNCED, ATTRIBUTE_EMAIL):
        assert address.split("@")[0] not in captured
    for point in TRACE_POINTS:
        assert str(point[0]) not in captured
        assert str(point[1]) not in captured
    precise = [
        (key, value)
        for line in lines
        for key, value in line.items()
        if key not in {"timestamp", "duration_ms"} and COORDINATE.search(str(value))
    ]
    assert precise == []
    requests = [line for line in lines if line.get("event") == "http.request"]
    assert len(requests) == 10
    assert all(line["request_id"] == "log-scan-6b-0001" for line in requests)
