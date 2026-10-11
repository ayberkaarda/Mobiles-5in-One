import re
from collections.abc import AsyncIterator

import fakeredis
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.routing import Route

from app.auth.authenticator import TokenSessionAuthenticator
from app.auth.passwords import hash_password
from app.auth.router import router
from app.auth.schemas import BearerOut, CookieOut
from app.core.deps import AuthMode, Services
from app.core.ids import uuid7
from app.core.settings import Settings
from app.models.accounts import User
from app.models.enums import UserRole
from app.models.session import create_engine, create_session_factory
from tests.support.app import (
    FixedClock,
    InMemoryRateLimiter,
    RecordingMailSender,
    StaticBreachChecker,
    build_test_app,
    make_test_settings,
)
from tests.support.fixtures import migrated_url

__all__ = ["migrated_url"]

PASSWORD = "a-strong-password-42"
EMAIL = "traveller@example.com"


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
def mail() -> RecordingMailSender:
    return RecordingMailSender()


@pytest.fixture
def breach() -> StaticBreachChecker:
    return StaticBreachChecker(frozenset({"password1234"}))


@pytest.fixture
def settings() -> Settings:
    return make_test_settings()


@pytest.fixture
def limiter(settings: Settings, clock: FixedClock) -> InMemoryRateLimiter:
    return InMemoryRateLimiter(settings.rate_limit_rules, clock)


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
    limiter: InMemoryRateLimiter,
    mail: RecordingMailSender,
    breach: StaticBreachChecker,
    clock: FixedClock,
) -> Services:
    return Services(
        settings=settings,
        session_factory=session_factory,
        redis=redis,
        rate_limiter=limiter,
        authenticator=TokenSessionAuthenticator(settings, clock),
        mail_sender=mail,
        breach_checker=breach,
        clock=clock,
    )


def auth_app(services: Services) -> FastAPI:
    application = build_test_app(services)
    if not any(
        isinstance(route, Route) and route.path == "/v1/auth/login" for route in application.routes
    ):
        application.include_router(router, prefix="/v1")
    return application


@pytest.fixture
async def client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=auth_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection


def mailed_token(mail: RecordingMailSender) -> str:
    match = re.search(r"[?&]token=([A-Za-z0-9_-]+)", mail.sent[-1].text)
    assert match is not None
    return match.group(1)


async def register_user(
    client: httpx.AsyncClient,
    mail: RecordingMailSender,
    *,
    email: str = EMAIL,
    mode: AuthMode = "cookie",
) -> httpx.Response:
    response = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": PASSWORD, "mode": mode},
    )
    assert response.status_code == 202
    response = await client.post(
        "/v1/auth/magic-link/verify", json={"token": mailed_token(mail), "mode": mode}
    )
    assert response.status_code == 200
    return response


async def login_user(
    client: httpx.AsyncClient, *, email: str = EMAIL, mode: AuthMode = "cookie"
) -> httpx.Response:
    response = await client.post(
        "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": mode}
    )
    assert response.status_code == 200
    return response


async def create_user(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    clock: FixedClock,
    *,
    email: str = EMAIL,
    role: UserRole = UserRole.USER,
    password: str | None = PASSWORD,
) -> User:
    async with session_factory() as db:
        user = User(
            id=uuid7(),
            email=email,
            password_hash=hash_password(password, settings) if password is not None else None,
            role=role.value,
            email_verified_at=clock.now(),
            created_at=clock.now(),
            updated_at=clock.now(),
        )
        db.add(user)
        await db.commit()
        return user


def cookie_headers(response: httpx.Response) -> dict[str, str]:
    return {"X-CSRF-Token": CookieOut.model_validate(response.json()).csrf_token}


def bearer_headers(response: httpx.Response) -> dict[str, str]:
    return {"Authorization": "Bearer " + BearerOut.model_validate(response.json()).access_token}
