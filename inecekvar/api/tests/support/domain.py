import uuid

import httpx
from fastapi import FastAPI

from app.auth.passwords import hash_password
from app.auth.router import router as auth_router
from app.auth.schemas import BearerOut
from app.cities.router import router as cities_router
from app.core.deps import Services
from app.core.ids import uuid7
from app.edits.router import router as edits_router
from app.favorites.router import router as favorites_router
from app.lines.router import router as lines_router
from app.models import User
from app.models.enums import UserRole
from app.moderation.router import router as moderation_router
from app.seed.sample_city import seed_sample_city
from app.stops.router import router as stops_router
from tests.support.app import build_test_app
from tests.support.routes import has_route

PASSWORD = "domain-password-42"


async def create_account(
    services: Services,
    role: UserRole = UserRole.CONTRIBUTOR,
    *,
    licence_accepted: bool = True,
    reputation: int = 0,
) -> tuple[uuid.UUID, str]:
    identity = uuid7()
    email = identity.hex + "@example.com"
    async with services.session_factory() as db:
        db.add(
            User(
                id=identity,
                email=email,
                display_name="Katkıcı",
                role=role.value,
                password_hash=await hash_password(PASSWORD, services.settings),
                email_verified_at=services.clock.now(),
                reputation=reputation,
                licence_accepted_at=services.clock.now() if licence_accepted else None,
                created_at=services.clock.now(),
                updated_at=services.clock.now(),
            )
        )
        await db.commit()
    return identity, email


async def sign_in(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/v1/auth/login",
        json={
            "email": email,
            "password": PASSWORD,
            "mode": "bearer",
        },
    )
    assert response.status_code == 200
    return {"Authorization": "Bearer " + BearerOut.model_validate(response.json()).access_token}


async def seed_city(services: Services) -> None:
    async with services.session_factory() as db:
        await seed_sample_city(db)
        await db.commit()


def domain_app(services: Services) -> FastAPI:
    application = build_test_app(services)
    for router, path in (
        (auth_router, "/v1/auth/login"),
        (cities_router, "/v1/cities"),
        (lines_router, "/v1/lines"),
        (stops_router, "/v1/stops/near"),
        (edits_router, "/v1/edits"),
        (moderation_router, "/v1/moderation/edits"),
        (favorites_router, "/v1/me/favorites"),
    ):
        if not has_route(application, path):
            application.include_router(router, prefix="/v1")
    return application


def trace_media_app(services: Services) -> FastAPI:
    from app.media.router import router as media_router
    from app.traces.router import router as traces_router

    application = domain_app(services)
    for router, path in ((traces_router, "/v1/traces"), (media_router, "/v1/media/presign")):
        if not has_route(application, path):
            application.include_router(router, prefix="/v1")
    return application
