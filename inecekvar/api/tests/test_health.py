import httpx
import pytest

pytestmark = pytest.mark.anyio


async def test_health_returns_only_the_status(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_is_only_served_under_the_version_prefix(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 404
