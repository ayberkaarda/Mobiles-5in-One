import uuid
from collections.abc import AsyncIterator

import fakeredis
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.authenticator import TokenSessionAuthenticator
from app.auth.passwords import hash_password
from app.core.deps import Services
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.enums import UserRole
from app.models.session import create_engine, create_session_factory
from tests.auth.conftest import PASSWORD, bearer_headers, login_user
from tests.support.app import (
    FixedClock,
    InMemoryRateLimiter,
    RecordingMailSender,
    StaticBreachChecker,
    make_test_settings,
)
from tests.support.fixtures import migrated_url

__all__ = ["migrated_url"]


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
def settings() -> Settings:
    return make_test_settings()


@pytest.fixture
async def redis() -> AsyncIterator[fakeredis.FakeAsyncRedis]:
    connection = fakeredis.FakeAsyncRedis()
    try:
        yield connection
    finally:
        await connection.aclose()


@pytest.fixture
def services(
    settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
    redis: fakeredis.FakeAsyncRedis,
    clock: FixedClock,
) -> Services:
    return Services(
        settings=settings,
        session_factory=session_factory,
        redis=redis,
        rate_limiter=InMemoryRateLimiter(settings.rate_limit_rules, clock),
        authenticator=TokenSessionAuthenticator(settings, clock),
        mail_sender=RecordingMailSender(),
        breach_checker=StaticBreachChecker(),
        clock=clock,
    )


async def create_account(services: Services, role: UserRole) -> tuple[uuid.UUID, str]:
    identity = uuid7()
    email = identity.hex + "@example.com"
    async with services.session_factory() as db:
        await db.execute(
            text(
                "INSERT INTO users "
                "(id, email, password_hash, role, email_verified_at, created_at, updated_at) "
                "VALUES (:id, :email, :password_hash, :role, :now, :now, :now)"
            ),
            {
                "id": identity,
                "email": email,
                "password_hash": await hash_password(PASSWORD, services.settings),
                "role": role.value,
                "now": services.clock.now(),
            },
        )
        await db.commit()
    return identity, email


async def sign_in(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    return bearer_headers(await login_user(client, email=email, mode="bearer"))
