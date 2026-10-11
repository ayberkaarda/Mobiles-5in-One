"""ASGI entry point: `uv run uvicorn app.main:app --reload`.

`create_app` is the only composition root. It stores the `Services` container on
`app.state.services` and mounts every router of `ROUTERS` under `/v1`. Tests pass their own
settings and services; the module-level `app` reads the environment.
"""

from fastapi import APIRouter, FastAPI

from app.core.deps import Services
from app.core.health import router as health_router
from app.core.settings import Settings, load_settings

API_PREFIX = "/v1"

# Fixed registration list: routers are mounted in this order and nowhere else.
ROUTERS: tuple[APIRouter, ...] = (health_router,)


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    resolved = services.settings if services is not None else (settings or load_settings())
    application = FastAPI(
        title="İnecek Var API",
        version="0.1.0",
        docs_url=None if resolved.env == "production" else "/docs",
        redoc_url=None,
        openapi_url=None if resolved.env == "production" else "/openapi.json",
    )
    application.state.settings = resolved
    application.state.services = services
    for router in ROUTERS:
        application.include_router(router, prefix=API_PREFIX)
    return application


app = create_app()
