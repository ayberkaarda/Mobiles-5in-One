import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import fakeredis
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.authenticator import TokenSessionAuthenticator
from app.core.deps import Services
from app.models import City, Line, Stop
from app.models.enums import UserRole
from app.models.session import create_engine, create_session_factory
from tests.support.app import (
    FixedClock,
    InMemoryRateLimiter,
    RecordingMailSender,
    StaticBreachChecker,
    make_test_settings,
)
from tests.support.domain import create_account, domain_app, seed_city, sign_in
from tests.support.fixtures import migrated_url

__all__ = ["migrated_url"]


@dataclass(frozen=True)
class Sample:
    city_id: uuid.UUID
    line_id: uuid.UUID
    stop_ids: list[uuid.UUID]


@dataclass(frozen=True)
class Account:
    identity: uuid.UUID
    headers: dict[str, str]


@pytest.fixture
async def session_factory(migrated_url: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_engine(migrated_url)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock()


@pytest.fixture
async def services(
    session_factory: async_sessionmaker[AsyncSession],
    clock: FixedClock,
) -> AsyncIterator[Services]:
    settings = make_test_settings()
    connection = fakeredis.FakeAsyncRedis()
    try:
        yield Services(
            settings=settings,
            session_factory=session_factory,
            redis=connection,
            rate_limiter=InMemoryRateLimiter(settings.rate_limit_rules, clock),
            authenticator=TokenSessionAuthenticator(settings, clock),
            mail_sender=RecordingMailSender(),
            breach_checker=StaticBreachChecker(),
            clock=clock,
        )
    finally:
        await connection.aclose()


@pytest.fixture
async def client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=domain_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection


@pytest.fixture
async def sample(services: Services) -> Sample:
    await seed_city(services)
    async with services.session_factory() as db:
        city = await db.scalar(select(City).where(City.slug == "ornek-test-sehri"))
        line = await db.scalar(select(Line).where(Line.slug == "ornek-hat-1"))
        assert city is not None
        assert line is not None
        stops = list(
            await db.scalars(
                select(Stop.id)
                .where(
                    Stop.city_id == city.id,
                )
                .order_by(Stop.slug)
            )
        )
        return Sample(city.id, line.id, stops)


@pytest.fixture
async def contributor(services: Services, client: httpx.AsyncClient) -> Account:
    identity, email = await create_account(services)
    return Account(identity, await sign_in(client, email))


@pytest.fixture
async def moderator(services: Services, client: httpx.AsyncClient) -> Account:
    identity, email = await create_account(services, UserRole.MODERATOR)
    return Account(identity, await sign_in(client, email))


@pytest.fixture
async def user(services: Services, client: httpx.AsyncClient) -> Account:
    identity, email = await create_account(services, UserRole.USER)
    return Account(identity, await sign_in(client, email))
