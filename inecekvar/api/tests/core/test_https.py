"""Plain http refused behind the proxy (spec section 6.10, ADR-0055)."""

import httpx
import pytest
from fastapi import FastAPI

from app.core.deps import Services
from app.core.headers import SECURITY_HEADERS
from app.core.https import effective_scheme
from app.core.settings import Settings
from tests.core.conftest import make_core_app
from tests.support.app import make_test_settings

pytestmark = pytest.mark.anyio

PROXY = ("127.0.0.1", 50000)
OUTSIDER = ("203.0.113.7", 50000)
HSTS = "max-age=63072000; includeSubDomains; preload"


@pytest.fixture
def settings() -> Settings:
    return make_test_settings(require_https=True)


def client_for(app: FastAPI, peer: tuple[str, int], base_url: str) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, client=peer)
    return httpx.AsyncClient(transport=transport, base_url=base_url)


def test_enforcement_follows_environment() -> None:
    assert make_test_settings(env="production", smtp_use_tls=True).https_enforced
    assert not make_test_settings().https_enforced
    assert not make_test_settings(env="local").https_enforced
    assert make_test_settings(require_https=True).https_enforced
    with pytest.raises(ValueError, match="require_https"):
        make_test_settings(env="production", smtp_use_tls=True, require_https=False)


@pytest.mark.parametrize(
    ("scheme", "peer", "forwarded", "expected"),
    [
        ("http", "127.0.0.1", ["https"], "https"),
        ("http", "::1", ["HTTPS "], "https"),
        ("http", "127.0.0.1", ["http"], "http"),
        ("http", "127.0.0.1", [], "http"),
        ("http", "127.0.0.1", ["https", "https"], "http"),
        ("http", "127.0.0.1", ["https, http"], "http"),
        ("http", "127.0.0.1", ["wss"], "http"),
        ("http", "203.0.113.7", ["https"], "http"),
        ("http", None, ["https"], "http"),
        ("http", "not-an-address", ["https"], "http"),
        ("https", "203.0.113.7", [], "https"),
        ("https", "127.0.0.1", ["http"], "http"),
        # Dual-stack bind: the IPv4 proxy arrives IPv4-mapped (phase 6 review F2).
        ("http", "::ffff:127.0.0.1", ["https"], "https"),
        ("http", "::FFFF:7f00:1", ["https"], "https"),
        ("http", "::ffff:203.0.113.7", ["https"], "http"),
    ],
)
def test_effective_scheme(
    settings: Settings, scheme: str, peer: str | None, forwarded: list[str], expected: str
) -> None:
    assert effective_scheme(scheme, peer, forwarded, settings) == expected


async def test_plain_http_is_refused_with_problem_and_headers(core_app: FastAPI) -> None:
    async with client_for(core_app, OUTSIDER, "http://api.inecekvar.app") as client:
        for method, path in (("GET", "/v1/_test/ip"), ("POST", "/v1/_test/json")):
            response = await client.request(method, path, json={"value": 1})
            assert response.status_code == 403
            assert response.headers["content-type"] == "application/problem+json"
            body = response.json()
            assert body["code"] == "transport.https_required"
            assert set(body) == {"type", "title", "status", "code", "request_id"}
            assert "location" not in response.headers
            for name, value in SECURITY_HEADERS.items():
                assert response.headers[name] == value


async def test_spoofed_forwarded_proto_from_untrusted_peer_is_ignored(core_app: FastAPI) -> None:
    async with client_for(core_app, OUTSIDER, "http://api.inecekvar.app") as client:
        for headers in (
            {"X-Forwarded-Proto": "https"},
            {"X-Forwarded-Proto": "https", "X-Real-IP": "127.0.0.1"},
            {"Forwarded": "proto=https", "X-Forwarded-Ssl": "on"},
        ):
            response = await client.get("/v1/_test/ip", headers=headers)
            assert response.status_code == 403, headers
            assert response.json()["code"] == "transport.https_required"


async def test_trusted_proxy_marked_https_is_served_with_hsts(core_app: FastAPI) -> None:
    async with client_for(core_app, PROXY, "http://api.inecekvar.app") as client:
        response = await client.get(
            "/v1/_test/ip", headers={"X-Forwarded-Proto": "https", "X-Real-IP": "198.51.100.4"}
        )
        assert response.status_code == 200
        assert response.json() == {"ip": "198.51.100.4"}
        assert response.headers["strict-transport-security"] == HSTS
        refused = await client.get("/v1/_test/ip", headers={"X-Forwarded-Proto": "http"})
        assert refused.status_code == 403
        duplicated = await client.get(
            "/v1/_test/ip",
            headers=[("X-Forwarded-Proto", "https"), ("X-Forwarded-Proto", "https")],
        )
        assert duplicated.status_code == 403


async def test_ipv4_mapped_proxy_peer_is_trusted(core_app: FastAPI) -> None:
    async with client_for(
        core_app, ("::ffff:127.0.0.1", 50000), "http://api.inecekvar.app"
    ) as client:
        response = await client.get(
            "/v1/_test/ip", headers={"X-Forwarded-Proto": "https", "X-Real-IP": "198.51.100.4"}
        )
        assert response.status_code == 200
        assert response.json() == {"ip": "198.51.100.4"}


async def test_tls_terminated_at_the_process_is_served(core_app: FastAPI) -> None:
    async with client_for(core_app, OUTSIDER, "https://api.inecekvar.app") as client:
        response = await client.get("/v1/_test/ip")
        assert response.status_code == 200
        assert response.headers["strict-transport-security"] == HSTS


async def test_health_answers_over_http_and_local_env_is_exempt(
    core_app: FastAPI, services: Services
) -> None:
    @core_app.get("/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async with client_for(core_app, OUTSIDER, "http://api.inecekvar.app") as client:
        assert (await client.get("/v1/health")).status_code == 200
        assert (await client.get("/v1/health/x")).status_code == 403

    for env in ("local", "test"):
        exempt = make_core_app(make_test_settings(env=env), services)
        async with client_for(exempt, OUTSIDER, "http://localhost") as client:
            assert (await client.get("/v1/_test/ip")).status_code == 200
