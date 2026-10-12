import io
import uuid
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pyotp
import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import select

from app.auth.schemas import (
    BearerOut,
    CookieOut,
    RefreshOut,
    StepUpOut,
    TotpEnrolOut,
    TotpStatusOut,
)
from app.auth.step_up import SessionStepUpSource, record_step_up
from app.auth.tokens import decode_access_token
from app.auth.totp import decrypt_secret, matching_counter
from app.core.deps import Principal, Services
from app.core.errors import (
    REAUTH_REQUIRED,
    STEP_UP_REQUIRED,
    TOTP_ALREADY_ENABLED,
    TOTP_ENROLMENT_REQUIRED,
    TOTP_INVALID_CODE,
    TOTP_NOT_PENDING,
    TOTP_UNAVAILABLE,
    VALIDATION_FAILED,
)
from app.models import AuditLog, SessionStepUp, User, UserSession
from app.models.enums import UserRole
from app.security.deps import step_up_context
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import PASSWORD, create_account, domain_app, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


@dataclass(frozen=True)
class Enrolled:
    identity: uuid.UUID
    email: str
    secret: str
    headers: dict[str, str]
    family_id: uuid.UUID
    refresh_token: str


def problem(response: httpx.Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["code"] == code


def wrong_code(secret: str, clock: FixedClock) -> str:
    for candidate in range(1000000):
        code = f"{candidate:06d}"
        if matching_counter(secret, code, clock.now(), None) is None:
            return code
    raise AssertionError("no invalid code found")


async def enrol(client: httpx.AsyncClient, headers: dict[str, str]) -> TotpEnrolOut:
    response = await client.post("/v1/me/totp/enrol", headers=headers, json={})
    assert response.status_code == 201, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return TotpEnrolOut.model_validate(response.json())


async def verify(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    secret: str,
    clock: FixedClock,
    path: str = "/v1/auth/step-up",
) -> httpx.Response:
    return await client.post(
        path, headers=headers, json={"code": pyotp.TOTP(secret).at(clock.now())}
    )


async def enrolled_account(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> Enrolled:
    identity, email = await create_account(services, UserRole.MODERATOR)
    response = await client.post(
        "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "bearer"}
    )
    assert response.status_code == 200
    login = BearerOut.model_validate(response.json())
    headers = {"Authorization": "Bearer " + login.access_token}
    output = await enrol(client, headers)
    confirmed = await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
    assert confirmed.status_code == 200
    family_id = decode_access_token(login.access_token, services.settings, clock.now()).family_id
    clock.advance(seconds=30)
    return Enrolled(identity, email, output.secret, headers, family_id, login.refresh_token)


async def rollback(
    client: httpx.AsyncClient, headers: dict[str, str], sample: Sample
) -> httpx.Response:
    return await client.post(
        f"/v1/moderation/lines/{sample.line_id}/rollback",
        headers=headers,
        json={"version_no": 1},
    )


async def test_enrol_encrypts_and_binds_secret(
    client: httpx.AsyncClient, services: Services, user: Account
) -> None:
    initial = await client.get("/v1/me/totp", headers=user.headers)
    assert initial.json() == {"enabled": False, "enabled_at": None, "pending": False}
    output = await enrol(client, user.headers)
    assert len(output.secret) == 32
    uri = urlparse(output.otpauth_uri)
    assert (uri.scheme, uri.netloc) == ("otpauth", "totp")
    query = parse_qs(uri.query)
    assert query["secret"] == [output.secret]
    assert query["issuer"] == ["İnecek Var"]
    async with services.session_factory() as db:
        stored = await db.get(User, user.identity)
        assert stored is not None
        assert stored.totp_secret_enc is not None
        assert output.secret.encode() not in stored.totp_secret_enc
        assert stored.totp_enabled_at is None
        assert stored.totp_last_counter is None
        key = services.settings.totp_key()
        assert decrypt_secret(key, stored.id, stored.totp_secret_enc) == output.secret
        with pytest.raises(InvalidTag):
            decrypt_secret(key, uuid.uuid4(), stored.totp_secret_enc)
    status = await client.get("/v1/me/totp", headers=user.headers)
    assert status.json() == {"enabled": False, "enabled_at": None, "pending": True}
    assert status.headers["Cache-Control"] == "no-store"
    assert output.secret not in status.text
    assert output.otpauth_uri not in status.text


async def test_enrol_requires_recent_login(
    client: httpx.AsyncClient, user: Account, clock: FixedClock
) -> None:
    clock.advance(minutes=11)
    problem(
        await client.post("/v1/me/totp/enrol", headers=user.headers, json={}), 403, REAUTH_REQUIRED
    )


async def test_confirm_wrong_then_right_and_already_enabled(
    client: httpx.AsyncClient, services: Services, user: Account, clock: FixedClock
) -> None:
    problem(
        await client.post("/v1/me/totp/confirm", headers=user.headers, json={"code": "000000"}),
        409,
        TOTP_NOT_PENDING,
    )
    output = await enrol(client, user.headers)
    problem(
        await client.post(
            "/v1/me/totp/confirm",
            headers=user.headers,
            json={"code": wrong_code(output.secret, clock)},
        ),
        403,
        TOTP_INVALID_CODE,
    )
    async with services.session_factory() as db:
        failure = await db.scalar(
            select(AuditLog).where(
                AuditLog.actor_id == user.identity, AuditLog.action == "totp.confirm_failed"
            )
        )
        assert failure is not None
    confirmed = await verify(client, user.headers, output.secret, clock, "/v1/me/totp/confirm")
    assert confirmed.status_code == 200
    status = TotpStatusOut.model_validate(confirmed.json())
    assert status.enabled
    assert status.enabled_at == clock.now()
    assert not status.pending
    problem(
        await client.post("/v1/me/totp/enrol", headers=user.headers, json={}),
        409,
        TOTP_ALREADY_ENABLED,
    )
    problem(
        await verify(client, user.headers, output.secret, clock, "/v1/me/totp/confirm"),
        409,
        TOTP_NOT_PENDING,
    )
    fetched = await client.get("/v1/me/totp", headers=user.headers)
    assert fetched.json() == confirmed.json()
    assert output.secret not in fetched.text
    async with services.session_factory() as db:
        stored = await db.get(User, user.identity)
        assert stored is not None
        assert stored.totp_enabled_at == clock.now()
        assert stored.totp_last_counter == int(clock.now().timestamp()) // 30
        assert await db.scalar(select(SessionStepUp.session_id)) is None


async def test_step_up_is_session_bound_rejects_replay_and_survives_refresh(
    client: httpx.AsyncClient, services: Services, sample: Sample, clock: FixedClock
) -> None:
    account = await enrolled_account(client, services, clock)
    problem(await rollback(client, account.headers, sample), 403, STEP_UP_REQUIRED)
    response = await verify(client, account.headers, account.secret, clock)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    result = StepUpOut.model_validate(response.json())
    assert result.verified_at == clock.now()
    assert result.expires_at == clock.now() + timedelta(minutes=15)
    async with services.session_factory() as db:
        row = await db.get(SessionStepUp, account.family_id)
        assert row is not None
        assert row.user_id == account.identity
        assert row.verified_at == clock.now()
    assert (await rollback(client, account.headers, sample)).status_code == 200
    problem(await verify(client, account.headers, account.secret, clock), 403, TOTP_INVALID_CODE)
    second = await sign_in(client, account.email)
    problem(await rollback(client, second, sample), 403, STEP_UP_REQUIRED)
    refreshed = await client.post("/v1/auth/refresh", json={"refresh_token": account.refresh_token})
    assert refreshed.status_code == 200
    tokens = RefreshOut.model_validate(refreshed.json())
    identity = decode_access_token(tokens.access_token, services.settings, clock.now())
    assert identity.family_id == account.family_id
    headers = {"Authorization": "Bearer " + tokens.access_token}
    assert (await rollback(client, headers, sample)).status_code == 200


async def test_expired_step_up_denied_with_live_bearer_family(
    client: httpx.AsyncClient, services: Services, sample: Sample, clock: FixedClock
) -> None:
    account = await enrolled_account(client, services, clock)
    assert (await verify(client, account.headers, account.secret, clock)).status_code == 200
    clock.advance(minutes=16)
    response = await client.post("/v1/auth/refresh", json={"refresh_token": account.refresh_token})
    assert response.status_code == 200
    headers = {"Authorization": "Bearer " + RefreshOut.model_validate(response.json()).access_token}
    problem(await rollback(client, headers, sample), 403, STEP_UP_REQUIRED)


async def test_moderator_without_totp_cannot_rollback_or_retire(
    client: httpx.AsyncClient, sample: Sample, contributor: Account, moderator: Account
) -> None:
    problem(await rollback(client, moderator.headers, sample), 403, TOTP_ENROLMENT_REQUIRED)
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={"kind": "retire", "line": str(sample.line_id), "reason": "Hat kapandı."},
    )
    assert response.status_code == 201
    identity = uuid.UUID(response.json()["id"])
    problem(
        await client.post(f"/v1/moderation/edits/{identity}/approve", headers=moderator.headers),
        403,
        TOTP_ENROLMENT_REQUIRED,
    )
    problem(
        await client.post("/v1/auth/step-up", headers=moderator.headers, json={"code": "000000"}),
        403,
        TOTP_ENROLMENT_REQUIRED,
    )
    problem(
        await client.delete("/v1/me/totp", headers=moderator.headers), 403, TOTP_ENROLMENT_REQUIRED
    )


async def test_cookie_step_up_checks_csrf_and_uses_cookie_session_id(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    identity, email = await create_account(services, UserRole.USER)
    response = await client.post(
        "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "cookie"}
    )
    assert response.status_code == 200
    headers = {"X-CSRF-Token": CookieOut.model_validate(response.json()).csrf_token}
    problem(await client.post("/v1/me/totp/enrol", json={}), 403, "csrf.invalid")
    output = await enrol(client, headers)
    assert (
        await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
    ).status_code == 200
    clock.advance(seconds=30)
    problem(await verify(client, {}, output.secret, clock), 403, "csrf.invalid")
    assert (await verify(client, headers, output.secret, clock)).status_code == 200
    async with services.session_factory() as db:
        row = await db.scalar(select(SessionStepUp).where(SessionStepUp.user_id == identity))
        assert row is not None
        session = await db.get(UserSession, row.session_id)
        assert session is not None
        assert session.user_id == identity
    assert (await client.delete("/v1/me/totp", headers=headers)).status_code == 204


@pytest.mark.parametrize("path", ["/v1/me/totp/confirm", "/v1/auth/step-up"])
async def test_rate_limit_per_user_across_ips(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, path: str
) -> None:
    identity, email = await create_account(services)
    headers = await sign_in(client, email)
    output = await enrol(client, headers)
    if path == "/v1/auth/step-up":
        assert (
            await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        clock.advance(minutes=16)
        headers = await sign_in(client, email)
    transport = httpx.ASGITransport(app=domain_app(services), client=("203.0.113.11", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as other:
        for index in range(5):
            connection = client if index % 2 == 0 else other
            problem(
                await connection.post(
                    path, headers=headers, json={"code": wrong_code(output.secret, clock)}
                ),
                403,
                TOTP_INVALID_CODE,
            )
        limited = await other.post(
            path, headers=headers, json={"code": wrong_code(output.secret, clock)}
        )
        problem(limited, 429, "rate_limited")
        assert int(limited.headers["Retry-After"]) > 0
    async with services.session_factory() as db:
        failures = list(await db.scalars(select(AuditLog).where(AuditLog.actor_id == identity)))
        action = "totp.confirm_failed" if path.endswith("confirm") else "auth.step_up_failed"
        assert sum(row.action == action for row in failures) == 5


@pytest.mark.parametrize("path", ["/v1/me/totp/confirm", "/v1/auth/step-up"])
async def test_rate_limit_per_ip_across_users(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, path: str
) -> None:
    accounts: list[tuple[str, str]] = []
    for _ in range(2):
        _, email = await create_account(services)
        headers = await sign_in(client, email)
        output = await enrol(client, headers)
        if path == "/v1/auth/step-up":
            assert (
                await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
            ).status_code == 200
        accounts.append((email, output.secret))
    if path == "/v1/auth/step-up":
        clock.advance(minutes=16)
    attempts = [(await sign_in(client, email), secret) for email, secret in accounts]
    for index in range(5):
        headers, secret = attempts[index % 2]
        problem(
            await client.post(path, headers=headers, json={"code": wrong_code(secret, clock)}),
            403,
            TOTP_INVALID_CODE,
        )
    headers, secret = attempts[1]
    limited = await client.post(path, headers=headers, json={"code": wrong_code(secret, clock)})
    problem(limited, 429, "rate_limited")
    assert int(limited.headers["Retry-After"]) > 0


@pytest.mark.parametrize("all_sessions", [False, True])
async def test_logout_revokes_step_ups(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, all_sessions: bool
) -> None:
    account = await enrolled_account(client, services, clock)
    assert (await verify(client, account.headers, account.secret, clock)).status_code == 200
    other_headers = await sign_in(client, account.email)
    clock.advance(seconds=30)
    assert (await verify(client, other_headers, account.secret, clock)).status_code == 200
    path = "/v1/auth/logout-all" if all_sessions else "/v1/auth/logout"
    assert (await client.post(path, headers=account.headers)).status_code == 204
    async with services.session_factory() as db:
        assert await db.get(SessionStepUp, account.family_id) is None
        rows = list(
            await db.scalars(select(SessionStepUp).where(SessionStepUp.user_id == account.identity))
        )
        assert len(rows) == (0 if all_sessions else 1)


async def test_disable_requires_step_up_clears_all_sessions_and_audits(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    account = await enrolled_account(client, services, clock)
    problem(await client.delete("/v1/me/totp", headers=account.headers), 403, STEP_UP_REQUIRED)
    problem(
        await client.post(
            "/v1/auth/step-up",
            headers=account.headers,
            json={"code": wrong_code(account.secret, clock)},
        ),
        403,
        TOTP_INVALID_CODE,
    )
    assert (await verify(client, account.headers, account.secret, clock)).status_code == 200
    other_headers = await sign_in(client, account.email)
    clock.advance(seconds=30)
    assert (await verify(client, other_headers, account.secret, clock)).status_code == 200
    response = await client.delete("/v1/me/totp", headers=account.headers)
    assert response.status_code == 204
    assert not response.content
    async with services.session_factory() as db:
        user = await db.get(User, account.identity)
        assert user is not None
        assert user.totp_secret_enc is None
        assert user.totp_enabled_at is None
        assert user.totp_last_counter is None
        assert (
            await db.scalar(
                select(SessionStepUp.session_id).where(SessionStepUp.user_id == user.id)
            )
            is None
        )
        actions = set(await db.scalars(select(AuditLog.action).where(AuditLog.actor_id == user.id)))
        assert {
            "totp.enrol",
            "totp.confirm",
            "auth.step_up",
            "auth.step_up_failed",
            "totp.disable",
        } <= actions
    assert (await client.get("/v1/me/totp", headers=account.headers)).json() == {
        "enabled": False,
        "enabled_at": None,
        "pending": False,
    }


async def test_logs_never_contain_totp_material(
    client: httpx.AsyncClient, user: Account, clock: FixedClock, log_stream: io.StringIO
) -> None:
    output = await enrol(client, user.headers)
    codes = [wrong_code(output.secret, clock), pyotp.TOTP(output.secret).at(clock.now())]
    for code in codes:
        await client.post("/v1/me/totp/confirm", headers=user.headers, json={"code": code})
    clock.advance(seconds=30)
    codes.append(pyotp.TOTP(output.secret).at(clock.now()))
    assert (await verify(client, user.headers, output.secret, clock)).status_code == 200
    captured = log_stream.getvalue()
    assert "http.request" in captured
    assert all(value not in captured for value in [output.secret, output.otpauth_uri, *codes])


@pytest.mark.parametrize("path", ["/v1/me/totp/confirm", "/v1/auth/step-up"])
@pytest.mark.parametrize(
    "body",
    [
        {"code": "\uff11\uff12\uff13\uff14\uff15\uff16"},
        {"code": "123456\n"},
        {"code": "123456", "secret": "x"},
    ],
)
async def test_validation_errors_use_auth_contract(
    client: httpx.AsyncClient, user: Account, path: str, body: dict[str, str]
) -> None:
    problem(await client.post(path, headers=user.headers, json=body), 422, VALIDATION_FAILED)


async def test_missing_encryption_key_fails_closed(
    client: httpx.AsyncClient, services: Services, user: Account
) -> None:
    services.settings = services.settings.model_copy(update={"totp_encryption_key": None})
    problem(
        await client.post("/v1/me/totp/enrol", headers=user.headers, json={}), 503, TOTP_UNAVAILABLE
    )
    async with services.session_factory() as db:
        stored = await db.get(User, user.identity)
        assert stored is not None
        assert stored.totp_secret_enc is None


async def test_step_up_storage_requires_both_session_and_user_and_updates_in_place(
    services: Services, clock: FixedClock
) -> None:
    identity, _ = await create_account(services, UserRole.ADMIN)
    other_id, _ = await create_account(services)
    session_id = uuid.uuid4()
    principal = Principal(identity, UserRole.ADMIN, session_id, "bearer")
    source = SessionStepUpSource()
    async with services.session_factory() as db:
        assert await source.step_up_at(db, principal) is None
        await record_step_up(db, principal, clock.now())
        await db.commit()
        created_at = clock.now()
        clock.advance(seconds=30)
        await record_step_up(db, principal, clock.now())
        await db.commit()
        row = await db.get(SessionStepUp, session_id)
        assert row is not None
        assert row.created_at == created_at
        assert row.updated_at == clock.now()
        assert await source.step_up_at(db, principal) == clock.now()
        other_session = Principal(identity, UserRole.ADMIN, uuid.uuid4(), "bearer")
        other_user = Principal(other_id, UserRole.USER, session_id, "bearer")
        assert await source.step_up_at(db, other_session) is None
        assert await source.step_up_at(db, other_user) is None
        context = await step_up_context(db, principal, services)
        assert not context.totp_enrolled
        assert context.step_up_at == clock.now()
        services.step_up = None
        context = await step_up_context(db, principal, services)
        assert context.step_up_at is None


async def test_reauthentication_uses_original_bearer_family_start_after_refresh(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    _, email = await create_account(services)
    response = await client.post(
        "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "bearer"}
    )
    assert response.status_code == 200
    login = BearerOut.model_validate(response.json())
    clock.advance(minutes=11)
    refreshed = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    assert refreshed.status_code == 200
    tokens = RefreshOut.model_validate(refreshed.json())
    headers = {"Authorization": "Bearer " + tokens.access_token}
    problem(await client.post("/v1/me/totp/enrol", headers=headers, json={}), 403, REAUTH_REQUIRED)
