import base64
import hashlib
import hmac
import json

import httpx
import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.schemas import BearerOut, RefreshOut
from app.auth.tokens import token_hash
from app.core.settings import Settings
from app.models.accounts import RefreshToken
from tests.auth.conftest import bearer_headers, register_user
from tests.support.app import FixedClock, RecordingMailSender

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_refresh_rotates_and_old_token_is_single_use(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    login = BearerOut.model_validate((await register_user(client, mail, mode="bearer")).json())
    response = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    assert response.status_code == 200
    child = RefreshOut.model_validate(response.json())
    assert child.refresh_token != login.refresh_token
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    async with session_factory() as db:
        old = await db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash(login.refresh_token))
        )
        new = await db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash(child.refresh_token))
        )
        assert old is not None
        assert new is not None
        assert old.used_at is not None
        assert old.revoked_reason == "rotated"
        assert new.parent_id == old.id
        assert new.family_id == old.family_id
    response = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    assert response.status_code == 401
    assert response.json()["code"] == "auth.token_invalid"


async def test_refresh_reuse_revokes_family(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    initial = await register_user(client, mail, mode="bearer")
    login = BearerOut.model_validate(initial.json())
    response = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    child = RefreshOut.model_validate(response.json())
    response = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    assert response.status_code == 401
    async with session_factory() as db:
        rows = list(await db.scalars(select(RefreshToken)))
        assert len(rows) == 2
        assert all(row.revoked_at is not None for row in rows)
        assert all(row.revoked_reason == "reuse_detected" for row in rows)
    response = await client.post("/v1/auth/refresh", json={"refresh_token": child.refresh_token})
    assert response.status_code == 401
    assert (await client.get("/v1/me", headers=bearer_headers(initial))).status_code == 401
    assert (
        await client.get("/v1/me", headers={"Authorization": "Bearer " + child.access_token})
    ).status_code == 401


async def test_refresh_expired_is_rejected(
    client: httpx.AsyncClient, mail: RecordingMailSender, clock: FixedClock
) -> None:
    result = BearerOut.model_validate((await register_user(client, mail, mode="bearer")).json())
    clock.advance(days=30, seconds=1)
    response = await client.post("/v1/auth/refresh", json={"refresh_token": result.refresh_token})
    assert response.status_code == 401
    assert response.json()["code"] == "auth.token_invalid"


def encode_segment(value: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


async def test_jwt_alg_none_and_hs256_rejected(
    client: httpx.AsyncClient, mail: RecordingMailSender, settings: Settings
) -> None:
    response = await register_user(client, mail, mode="bearer")
    valid = BearerOut.model_validate(response.json()).access_token
    claims: dict[str, object] = jwt.decode(valid, options={"verify_signature": False})
    # Construct HS256 directly: the library deliberately refuses PEM HMAC keys.
    signing_input = encode_segment({"alg": "HS256", "typ": "JWT"}) + "." + encode_segment(claims)
    signature = hmac.new(settings.jwt_public_key(), signing_input.encode(), hashlib.sha256).digest()
    hs256 = signing_input + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
    unsigned = jwt.encode(claims, key="", algorithm="none")
    header, _, signature_segment = valid.split(".")
    changed = dict(claims)
    changed["aud"] = "tampered"
    tampered = header + "." + encode_segment(changed) + "." + signature_segment
    for token in (hs256, unsigned, tampered):
        response = await client.get("/v1/me", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 401
        assert response.json()["code"] == "auth.required"


async def test_jwt_expired_rejected(
    client: httpx.AsyncClient, mail: RecordingMailSender, clock: FixedClock
) -> None:
    login = await register_user(client, mail, mode="bearer")
    clock.advance(minutes=15)
    response = await client.get("/v1/me", headers=bearer_headers(login))
    assert response.status_code == 401
    assert response.json()["code"] == "auth.required"


async def test_jwt_wrong_audience_rejected(
    client: httpx.AsyncClient, mail: RecordingMailSender, settings: Settings
) -> None:
    login = await register_user(client, mail, mode="bearer")
    valid = BearerOut.model_validate(login.json()).access_token
    claims: dict[str, object] = jwt.decode(valid, options={"verify_signature": False})
    claims["aud"] = "other-service"
    token = jwt.encode(claims, settings.jwt_private_key(), algorithm="ES256")
    response = await client.get("/v1/me", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 401
    assert response.json()["code"] == "auth.required"
