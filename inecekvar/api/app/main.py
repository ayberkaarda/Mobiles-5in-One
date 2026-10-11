"""ASGI entry point: `uv run uvicorn app.main:app --reload`."""

from fastapi import FastAPI

from app.core.health import router as health_router


def create_app() -> FastAPI:
    application = FastAPI(title="İnecek Var API", version="0.1.0")
    application.include_router(health_router, prefix="/v1")
    return application


app = create_app()
