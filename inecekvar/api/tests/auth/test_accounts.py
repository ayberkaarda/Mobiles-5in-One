from datetime import timedelta

import asyncpg
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.schemas import BearerOut, CookieOut, MeOut
from app.core.settings import Settings
from app.models.accounts import DeletionRequest, Favorite, RefreshToken, User, UserSession
from app.models.contributions import Edit, Trace
from app.models.enums import UserRole
from app.models.ops import AuditLog
from tests.auth.conftest import (
    EMAIL,
    PASSWORD,
    bearer_headers,
    cookie_headers,
    create_user,
    login_user,
    mailed_token,
    register_user,
)
from tests.migrations.test_constraints import city, edit, line, trace
from tests.support.app import FixedClock, RecordingMailSender
from tests.support.database import asyncpg_dsn

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_me_get_and_patch(client: httpx.AsyncClient, mail: RecordingMailSender) -> None:
    login = await register_user(client, mail)
    response = await client.get("/v1/me")
    assert response.status_code == 200
    user = MeOut.model_validate(response.json())
    assert user.email == EMAIL
    assert user.email_verified
    assert not user.licence_accepted
    assert user.role == UserRole.USER
    assert user.reputation == 0
    response = await client.patch(
        "/v1/me", json={"display_name": "  Yolcu  "}, headers=cookie_headers(login)
    )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Yolcu"
    response = await client.patch(
        "/v1/me", json={"display_name": None}, headers=cookie_headers(login)
    )
    assert response.status_code == 200
    assert response.json()["display_name"] is None


async def test_patch_me_rejects_unknown_fields(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    login = await register_user(client, mail)
    response = await client.patch(
        "/v1/me",
        json={"display_name": "Name", "role": "admin"},
        headers=cookie_headers(login),
    )
    assert response.status_code == 422
    assert (await client.get("/v1/me")).json()["role"] == "user"


async def test_licence_accept_promotes_user_once(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    clock: FixedClock,
) -> None:
    login = await register_user(client, mail)
    user_id = CookieOut.model_validate(login.json()).user.id
    accepted = clock.now()
    for _ in range(2):
        response = await client.post(
            "/v1/me/licence-accept", json={}, headers=cookie_headers(login)
        )
        assert response.status_code == 200
        assert response.json()["role"] == "contributor"
        assert response.json()["licence_accepted"]
        clock.advance(minutes=1)
    async with session_factory() as db:
        user = await db.get(User, user_id)
        assert user is not None
        assert user.licence_accepted_at == accepted
        rows = list(await db.scalars(select(AuditLog).where(AuditLog.action == "licence.accept")))
        assert len(rows) == 1
        assert rows[0].actor_id == rows[0].target_id == user_id


@pytest.mark.parametrize("role", [UserRole.MODERATOR, UserRole.ADMIN])
async def test_licence_accept_preserves_privileged_roles(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
    role: UserRole,
) -> None:
    await create_user(session_factory, settings, clock, role=role)
    login = await login_user(client, mode="bearer")
    response = await client.post("/v1/me/licence-accept", json={}, headers=bearer_headers(login))
    assert response.status_code == 200
    assert response.json()["role"] == role.value


async def test_delete_me_requires_reauthentication(
    client: httpx.AsyncClient, mail: RecordingMailSender, clock: FixedClock
) -> None:
    login = await register_user(client, mail)
    for body in ({}, {"password": "incorrect"}):
        response = await client.request(
            "DELETE", "/v1/me", json=body, headers=cookie_headers(login)
        )
        assert response.status_code == 401
        assert response.json()["code"] == "auth.invalid_credentials"
    assert (await client.get("/v1/me")).status_code == 200
    await client.post("/v1/auth/magic-link", json={"email": "passwordless@example.com"})
    login = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": "bearer"}
    )
    clock.advance(minutes=10, seconds=1)
    response = await client.request("DELETE", "/v1/me", json={}, headers=bearer_headers(login))
    assert response.status_code == 401
    assert response.json()["code"] == "auth.reauth_required"


async def test_validation_errors_never_echo_credentials(
    client: httpx.AsyncClient,
) -> None:
    password = "sensitive-value-1234"
    response = await client.post(
        "/v1/auth/login",
        json={"email": "invalid-email", "password": password, "mode": "bearer"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation.failed"
    assert password not in response.text
    assert "invalid-email" not in response.text


async def test_delete_me_deactivates_and_revokes(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
    migrated_url: str,
    settings: Settings,
    clock: FixedClock,
) -> None:
    login = await register_user(client, mail)
    user_id = CookieOut.model_validate(login.json()).user.id
    raw_cookie = client.cookies[settings.session_cookie_name]
    bearer = await login_user(client, mode="bearer")
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        city_id = await city(connection)
        line_id = await line(connection, city_id)
        await trace(connection, city_id, user_id, 2)
        await edit(connection, city_id, user_id)
        await connection.execute(
            "INSERT INTO favorites (user_id, line_id) VALUES ($1, $2)", user_id, line_id
        )
    finally:
        await connection.close()
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=cookie_headers(login)
    )
    assert response.status_code == 202
    assert response.json() == {"status": "deletion_scheduled"}
    assert "Max-Age=0" in response.headers["set-cookie"]
    async with session_factory() as db:
        user = await db.get(User, user_id)
        assert user is not None
        assert user.deactivated_at == clock.now()
        deletion = await db.scalar(
            select(DeletionRequest).where(DeletionRequest.user_id == user_id)
        )
        assert deletion is not None
        assert deletion.state == "scheduled"
        assert deletion.scheduled_for == clock.now() + timedelta(days=7)
        assert await db.scalar(select(Favorite).where(Favorite.user_id == user_id)) is None
        assert await db.scalar(select(Trace).where(Trace.author_id == user_id)) is None
        pending = await db.scalar(select(Edit).where(Edit.author_id == user_id))
        assert pending is not None
        assert pending.state == "withdrawn"
        assert all(row.revoked_at is not None for row in await db.scalars(select(UserSession)))
        assert all(
            row.revoked_at is not None and row.revoked_reason == "account_deleted"
            for row in await db.scalars(select(RefreshToken))
        )
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "account.delete_requested")
        )
        assert audit is not None
        assert audit.actor_id is None
        assert audit.target_id == user_id
    client.cookies.set(settings.session_cookie_name, raw_cookie)
    assert (await client.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers=bearer_headers(bearer))).status_code == 401
    result = BearerOut.model_validate(bearer.json())
    assert (
        await client.post("/v1/auth/refresh", json={"refresh_token": result.refresh_token})
    ).status_code == 401


@pytest.mark.parametrize("mode", ["cookie", "bearer"])
async def test_recent_passwordless_session_can_delete(
    client: httpx.AsyncClient, mail: RecordingMailSender, mode: str
) -> None:
    await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    login = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": mode}
    )
    headers = cookie_headers(login) if mode == "cookie" else bearer_headers(login)
    response = await client.request("DELETE", "/v1/me", json={}, headers=headers)
    assert response.status_code == 202
