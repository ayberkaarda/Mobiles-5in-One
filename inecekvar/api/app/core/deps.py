"""Typed FastAPI dependencies and the service interfaces the packages share.

`create_app` stores one `Services` object on `app.state.services`; every dependency below reads
from it, so tests replace any collaborator by passing it to `create_app`. Packages implement the
Protocols (1B: `Authenticator`, `MailSender`, `BreachChecker`; 1C: `RateLimiter` and the
middleware that sets `request.state.client_ip` and `request.state.request_id`).
"""

import base64
import hashlib
import hmac
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal, Protocol, runtime_checkable

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.revenuecat import SubscriberDirectory
from app.core.errors import (
    AUTH_FORBIDDEN,
    AUTH_REQUIRED,
    CSRF_INVALID,
    ORIGIN_NOT_ALLOWED,
    RATE_LIMITED,
    ProblemError,
)
from app.core.settings import Settings
from app.core.storage import ObjectStore
from app.models.enums import UserRole

AuthMode = Literal["cookie", "bearer"]
SAFE_METHODS: frozenset[str] = frozenset({"GET", "HEAD", "OPTIONS"})


# --- Shared value types ----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated caller. `role` is read from the database on every request.

    `session_id` is `sessions.id` in cookie mode and the refresh token family id (the access
    token `sid` claim) in bearer mode.
    """

    user_id: uuid.UUID
    role: UserRole
    session_id: uuid.UUID
    auth_mode: AuthMode


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after_seconds: int


MailCategory = Literal["security", "transactional"]


@dataclass(frozen=True, slots=True)
class OutgoingMail:
    """`security`: sign-in links and account notices the recipient asked for just now;
    `transactional`: every other message (ADR-0050 decides how suppression treats each)."""

    to: str
    subject: str
    text: str
    category: MailCategory = "transactional"


# --- Service interfaces ------------------------------------------------------------------------


class Clock(Protocol):
    def now(self) -> datetime:
        """Timezone-aware current time (UTC)."""
        ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class RateLimiter(Protocol):
    async def hit(self, rule: str, subject: str) -> RateLimitDecision:
        """Record one hit for `subject` under the named rule and decide.

        `subject` is a typed key such as `ip:203.0.113.7`, `email:<normalized>` or
        `family:<uuid>`; implementations store only a keyed digest of it.
        """
        ...


class MailSender(Protocol):
    async def send(self, mail: OutgoingMail) -> None: ...


class BreachChecker(Protocol):
    async def is_breached(self, password: str) -> bool:
        """True when the password appears in the breach corpus (k-anonymity range query)."""
        ...


@runtime_checkable
class Authenticator(Protocol):
    async def authenticate(self, request: Request, db: AsyncSession) -> Principal | None:
        """Resolve the caller from `Authorization: Bearer` (wins) or the session cookie.

        Returns None when no credential is present; raises `ProblemError(AUTH_REQUIRED, 401)`
        when a credential is present but invalid, expired, revoked or its user is deactivated.
        """
        ...


class EntitlementSource(Protocol):
    async def has_plus(self, db: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
        """True when the user holds an active Plus entitlement at `now` (spec section 3 story 8)."""
        ...


class StepUpSource(Protocol):
    async def step_up_at(self, db: AsyncSession, principal: Principal) -> datetime | None:
        """When this session last passed a verified TOTP step-up, or None (spec section 6.18)."""
        ...


class JobQueue(Protocol):
    async def enqueue(self, function: str, *args: str, job_id: str) -> None:
        """Queue `function(*args)` for the worker; `job_id` deduplicates queued jobs."""
        ...


class SubscriberDeleter(Protocol):
    async def delete_subscriber(self, app_user_id: str) -> None:
        """Remove the subscriber at the billing provider (spec section 6.21); raises on failure."""
        ...


@dataclass(slots=True)
class Services:
    settings: Settings
    session_factory: async_sessionmaker[AsyncSession]
    redis: Redis
    rate_limiter: RateLimiter
    authenticator: Authenticator
    mail_sender: MailSender
    breach_checker: BreachChecker
    clock: Clock
    # Optional collaborators. Production configures session-bound step-up storage.
    # None means "not configured" and every consumer fails closed:
    # no object store answers 503, no entitlement source grants no Plus, no step-up source
    # denies destructive moderation, no subscriber deleter defers erasure of subscribers.
    object_store: ObjectStore | None = None
    entitlements: EntitlementSource | None = None
    step_up: StepUpSource | None = None
    subscriber_deleter: SubscriberDeleter | None = None
    # RevenueCat REST (reconciliation, transfers); None skips reconciliation.
    revenuecat: SubscriberDirectory | None = None
    # Background job trigger; None (or a failing queue) leaves stored webhook events to the
    # worker's pending-event sweep.
    job_queue: JobQueue | None = None


# --- Basic dependencies ---------------------------------------------------------------------


def get_services(request: Request) -> Services:
    services = getattr(request.app.state, "services", None)
    if not isinstance(services, Services):
        raise RuntimeError("app.state.services is not configured")
    return services


ServicesDep = Annotated[Services, Depends(get_services)]


def get_settings(services: ServicesDep) -> Settings:
    return services.settings


async def get_db(services: ServicesDep) -> AsyncIterator[AsyncSession]:
    """One session per request; handlers commit explicitly, anything uncommitted rolls back."""
    async with services.session_factory() as session:
        yield session


def get_redis(services: ServicesDep) -> Redis:
    return services.redis


def get_rate_limiter(services: ServicesDep) -> RateLimiter:
    return services.rate_limiter


def get_clock(services: ServicesDep) -> Clock:
    return services.clock


def get_mail_sender(services: ServicesDep) -> MailSender:
    return services.mail_sender


def get_breach_checker(services: ServicesDep) -> BreachChecker:
    return services.breach_checker


STORAGE_UNAVAILABLE = "storage.unavailable"


def get_object_store(services: ServicesDep) -> ObjectStore:
    """The configured object store; 503 when the deployment has none."""
    if services.object_store is None:
        raise ProblemError(STORAGE_UNAVAILABLE, 503)
    return services.object_store


def get_client_ip(request: Request) -> str:
    """The trusted client IP set by the 1C middleware; fails closed when it is missing."""
    value = getattr(request.state, "client_ip", None)
    if not isinstance(value, str) or not value:
        raise RuntimeError("request.state.client_ip is not set by the client IP middleware")
    return value


def get_request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) and value else "unknown"


SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[AsyncSession, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]
RateLimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]
ClockDep = Annotated[Clock, Depends(get_clock)]
MailSenderDep = Annotated[MailSender, Depends(get_mail_sender)]
BreachCheckerDep = Annotated[BreachChecker, Depends(get_breach_checker)]
ClientIpDep = Annotated[str, Depends(get_client_ip)]
RequestIdDep = Annotated[str, Depends(get_request_id)]
ObjectStoreDep = Annotated[ObjectStore, Depends(get_object_store)]


# --- Email normalization ---------------------------------------------------------------------


def normalize_email(email: str) -> str:
    """The canonical form stored in `users.email` and used as the rate-limit subject."""
    return email.strip().lower()


# --- Origin and CSRF ---------------------------------------------------------------------------


def check_cookie_origin(request: Request, settings: Settings) -> None:
    """Cookie mode is only for the web origins; a foreign or Capacitor Origin is refused.

    Requests without an Origin header (same-origin GET, server-side callers) pass.
    """
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cookie_origins:
        raise ProblemError(ORIGIN_NOT_ALLOWED, 403)


def csrf_token_for(settings: Settings, session_id: uuid.UUID) -> str:
    """Session-bound CSRF token: HMAC-SHA256(csrf_secret, "csrf:" + session id)."""
    digest = hmac.new(
        settings.require_secret("csrf_secret"),
        b"csrf:" + session_id.bytes,
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def verify_csrf(request: Request, settings: Settings, principal: Principal) -> None:
    """Cookie-mode mutations must echo the session's CSRF token in `X-CSRF-Token`."""
    if principal.auth_mode != "cookie" or request.method in SAFE_METHODS:
        return
    supplied = request.headers.get(settings.csrf_header_name)
    expected = csrf_token_for(settings, principal.session_id)
    if supplied is None or not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise ProblemError(CSRF_INVALID, 403)


# --- Principal dependencies --------------------------------------------------------------------


async def optional_principal(
    request: Request, services: ServicesDep, db: DbDep
) -> Principal | None:
    """The caller or None; cookie mode is origin-checked and CSRF-checked on mutations."""
    principal = await services.authenticator.authenticate(request, db)
    if principal is None:
        return None
    if principal.auth_mode == "cookie":
        check_cookie_origin(request, services.settings)
        verify_csrf(request, services.settings, principal)
    return principal


OptionalPrincipalDep = Annotated[Principal | None, Depends(optional_principal)]


async def current_principal(principal: OptionalPrincipalDep) -> Principal:
    if principal is None:
        raise ProblemError(AUTH_REQUIRED, 401, headers={"WWW-Authenticate": "Bearer"})
    return principal


PrincipalDep = Annotated[Principal, Depends(current_principal)]


def require_role(*roles: UserRole) -> Callable[[Principal], Awaitable[Principal]]:
    """Dependency factory: the caller must hold one of `roles` (fine-grained checks live in
    `app.security.policy`)."""
    allowed = frozenset(roles)
    if not allowed:
        raise ValueError("require_role needs at least one role")

    async def dependency(principal: PrincipalDep) -> Principal:
        if principal.role not in allowed:
            raise ProblemError(AUTH_FORBIDDEN, 403)
        return principal

    return dependency


def require_csrf(request: Request, settings: SettingsDep, principal: PrincipalDep) -> None:
    """Explicit form of the check `optional_principal` already applies; kept for routes that
    want the requirement visible in their signature."""
    verify_csrf(request, settings, principal)


# --- Rate limiting -------------------------------------------------------------------------------


async def enforce_rate_limit(limiter: RateLimiter, rule: str, subject: str) -> None:
    """Hit `rule` for `subject`; raise 429 with `Retry-After` when the window is full."""
    decision = await limiter.hit(rule, subject)
    if not decision.allowed:
        retry_after = max(1, decision.retry_after_seconds)
        raise ProblemError(RATE_LIMITED, 429, headers={"Retry-After": str(retry_after)})


def rate_limit(rule: str) -> Callable[[RateLimiter, str], Awaitable[None]]:
    """Dependency factory: one hit per request for the trusted client IP under `rule`.

    Per-email (or per-family) limits are applied in the handler after the body is parsed:
    `await enforce_rate_limit(limiter, rule, "email:" + normalize_email(body.email))`.
    """

    async def dependency(limiter: RateLimiterDep, client_ip: ClientIpDep) -> None:
        await enforce_rate_limit(limiter, rule, "ip:" + client_ip)

    return dependency
