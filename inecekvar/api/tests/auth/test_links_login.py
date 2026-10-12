import hashlib

import httpx
import pytest
from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.mail import account_exists_mail
from app.auth.schemas import CookieOut
from app.core.deps import Services
from app.core.settings import Settings
from app.models.accounts import MagicLink, User
from tests.auth.conftest import (
    EMAIL,
    PASSWORD,
    auth_app,
    create_user,
    login_user,
    mailed_token,
    register_user,
)
from tests.support.app import FixedClock, RecordingMailSender

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def failed_login(client: httpx.AsyncClient, email: str = EMAIL) -> httpx.Response:
    return await client.post(
        "/v1/auth/login", json={"email": email, "password": "incorrect-password", "mode": "bearer"}
    )


async def test_login_sixth_attempt_is_rate_limited(client: httpx.AsyncClient) -> None:
    for _ in range(5):
        assert (await failed_login(client)).status_code == 401
    response = await failed_login(client)
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["Retry-After"]) > 0


async def test_login_rate_limit_is_per_email_across_ips(services: Services) -> None:
    application = auth_app(services)
    for index in range(6):
        transport = httpx.ASGITransport(
            app=application, client=("203.0.113." + str(index + 1), 50000)
        )
        async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
            response = await failed_login(client, "Traveller@EXAMPLE.com")
            assert response.status_code == (401 if index < 5 else 429)
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["Retry-After"]) > 0


async def test_register_rate_limited_per_ip(client: httpx.AsyncClient) -> None:
    for index in range(6):
        response = await client.post(
            "/v1/auth/register",
            json={
                "email": "person" + str(index) + "@example.com",
                "password": PASSWORD,
                "mode": "bearer",
            },
        )
        assert response.status_code == (202 if index < 5 else 429)
    assert response.json()["code"] == "rate_limited"


async def test_register_does_not_reveal_existing_accounts(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
) -> None:
    await create_user(session_factory, settings, clock)
    responses = []
    for email in ("new@example.com", EMAIL):
        responses.append(
            await client.post(
                "/v1/auth/register", json={"email": email, "password": PASSWORD, "mode": "cookie"}
            )
        )
    first, second = responses
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json() == {"status": "check_email"}
    assert set(first.headers) == set(second.headers)
    assert mail.sent[-1] == account_exists_mail(EMAIL, mailed_token(mail), settings)
    async with session_factory() as db:
        link = await db.scalar(select(MagicLink).where(MagicLink.email == EMAIL))
        assert link is not None
        assert link.purpose == "login"
        assert link.password_hash is None


@pytest.mark.parametrize(
    ("password", "email"),
    [("123456789", EMAIL), ("password1234", EMAIL), ("longlocalpart", "longlocalpart@example.com")],
)
async def test_register_rejects_weak_passwords(
    client: httpx.AsyncClient, password: str, email: str
) -> None:
    response = await client.post(
        "/v1/auth/register", json={"email": email, "password": password, "mode": "bearer"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "auth.weak_password"


async def test_register_then_verify_creates_verified_user(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    clock: FixedClock,
) -> None:
    response = await client.post(
        "/v1/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "display_name": "Traveller", "mode": "cookie"},
    )
    assert response.status_code == 202
    async with session_factory() as db:
        assert await db.scalar(select(User).where(User.email == EMAIL)) is None
    response = await client.post(
        "/v1/auth/magic-link/verify",
        json={"token": mailed_token(mail), "mode": "cookie", "password": PASSWORD},
    )
    result = CookieOut.model_validate(response.json())
    assert result.user.email_verified
    assert result.user.display_name is None
    async with session_factory() as db:
        user = await db.get(User, result.user.id)
        assert user is not None
        assert user.email_verified_at == clock.now()
        assert user.password_hash is not None
        assert user.password_hash.startswith("$argon2id$")


async def test_magic_link_single_use(client: httpx.AsyncClient, mail: RecordingMailSender) -> None:
    await register_user(client, mail)
    response = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": "bearer"}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "auth.token_invalid"


async def test_magic_link_expires_after_15_minutes(
    client: httpx.AsyncClient, mail: RecordingMailSender, clock: FixedClock
) -> None:
    await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    clock.advance(minutes=15, seconds=1)
    response = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": "bearer"}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "auth.token_invalid"


async def test_magic_link_stored_as_sha256(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    raw = mailed_token(mail)
    async with session_factory() as db:
        link = await db.scalar(select(MagicLink))
        assert link is not None
        assert len(link.token_hash) == 32
        assert link.token_hash == hashlib.sha256(raw.encode()).digest()
        assert link.token_hash != raw.encode()


async def test_magic_link_unknown_email_same_response(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
) -> None:
    await create_user(session_factory, settings, clock)
    known = await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    unknown = await client.post("/v1/auth/magic-link", json={"email": "new@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert set(known.headers) == set(unknown.headers)


async def test_login_uniform_error_for_unknown_and_wrong_password(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
) -> None:
    await create_user(session_factory, settings, clock)
    await create_user(
        session_factory, settings, clock, email="nopassword@example.com", password=None
    )
    responses = [
        await failed_login(client, email)
        for email in (EMAIL, "unknown@example.com", "nopassword@example.com")
    ]

    def without_request_id(response: httpx.Response) -> dict[str, object]:
        body = dict(response.json())
        assert body.pop("request_id")
        return body

    for response in responses:
        assert response.status_code == 401
        assert without_request_id(response) == without_request_id(responses[0])
        assert response.json()["code"] == "auth.invalid_credentials"


async def test_login_rehashes_outdated_hash(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
) -> None:
    user = await create_user(session_factory, settings, clock)
    async with session_factory() as db:
        stored = await db.get(User, user.id)
        assert stored is not None
        stored.password_hash = PasswordHasher(time_cost=1, memory_cost=65536, parallelism=1).hash(
            PASSWORD
        )
        await db.commit()
    await login_user(client)
    async with session_factory() as db:
        stored = await db.get(User, user.id)
        assert stored is not None
        assert stored.password_hash is not None
        assert "$m=65536,t=3,p=1$" in stored.password_hash
