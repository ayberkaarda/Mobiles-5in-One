import httpx
import pytest
from fastapi import FastAPI, Response
from starlette.types import Message, Receive, Scope, Send
from structlog.contextvars import get_contextvars

from app.core.deps import RateLimitDecision, Services
from app.core.handlers import UnhandledErrorMiddleware
from app.core.headers import SECURITY_HEADERS
from app.core.settings import Settings
from tests.core.conftest import make_core_app

pytestmark = pytest.mark.anyio


class BrokenLimiter:
    async def hit(self, rule: str, subject: str) -> RateLimitDecision:
        raise RuntimeError("private storage detail")


async def test_limiter_failure_returns_problem(
    client: httpx.AsyncClient, services: Services
) -> None:
    services.rate_limiter = BrokenLimiter()
    response = await client.get("/v1/_test/limited")
    assert response.status_code == 500
    assert response.json()["code"] == "internal"
    assert "private storage detail" not in response.text
    assert response.headers["cache-control"] == "no-store"


async def test_response_started_error_only_logs() -> None:
    messages: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("private streaming detail")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    await UnhandledErrorMiddleware(app)({"type": "http"}, receive, send)
    assert len(messages) == 1
    assert messages[0]["status"] == 200


async def test_security_headers_overwrite_route(settings: Settings, services: Services) -> None:
    def routes(app: FastAPI) -> None:
        @app.get("/v1/_test/headers")
        async def headers() -> Response:
            return Response(headers=dict.fromkeys(SECURITY_HEADERS, "unsafe"))

    app = make_core_app(settings, services, routes)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://testserver"
    ) as client:
        response = await client.get("/v1/_test/headers")
        for name, value in SECURITY_HEADERS.items():
            assert response.headers[name] == value


async def test_request_context_cleared(client: httpx.AsyncClient) -> None:
    before = get_contextvars()
    await client.get("/v1/_test/ip", headers={"X-Request-ID": "context-id-1234"})
    assert get_contextvars() == before
