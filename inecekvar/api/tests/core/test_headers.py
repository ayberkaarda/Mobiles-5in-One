import httpx
import pytest

from app.core.headers import SECURITY_HEADERS

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("status", [200, 404, 413, 429, 500, 204])
async def test_api_security_headers(client: httpx.AsyncClient, status: int) -> None:
    if status == 413:
        response = await client.post(
            "/v1/_test/json", content=b"x", headers={"Content-Length": str(1024 * 1024 + 1)}
        )
    elif status == 429:
        for _ in range(5):
            await client.get("/v1/_test/limited")
        response = await client.get("/v1/_test/limited")
    elif status == 204:
        response = await client.options(
            "/v1/_test/ip",
            headers={"Origin": "https://inecekvar.app", "Access-Control-Request-Method": "GET"},
        )
    else:
        path = {200: "/v1/_test/ip", 404: "/missing", 500: "/v1/_test/error"}[status]
        response = await client.get(path)
    assert response.status_code == status
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value
    assert response.headers["x-request-id"]
