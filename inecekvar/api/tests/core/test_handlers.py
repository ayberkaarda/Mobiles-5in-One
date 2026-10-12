import httpx
import pytest

pytestmark = pytest.mark.anyio


async def test_forced_exception_returns_generic_body(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/_test/error")
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/problem+json"
    assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
    assert response.json()["code"] == "internal"
    assert "secret detail" not in response.text
    assert "Traceback" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == response.json()["request_id"]


async def test_validation_error_does_not_echo_input(client: httpx.AsyncClient) -> None:
    response = await client.post("/v1/_test/json", json={"value": "private-invalid-value"})
    assert response.status_code == 422
    assert response.json()["code"] == "validation.failed"
    assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
    assert "private-invalid-value" not in response.text
    assert "loc" not in response.json()


async def test_not_found_is_problem_json(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/missing")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "not_found"


async def test_problem_error_extra_headers_kept(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/_test/problem")
    assert response.status_code == 409
    assert response.headers["retry-after"] == "7"
    assert response.json()["code"] == "conflict"


async def test_method_not_allowed_keeps_allow(client: httpx.AsyncClient) -> None:
    response = await client.put("/v1/_test/ip")
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"
    assert "GET" in response.headers["allow"]


async def test_sixth_request_returns_429_with_retry_after(client: httpx.AsyncClient) -> None:
    for _ in range(5):
        assert (await client.get("/v1/_test/limited")).status_code == 200
    response = await client.get("/v1/_test/limited")
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0
    assert response.json()["code"] == "rate_limited"
    assert response.headers["x-request-id"] == response.json()["request_id"]


@pytest.mark.parametrize("path", ["/v1/_test/ip", "/v1/_test/error", "/v1/missing"])
async def test_request_id_propagates(client: httpx.AsyncClient, path: str) -> None:
    response = await client.get(path, headers={"X-Request-ID": "valid-id-1234"})
    assert response.headers["x-request-id"] == "valid-id-1234"
    if response.status_code >= 400:
        assert response.json()["request_id"] == "valid-id-1234"
    response = await client.get(path, headers={"X-Request-ID": "bad id"})
    assert response.headers["x-request-id"] != "bad id"
    assert len(response.headers["x-request-id"]) == 36


@pytest.mark.parametrize("value", ["short", "a" * 65, "bad/id-123", "bad_id-123", "12345678\t"])
async def test_invalid_request_id_replaced(client: httpx.AsyncClient, value: str) -> None:
    response = await client.get("/v1/_test/ip", headers={"X-Request-ID": value})
    assert response.headers["x-request-id"] != value
