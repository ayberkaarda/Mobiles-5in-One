from collections.abc import AsyncIterator, Callable

import fakeredis
import httpx
import pytest
import structlog
from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import ClientIpDep, Principal, Services, rate_limit
from app.core.errors import ProblemError
from app.core.settings import Settings
from app.core.setup import install_core
from tests.support.app import (
    FixedClock,
    InMemoryRateLimiter,
    RecordingMailSender,
    StaticBreachChecker,
    make_test_settings,
)
from tests.support.fixtures import migrated_url

__all__ = ["migrated_url"]


class AnonymousAuthenticator:
    async def authenticate(self, request: Request, db: AsyncSession) -> Principal | None:
        return None


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: int


def make_core_app(
    settings: Settings,
    services: Services,
    extra_routes: Callable[[FastAPI], None] | None = None,
) -> FastAPI:
    application = FastAPI()
    application.state.settings = settings
    application.state.services = services
    install_core(application, settings)

    @application.get("/v1/_test/ip")
    async def ip(client_ip: ClientIpDep) -> dict[str, str]:
        return {"ip": client_ip}

    @application.get("/v1/_test/limited", dependencies=[Depends(rate_limit("auth.login"))])
    async def limited(client_ip: ClientIpDep) -> dict[str, str]:
        return {"ip": client_ip}

    @application.get("/v1/_test/problem")
    async def problem() -> None:
        raise ProblemError("conflict", 409, headers={"Retry-After": "7"})

    @application.get("/v1/_test/error")
    async def error() -> None:
        raise RuntimeError("secret detail")

    @application.post("/v1/_test/json")
    async def json_body(body: Payload) -> Payload:
        return body

    @application.post("/v1/traces/_test")
    @application.post("/v1/webhooks/_test")
    async def raw_body(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    @application.get("/v1/_test/near")
    async def near(lat: float, lng: float) -> dict[str, bool]:
        structlog.get_logger().info(
            "near.sample", lat=lat, lng=lng, email="traveller@example.com", token="private-token"
        )
        return {"ok": True}

    if extra_routes is not None:
        extra_routes(application)
    return application


@pytest.fixture
def settings() -> Settings:
    return make_test_settings()


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock()


@pytest.fixture
async def redis() -> AsyncIterator[fakeredis.FakeAsyncRedis]:
    connection = fakeredis.FakeAsyncRedis()
    try:
        yield connection
    finally:
        await connection.aclose()


@pytest.fixture
def services(settings: Settings, clock: FixedClock, redis: fakeredis.FakeAsyncRedis) -> Services:
    return Services(
        settings=settings,
        session_factory=async_sessionmaker(),
        redis=redis,
        rate_limiter=InMemoryRateLimiter(settings.rate_limit_rules, clock),
        authenticator=AnonymousAuthenticator(),
        mail_sender=RecordingMailSender(),
        breach_checker=StaticBreachChecker(),
        clock=clock,
    )


@pytest.fixture
def core_app(settings: Settings, services: Services) -> FastAPI:
    return make_core_app(settings, services)


@pytest.fixture
async def client(core_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=core_app, client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection
