from collections.abc import AsyncIterator

import httpx
import pytest

pytestmark = pytest.mark.anyio


async def oversized_stream() -> AsyncIterator[bytes]:
    yield b"x" * (512 * 1024)
    yield b"x" * (512 * 1024)
    yield b"x"


async def test_body_limit_1mb(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/_test/json",
        content=b"x",
        headers={"Content-Length": str(1024 * 1024 + 1), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["code"] == "request.body_too_large"
    response = await client.post(
        "/v1/_test/json", content=oversized_stream(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["code"] == "request.body_too_large"
    response = await client.post(
        "/v1/_test/json",
        content=oversized_stream(),
        headers={"Content-Type": "application/json", "Content-Length": "1"},
    )
    assert response.status_code == 413


async def test_trace_body_limit_2mb(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/traces/_test",
        content=b"x" * (1536 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 200
    assert response.json()["size"] == 1536 * 1024
    response = await client.post(
        "/v1/traces/_test",
        content=b"x" * (2 * 1024 * 1024 + 1),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


async def test_non_json_body_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post("/v1/_test/json", data={"value": "1"})
    assert response.status_code == 415
    assert response.json()["code"] == "request.unsupported_media_type"
    response = await client.post("/v1/_test/json", content=b"value=1")
    assert response.status_code == 415


async def test_json_parameters_allowed(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/_test/json",
        content=b'{"value": 1}',
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 200


async def test_webhooks_exempt_only_from_media_type(client: httpx.AsyncClient) -> None:
    response = await client.post("/v1/webhooks/_test", content=b"raw")
    assert response.status_code == 200
    response = await client.post("/v1/webhooks/_test", content=b"x" * (1024 * 1024 + 1))
    assert response.status_code == 413
