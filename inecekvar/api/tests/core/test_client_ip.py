import httpx
import pytest
from fastapi import FastAPI

from app.core.client_ip import rate_limit_key, resolve_client_ip
from app.core.settings import Settings

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("peer", "headers", "expected"),
    [
        (None, {"X-Real-IP": "198.51.100.4"}, "0.0.0.0"),  # noqa: S104 (peer sentinel)
        ("203.0.113.7", {"X-Real-IP": "198.51.100.4"}, "203.0.113.7"),
        ("127.0.0.1", {"x-real-ip": "198.51.100.4"}, "198.51.100.4"),
        ("::1", {"X-Real-IP": "2001:db8:0:0::1"}, "2001:db8::1"),
        ("127.0.0.1", {"X-Real-IP": "198.51.100.4, 198.51.100.5"}, "127.0.0.1"),
        ("127.0.0.1", {"Forwarded": "for=198.51.100.4"}, "127.0.0.1"),
        ("127.0.0.1", {"X-Real-IP": "invalid"}, "127.0.0.1"),
        ("127.0.0.1", {"X-Real-IP": "198.51.100.4:443"}, "127.0.0.1"),
        ("127.0.0.1", {"X-Real-IP": " 198.51.100.4 "}, "127.0.0.1"),
        ("invalid", {}, "0.0.0.0"),  # noqa: S104 (peer sentinel)
        # Dual-stack bind: the IPv4 proxy arrives IPv4-mapped (phase 6 review F2).
        ("::ffff:127.0.0.1", {"X-Real-IP": "198.51.100.7"}, "198.51.100.7"),
        ("::ffff:7f00:1", {"X-Real-IP": "2001:db8::9"}, "2001:db8::9"),
        ("::ffff:203.0.113.7", {"X-Real-IP": "198.51.100.7"}, "::ffff:203.0.113.7"),
    ],
)
def test_resolve_client_ip(
    settings: Settings, peer: str | None, headers: dict[str, str], expected: str
) -> None:
    assert resolve_client_ip(peer, headers, settings) == expected


async def test_spoofed_x_forwarded_for_ignored(client: httpx.AsyncClient) -> None:
    for number in range(5):
        response = await client.get(
            "/v1/_test/limited",
            headers={
                "X-Forwarded-For": f"198.51.100.{number}",
                "X-Real-IP": f"198.51.100.{number}",
            },
        )
        assert response.status_code == 200
        assert response.json()["ip"] == "203.0.113.10"
    assert (await client.get("/v1/_test/limited")).status_code == 429


async def test_trusted_proxy_header_used(core_app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=core_app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        for _ in range(5):
            response = await client.get("/v1/_test/limited", headers={"X-Real-IP": "198.51.100.4"})
            assert response.status_code == 200
            assert response.json()["ip"] == "198.51.100.4"
        response = await client.get("/v1/_test/limited", headers={"X-Real-IP": "198.51.100.4"})
        assert response.status_code == 429
        response = await client.get("/v1/_test/limited", headers={"X-Real-IP": "198.51.100.5"})
        assert response.status_code == 200
        assert response.json()["ip"] == "198.51.100.5"


async def test_invalid_trusted_header_falls_back_to_peer(core_app: FastAPI) -> None:
    transport = httpx.ASGITransport(app=core_app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.get("/v1/_test/ip", headers={"X-Real-IP": "198.51.100.4, 1.1.1.1"})
        assert response.json()["ip"] == "127.0.0.1"
        response = await client.get(
            "/v1/_test/ip", headers=[("X-Real-IP", "198.51.100.4"), ("X-Real-IP", "198.51.100.5")]
        )
        assert response.json()["ip"] == "127.0.0.1"


def test_rate_limit_key_unwraps_mapped_and_groups_ipv6() -> None:
    assert rate_limit_key("::ffff:198.51.100.7") == "198.51.100.7"
    assert rate_limit_key("2001:db8:1:2::7") == "2001:db8:1:2::/64"
    assert rate_limit_key("198.51.100.7") == "198.51.100.7"
    assert rate_limit_key("not-an-ip") == "not-an-ip"
