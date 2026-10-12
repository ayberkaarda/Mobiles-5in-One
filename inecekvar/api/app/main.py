"""ASGI entry point: `uv run uvicorn app.main:app --reload`.

`create_app` is the only composition root. It installs the core baseline (`install_core`:
request id, access log, security headers, CORS, trusted client IP, body limits, problem
handlers), stores the `Services` container on `app.state.services` and mounts every router of
`ROUTERS` under `/v1`. Tests pass their own settings and services. The module attribute `app`
is built on first access (uvicorn's lookup), so importing this module has no side effects.
"""

import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, FastAPI
from pydantic import SecretStr
from redis.asyncio import Redis

from app.auth.authenticator import TokenSessionAuthenticator
from app.auth.hibp import HibpRangeClient
from app.auth.mail import SmtpMailSender
from app.auth.router import router as auth_router
from app.billing.entitlements import SubscriptionEntitlements
from app.cities.router import router as cities_router
from app.core.deps import Services, SystemClock
from app.core.health import router as health_router
from app.core.logging import configure_logging
from app.core.ratelimit import RedisSlidingWindowLimiter
from app.core.settings import Settings, load_settings
from app.core.setup import install_core
from app.core.storage import S3ObjectStore
from app.edits.router import router as edits_router
from app.export.router import router as export_router
from app.favorites.router import router as favorites_router
from app.lines.router import router as lines_router
from app.media.router import router as media_router
from app.models.session import create_engine, create_session_factory
from app.moderation.router import router as moderation_router
from app.planner.router import router as planner_router
from app.stops.router import router as stops_router
from app.traces.router import router as traces_router

API_PREFIX = "/v1"

# Fixed registration list: routers are mounted in this order and nowhere else.
ROUTERS: tuple[APIRouter, ...] = (
    health_router,
    auth_router,
    cities_router,
    lines_router,
    stops_router,
    edits_router,
    moderation_router,
    favorites_router,
    traces_router,
    media_router,
    planner_router,
    export_router,
)

# Local development only (the compose defaults of .env.example); `Settings` rejects missing
# values outside env=local, so these never reach test or production.
LOCAL_DATABASE_URL = "postgresql+asyncpg://inecekvar:inecekvar_local_dev@localhost:57432/inecekvar"
LOCAL_REDIS_URL = "redis://localhost:57379/0"
LOCAL_S3_URL = "http://localhost:57900"
LOCAL_S3_USER = "inecekvar"
LOCAL_S3_PASSWORD = "inecekvar_local_dev"  # noqa: S105 (compose default, local only)


def with_local_defaults(settings: Settings) -> Settings:
    """For env=local fill missing values with the compose URLs and per-process random secrets
    and keys, so a fresh checkout runs without any secret in the repository."""
    if settings.env != "local":
        return settings
    update: dict[str, object] = {}
    if settings.database_url is None:
        update["database_url"] = SecretStr(LOCAL_DATABASE_URL)
    if settings.redis_url is None:
        update["redis_url"] = SecretStr(LOCAL_REDIS_URL)
    if settings.s3_endpoint_url is None:
        update["s3_endpoint_url"] = LOCAL_S3_URL
        update["s3_region"] = "us-east-1"
        update["s3_access_key_id"] = SecretStr(LOCAL_S3_USER)
        update["s3_secret_access_key"] = SecretStr(LOCAL_S3_PASSWORD)
    if settings.csrf_secret is None:
        update["csrf_secret"] = SecretStr(secrets.token_urlsafe(32))
    if settings.log_hash_key is None:
        update["log_hash_key"] = SecretStr(secrets.token_urlsafe(32))
    no_private = settings.jwt_private_key_pem is None and settings.jwt_private_key_path is None
    no_public = settings.jwt_public_key_pem is None and settings.jwt_public_key_path is None
    if no_private and no_public:
        key = ec.generate_private_key(ec.SECP256R1())
        update["jwt_private_key_pem"] = SecretStr(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ).decode()
        )
        update["jwt_public_key_pem"] = (
            key.public_key()
            .public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
            .decode()
        )
    return settings.model_copy(update=update) if update else settings


def build_services(settings: Settings) -> Services:
    """The production collaborators. The engine and Redis connect lazily on first use."""
    if settings.database_url is None or settings.redis_url is None:
        raise RuntimeError("INECEKVAR_DATABASE_URL and INECEKVAR_REDIS_URL are required")
    engine = create_engine(settings.database_url.get_secret_value())
    redis = Redis.from_url(settings.redis_url.get_secret_value())
    clock = SystemClock()
    return Services(
        settings=settings,
        session_factory=create_session_factory(engine),
        redis=redis,
        rate_limiter=RedisSlidingWindowLimiter(
            redis, settings.rate_limit_rules, settings.require_secret("log_hash_key"), clock
        ),
        authenticator=TokenSessionAuthenticator(settings, clock),
        mail_sender=SmtpMailSender(settings),
        breach_checker=HibpRangeClient(settings),
        clock=clock,
        entitlements=SubscriptionEntitlements(),
        object_store=(
            S3ObjectStore.from_settings(settings) if settings.s3_endpoint_url is not None else None
        ),
    )


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    if services is None:
        services = build_services(with_local_defaults(settings or load_settings()))
    resolved = services.settings
    application = FastAPI(
        title="İnecek Var API",
        version="0.1.0",
        docs_url=None if resolved.env == "production" else "/docs",
        redoc_url=None,
        openapi_url=None if resolved.env == "production" else "/openapi.json",
    )
    application.state.settings = resolved
    application.state.services = services
    install_core(application, resolved)
    for router in ROUTERS:
        application.include_router(router, prefix=API_PREFIX)
    return application


def create_process_app() -> FastAPI:
    """Process entry: logging is configured once, before the app exists."""
    settings = with_local_defaults(load_settings())
    configure_logging(settings)
    return create_app(settings)


_process_app: FastAPI | None = None


def __getattr__(name: str) -> FastAPI:
    global _process_app
    if name != "app":
        raise AttributeError(name)
    if _process_app is None:
        _process_app = create_process_app()
    return _process_app
