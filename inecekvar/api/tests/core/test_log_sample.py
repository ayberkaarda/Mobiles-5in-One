import io
import json

import httpx
import pytest
import structlog
from fastapi import FastAPI

from app.auth.authenticator import TokenSessionAuthenticator
from app.core.deps import Services
from app.main import create_app
from app.models.session import create_engine, create_session_factory
from tests.auth.conftest import (
    EMAIL,
    PASSWORD,
    bearer_headers,
    login_user,
    mailed_token,
    register_user,
)
from tests.core.test_logging import log_stream
from tests.support.app import RecordingMailSender

__all__ = ["log_stream"]

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def near(lat: float, lng: float) -> dict[str, bool]:
    structlog.get_logger().info("near.sample", lat=lat, lng=lng, email=EMAIL, token="private-token")
    return {"ok": True}


def auth_core_app(services: Services) -> FastAPI:
    application = create_app(services=services)
    application.add_api_route("/v1/_test/near", near, methods=["GET"])
    return application


async def test_log_sample_has_no_email_token_or_precise_coordinate(
    migrated_url: str, services: Services, log_stream: io.StringIO
) -> None:
    engine = create_engine(migrated_url)
    mail = RecordingMailSender()
    services.session_factory = create_session_factory(engine)
    services.authenticator = TokenSessionAuthenticator(services.settings, services.clock)
    services.mail_sender = mail
    transport = httpx.ASGITransport(app=auth_core_app(services), client=("203.0.113.10", 50000))
    secrets = [PASSWORD, "private-token"]
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://testserver",
            headers={"Origin": "https://app.inecekvar.app", "X-Request-ID": "log-sample-1234"},
        ) as client:
            verified = await register_user(client, mail, mode="bearer")
            secrets.extend([verified.json()["access_token"], verified.json()["refresh_token"]])
            secrets.append(mailed_token(mail))
            bearer = await login_user(client, mode="bearer")
            secrets.extend([bearer.json()["access_token"], bearer.json()["refresh_token"]])
            response = await client.get("/v1/me", headers=bearer_headers(bearer))
            assert response.status_code == 200
            response = await client.post(
                "/v1/auth/refresh", json={"refresh_token": bearer.json()["refresh_token"]}
            )
            assert response.status_code == 200
            secrets.extend([response.json()["access_token"], response.json()["refresh_token"]])
            cookie = await login_user(client, mode="cookie")
            secrets.append(cookie.json()["csrf_token"])
            secrets.extend(client.cookies.values())
            response = await client.get("/v1/me")
            assert response.status_code == 200
            response = await client.get("/v1/_test/near?lat=41.0123456&lng=29.0987654")
            assert response.status_code == 200
    finally:
        await engine.dispose()
    captured = log_stream.getvalue()
    assert "@" not in captured
    assert "41.0123456" not in captured
    assert "29.0987654" not in captured
    assert all(secret not in captured for secret in secrets)
    assert "41.012" in captured
    assert "email_hash" in captured
    assert "log-sample-1234" in captured
    lines = [json.loads(line) for line in captured.splitlines() if line]
    requests = [line for line in lines if line.get("event") == "http.request"]
    assert len(requests) == 8
    assert all(line["request_id"] == "log-sample-1234" for line in requests)
    assert all("client_ip_hash" in line and "client_ip" not in line for line in requests)
