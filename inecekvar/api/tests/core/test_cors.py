import httpx
import pytest

from app.core.deps import Services
from app.core.settings import CORS_METHODS, CORS_REQUEST_HEADERS
from tests.core.conftest import make_core_app
from tests.support.app import make_test_settings

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    "origin",
    ["https://evil.example", "null", "https://inecekvar.app.evil.example", "http://inecekvar.app"],
)
async def test_evil_origin_gets_no_cors_headers(client: httpx.AsyncClient, origin: str) -> None:
    response = await client.get("/v1/_test/ip", headers={"Origin": origin})
    assert response.status_code == 200
    assert not any(name.startswith("access-control-") for name in response.headers)
    response = await client.options(
        "/v1/_test/ip", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin.not_allowed"
    assert not any(name.startswith("access-control-") for name in response.headers)


@pytest.mark.parametrize("origin", ["https://inecekvar.app", "https://app.inecekvar.app"])
async def test_web_origins_get_credentials(client: httpx.AsyncClient, origin: str) -> None:
    for response in (
        await client.get("/v1/_test/ip", headers={"Origin": origin}),
        await client.options(
            "/v1/_test/ip", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
        ),
    ):
        assert response.headers["access-control-allow-origin"] == origin
        assert response.headers["access-control-allow-credentials"] == "true"
        assert "Origin" in response.headers["vary"]


@pytest.mark.parametrize("origin", ["capacitor://localhost", "https://localhost"])
async def test_capacitor_origins_are_bearer_only(client: httpx.AsyncClient, origin: str) -> None:
    for response in (
        await client.get("/v1/_test/ip", headers={"Origin": origin}),
        await client.options(
            "/v1/_test/ip", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
        ),
    ):
        assert response.headers["access-control-allow-origin"] == origin
        assert "access-control-allow-credentials" not in response.headers


@pytest.mark.parametrize(("method", "header"), [("TRACE", "Authorization"), ("POST", "X-Other")])
async def test_preflight_rejects_unlisted_header_and_method(
    client: httpx.AsyncClient, method: str, header: str
) -> None:
    response = await client.options(
        "/v1/_test/ip",
        headers={
            "Origin": "https://inecekvar.app",
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": header,
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin.not_allowed"


async def test_preflight_explicit_lists(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/v1/_test/ip",
        headers={
            "Origin": "https://inecekvar.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, content-type, x-request-id",
        },
    )
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["access-control-allow-methods"] == ", ".join(CORS_METHODS)
    assert response.headers["access-control-allow-headers"] == ", ".join(CORS_REQUEST_HEADERS)
    assert response.headers["access-control-max-age"] == "600"
    assert "*" not in str(response.headers)


@pytest.mark.parametrize(
    ("env", "allowed"), [("local", True), ("test", False), ("production", False)]
)
async def test_local_origins_only_in_local_env(services: Services, env: str, allowed: bool) -> None:
    settings = make_test_settings(env=env)
    transport = httpx.ASGITransport(app=make_core_app(settings, services))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.options(
            "/v1/_test/ip",
            headers={"Origin": "http://localhost:4200", "Access-Control-Request-Method": "GET"},
        )
        assert response.status_code == (204 if allowed else 403)
        assert ("access-control-allow-origin" in response.headers) is allowed
        response = await client.get("/v1/_test/ip", headers={"Origin": "http://localhost:4200"})
        assert ("access-control-allow-origin" in response.headers) is allowed


async def test_error_responses_keep_cors(client: httpx.AsyncClient) -> None:
    for path in ("/v1/_test/error", "/missing"):
        response = await client.get(path, headers={"Origin": "https://inecekvar.app"})
        assert response.headers["access-control-allow-origin"] == "https://inecekvar.app"
        assert response.headers["access-control-expose-headers"] == "Retry-After, X-Request-ID"
