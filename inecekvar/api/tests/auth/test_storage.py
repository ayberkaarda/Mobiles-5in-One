import asyncpg
import httpx
import pytest

from app.auth.schemas import BearerOut, RefreshOut
from app.core.settings import Settings
from tests.auth.conftest import EMAIL, PASSWORD, login_user, mailed_token, register_user
from tests.support.app import RecordingMailSender
from tests.support.database import asyncpg_dsn

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_db_dump_contains_only_argon2id_and_hashes(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    migrated_url: str,
    settings: Settings,
) -> None:
    secrets = [PASSWORD]
    await client.post(
        "/v1/auth/register",
        json={"email": "pending@example.com", "password": PASSWORD, "mode": "cookie"},
    )
    secrets.append(mailed_token(mail))
    await register_user(client, mail)
    secrets.append(mailed_token(mail))
    secrets.append(client.cookies[settings.session_cookie_name])
    await login_user(client)
    secrets.append(client.cookies[settings.session_cookie_name])
    bearer = BearerOut.model_validate((await login_user(client, mode="bearer")).json())
    secrets.extend([bearer.refresh_token, bearer.access_token])
    await client.post("/v1/auth/magic-link", json={"email": EMAIL})
    secrets.append(mailed_token(mail))
    response = await client.post("/v1/auth/refresh", json={"refresh_token": bearer.refresh_token})
    refreshed = RefreshOut.model_validate(response.json())
    secrets.extend([refreshed.refresh_token, refreshed.access_token])
    connection = await asyncpg.connect(asyncpg_dsn(migrated_url))
    try:
        statements = (
            "SELECT * FROM users",
            "SELECT * FROM magic_links",
            "SELECT * FROM sessions",
            "SELECT * FROM refresh_tokens",
        )
        for statement in statements:
            rows = await connection.fetch(statement)
            assert rows
            for row in rows:
                if "password_hash" in row and row["password_hash"] is not None:
                    assert str(row["password_hash"]).startswith("$argon2id$")
                if "token_hash" in row:
                    assert isinstance(row["token_hash"], bytes)
                    assert len(row["token_hash"]) == 32
                for value in row.values():
                    if isinstance(value, str):
                        assert all(raw not in value for raw in secrets)
                    elif isinstance(value, bytes):
                        assert all(raw.encode() not in value for raw in secrets)
    finally:
        await connection.close()
