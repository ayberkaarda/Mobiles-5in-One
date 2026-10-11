"""Regression tests for the white-box review findings on the auth package."""

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.schemas import BearerOut, RefreshOut
from app.models.accounts import MagicLink, User
from tests.auth.conftest import EMAIL, PASSWORD, cookie_headers, mailed_token, register_user
from tests.support.app import FixedClock, RecordingMailSender

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

ATTACKER_PASSWORD = "attacker-chosen-password-9"


async def test_register_link_requires_the_registrant_password(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    response = await client.post(
        "/v1/auth/register",
        json={"email": EMAIL, "password": ATTACKER_PASSWORD, "mode": "bearer"},
    )
    assert response.status_code == 202
    victim_token = mailed_token(mail)
    for body in (
        {"token": victim_token, "mode": "bearer"},
        {"token": victim_token, "mode": "bearer", "password": "a-different-password"},
    ):
        response = await client.post("/v1/auth/magic-link/verify", json=body)
        assert response.status_code == 401
        assert response.json()["code"] == "auth.invalid_credentials"
    async with session_factory() as db:
        assert await db.scalar(select(User).where(User.email == EMAIL)) is None
        link = await db.scalar(select(MagicLink).where(MagicLink.email == EMAIL))
        assert link is not None
        assert link.used_at is None
    # The mailbox owner signs in with a plain link instead: the account has no password, and
    # the password chosen by the other party never becomes valid.
    await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    response = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": "bearer"}
    )
    assert response.status_code == 200
    response = await client.post(
        "/v1/auth/login", json={"email": EMAIL, "password": ATTACKER_PASSWORD, "mode": "bearer"}
    )
    assert response.status_code == 401
    response = await client.post(
        "/v1/auth/magic-link/verify",
        json={"token": victim_token, "mode": "bearer", "password": ATTACKER_PASSWORD},
    )
    assert response.status_code == 200
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == EMAIL))
        assert user is not None
        assert user.password_hash is None


async def test_expired_rotated_token_replay_revokes_family(
    client: httpx.AsyncClient, mail: RecordingMailSender, clock: FixedClock
) -> None:
    first = BearerOut.model_validate((await register_user(client, mail, mode="bearer")).json())
    clock.advance(days=29)
    rotated = await client.post("/v1/auth/refresh", json={"refresh_token": first.refresh_token})
    assert rotated.status_code == 200
    child = RefreshOut.model_validate(rotated.json())
    clock.advance(days=2)
    replay = await client.post("/v1/auth/refresh", json={"refresh_token": first.refresh_token})
    assert replay.status_code == 401
    response = await client.post("/v1/auth/refresh", json={"refresh_token": child.refresh_token})
    assert response.status_code == 401


async def test_delete_me_reauthentication_is_rate_limited(
    client: httpx.AsyncClient, mail: RecordingMailSender
) -> None:
    login = await register_user(client, mail)
    for _ in range(5):
        response = await client.request(
            "DELETE", "/v1/me", json={"password": "wrong-password"}, headers=cookie_headers(login)
        )
        assert response.status_code == 401
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=cookie_headers(login)
    )
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0
