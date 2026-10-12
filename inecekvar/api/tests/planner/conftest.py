from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from app.core.deps import Services
from app.planner.router import router
from tests.domain.conftest import clock, services, session_factory
from tests.support.domain import seed_city, trace_media_app
from tests.support.fixtures import migrated_url
from tests.support.routes import has_route

__all__ = ["clock", "migrated_url", "services", "session_factory"]


def planner_app(services: Services) -> FastAPI:
    application = trace_media_app(services)
    if not has_route(application, "/v1/plan"):
        application.include_router(router, prefix="/v1")
    return application


@pytest.fixture
async def planner_client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    await seed_city(services)
    transport = httpx.ASGITransport(app=planner_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        yield client
