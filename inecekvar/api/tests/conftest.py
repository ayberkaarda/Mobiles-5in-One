import os
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest

from app.main import create_app
from tests.support.app import make_test_settings

POSTGIS_IMAGE = "postgis/postgis:16-3.5"
REDIS_IMAGE = "redis:7.4.11-alpine"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=create_app(make_test_settings()))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


def _docker_unavailable_reason() -> str | None:
    """Returns why Docker cannot be used, or None when the daemon answers a ping."""
    try:
        import docker

        docker.from_env().ping()
    except Exception as exc:  # any client or transport error means "no usable Docker"
        return f"Docker is not reachable ({type(exc).__name__}: {exc})"
    return None


@pytest.fixture(scope="session")
def postgis_dsn() -> Iterator[str]:
    """DSN of a PostGIS database.

    INECEKVAR_TEST_DATABASE_URL wins (the CI service container). Otherwise a Testcontainers
    PostGIS container is started. Without Docker the test is skipped with the reason, unless
    INECEKVAR_REQUIRE_DOCKER=1, which turns the missing Docker into a failure.
    """
    configured = os.environ.get("INECEKVAR_TEST_DATABASE_URL")
    if configured:
        yield configured
        return
    reason = _docker_unavailable_reason()
    if reason is not None:
        if os.environ.get("INECEKVAR_REQUIRE_DOCKER") == "1":
            pytest.fail(f"{reason}; INECEKVAR_REQUIRE_DOCKER=1 forbids skipping")
        pytest.skip(reason)
    from testcontainers.community.postgres import PostgresContainer

    with PostgresContainer(POSTGIS_IMAGE, driver=None) as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
    """URL of a real Redis server, same precedence and skip rules as `postgis_dsn`.

    INECEKVAR_TEST_REDIS_URL wins; otherwise a Testcontainers Redis matching the Compose image.
    """
    configured = os.environ.get("INECEKVAR_TEST_REDIS_URL")
    if configured:
        yield configured
        return
    reason = _docker_unavailable_reason()
    if reason is not None:
        if os.environ.get("INECEKVAR_REQUIRE_DOCKER") == "1":
            pytest.fail(f"{reason}; INECEKVAR_REQUIRE_DOCKER=1 forbids skipping")
        pytest.skip(reason)
    from testcontainers.redis import RedisContainer

    with RedisContainer(REDIS_IMAGE) as container:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(6379)
        yield f"redis://{host}:{port}/0"
