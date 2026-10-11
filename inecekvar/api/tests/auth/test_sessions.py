from datetime import timedelta
from http.cookies import SimpleCookie

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.schemas import BearerOut, CookieOut
from app.core.deps import Services
from app.core.settings import Settings
from app.models.accounts import RefreshToken, User, UserSession
from tests.auth.conftest import (
    EMAIL,
    PASSWORD,
    auth_app,
    bearer_headers,
    cookie_headers,
    create_user,
    login_user,
    register_user,
)
from tests.support.app import FixedClock, RecordingMailSender

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_cookie_attributes(client: httpx.AsyncClient, mail: RecordingMailSender) -> None:
    response = await register_user(client, mail)
    parsed = SimpleCookie()
    parsed.load(response.headers["set-cookie"])
    cookie = parsed["__Host-iv_session"]
    assert cookie["httponly"]
    assert cookie["secure"]
    assert cookie["samesite"] == "Lax"
    assert "SameSite=Lax" in response.headers["set-cookie"]
    assert cookie["path"] == "/"
    assert cookie["max-age"] == "604800"
    assert not cookie["domain"]
    assert "Domain=" not in response.headers["set-cookie"]
    assert response.headers["cache-control"] == "no-store"


async def test_bearer_mode_sets_no_cookie(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    response = await register_user(client, mail, mode="bearer")
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"
    assert BearerOut.model_validate(response.json()).expires_in == 900


async def test_cookie_mutation_without_csrf_is_403(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    login = await register_user(client, mail)
    for headers in ({}, {"X-CSRF-Token": "incorrect"}):
        response = await client.patch("/v1/me", json={"display_name": "Name"}, headers=headers)
        assert response.status_code == 403
        assert response.json()["code"] == "csrf.invalid"
    response = await client.patch(
        "/v1/me", json={"display_name": "Name"}, headers=cookie_headers(login)
    )
    assert response.status_code == 200


async def test_csrf_token_is_bound_to_session(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    first = await register_user(client, mail)
    second = await login_user(client)
    assert (
        CookieOut.model_validate(first.json()).csrf_token
        != CookieOut.model_validate(second.json()).csrf_token
    )
    response = await client.patch(
        "/v1/me", json={"display_name": "Name"}, headers=cookie_headers(first)
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf.invalid"


async def test_csrf_endpoint_requires_cookie_session(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    assert (await client.post("/v1/auth/csrf")).status_code == 401
    bearer = await register_user(client, mail, mode="bearer")
    response = await client.post("/v1/auth/csrf", headers=bearer_headers(bearer))
    assert response.status_code == 401
    assert response.json()["code"] == "auth.required"
    cookie = await login_user(client)
    response = await client.post("/v1/auth/csrf")
    assert response.status_code == 200
    assert response.json()["csrf_token"] == CookieOut.model_validate(cookie.json()).csrf_token
    assert "Max-Age=604800" in response.headers["set-cookie"]


async def test_cookie_mode_refused_for_capacitor_origin(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    await register_user(client, mail)
    response = await client.get("/v1/me", headers={"Origin": "capacitor://localhost"})
    assert response.status_code == 403
    assert response.json()["code"] == "origin.not_allowed"
    response = await client.post(
        "/v1/auth/login",
        json={"email": EMAIL, "password": PASSWORD, "mode": "cookie"},
        headers={"Origin": "capacitor://localhost"},
    )
    assert response.status_code == 403
    bearer = await login_user(client, mode="bearer")
    response = await client.get(
        "/v1/me", headers={**bearer_headers(bearer), "Origin": "capacitor://localhost"}
    )
    assert response.status_code == 200


async def test_logout_revokes_session(
    client: httpx.AsyncClient, mail: RecordingMailSender, settings: Settings
) -> None:
    login = await register_user(client, mail)
    raw = client.cookies[settings.session_cookie_name]
    response = await client.post("/v1/auth/logout", headers=cookie_headers(login))
    assert response.status_code == 204
    assert not response.content
    assert "Max-Age=0" in response.headers["set-cookie"]
    client.cookies.set(settings.session_cookie_name, raw)
    assert (await client.get("/v1/me")).status_code == 401


async def test_logout_all_revokes_everything(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    settings: Settings,
    services: Services,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await register_user(client, mail)
    first = client.cookies[settings.session_cookie_name]
    second_login = await login_user(client)
    second = client.cookies[settings.session_cookie_name]
    bearer = await login_user(client, mode="bearer")
    response = await client.post("/v1/auth/logout-all", headers=cookie_headers(second_login))
    assert response.status_code == 204
    application = auth_app(services)
    for raw in (first, second):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application), base_url="https://testserver"
        ) as other:
            other.cookies.set(settings.session_cookie_name, raw)
            assert (await other.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers=bearer_headers(bearer))).status_code == 401
    result = BearerOut.model_validate(bearer.json())
    assert (
        await client.post("/v1/auth/refresh", json={"refresh_token": result.refresh_token})
    ).status_code == 401
    async with session_factory() as db:
        assert all(row.revoked_at is not None for row in await db.scalars(select(UserSession)))
        assert all(row.revoked_at is not None for row in await db.scalars(select(RefreshToken)))


async def test_deactivated_user_cannot_authenticate(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    clock: FixedClock,
) -> None:
    cookie = await register_user(client, mail)
    bearer = await login_user(client, mode="bearer")
    async with session_factory() as db:
        user = await db.get(User, CookieOut.model_validate(cookie.json()).user.id)
        assert user is not None
        user.deactivated_at = clock.now()
        await db.commit()
    assert (await client.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers=bearer_headers(bearer))).status_code == 401
    response = await client.post(
        "/v1/auth/login", json={"email": EMAIL, "password": PASSWORD, "mode": "bearer"}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "auth.invalid_credentials"
    before = len(mail.sent)
    assert (await client.post("/v1/auth/magic-link", json={"email": EMAIL})).status_code == 202
    assert len(mail.sent) == before


async def test_cookie_session_rolls_on_me_and_csrf(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    clock: FixedClock,
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    await register_user(client, mail)
    for path in ("/v1/me", "/v1/auth/csrf"):
        clock.advance(days=1)
        response = await client.get(path) if path == "/v1/me" else await client.post(path)
        assert response.status_code == 200
        assert "Max-Age=604800" in response.headers["set-cookie"]
        async with session_factory() as db:
            session = await db.scalar(select(UserSession))
            assert session is not None
            assert session.expires_at == clock.now() + timedelta(days=settings.session_ttl_days)


async def test_authorization_header_wins_over_cookie(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
) -> None:
    await register_user(client, mail)
    await create_user(session_factory, settings, clock, email="other@example.com")
    other = await login_user(client, email="other@example.com", mode="bearer")
    response = await client.get("/v1/me", headers=bearer_headers(other))
    assert response.json()["email"] == "other@example.com"
    response = await client.get("/v1/me", headers={"Authorization": "Basic invalid"})
    assert response.status_code == 401
