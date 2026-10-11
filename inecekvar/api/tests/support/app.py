"""Shared test doubles and settings for the API packages.

Nothing here is used at runtime. The ES256 key pair is created once per test process and
never written to disk.
"""

import math
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from pydantic import SecretStr
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.deps import OutgoingMail, RateLimitDecision, Services
from app.core.settings import RateLimitRule, Settings
from app.main import create_app


@dataclass(frozen=True, slots=True)
class KeyPair:
    private_pem: str
    public_pem: str


def new_es256_key_pair() -> KeyPair:
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return KeyPair(private_pem=private_pem, public_pem=public_pem)


@cache
def session_key_pair() -> KeyPair:
    return new_es256_key_pair()


@cache
def _session_secrets() -> tuple[str, str]:
    return secrets.token_urlsafe(32), secrets.token_urlsafe(32)


def make_test_settings(**overrides: Any) -> Settings:
    """Settings for env=test with fresh keys and secrets; `overrides` win.

    `database_url` and `redis_url` default to closed local ports: tests that touch a database or
    Redis pass the real URL from their fixture.
    """
    keys = session_key_pair()
    csrf_secret, log_hash_key = _session_secrets()
    values: dict[str, Any] = {
        "env": "test",
        "database_url": SecretStr("postgresql+asyncpg://unused@127.0.0.1:1/unused"),
        "redis_url": SecretStr("redis://127.0.0.1:1/0"),
        "jwt_private_key_pem": SecretStr(keys.private_pem),
        "jwt_public_key_pem": keys.public_pem,
        "csrf_secret": SecretStr(csrf_secret),
        "log_hash_key": SecretStr(log_hash_key),
        "hibp_enabled": False,
        "magic_link_base_url": "https://app.inecekvar.app/giris/baglanti",
    }
    values.update(overrides)
    return Settings(**values)


@dataclass(slots=True)
class FixedClock:
    """A controllable clock: `advance` moves time forward."""

    current: datetime = field(default_factory=lambda: datetime(2026, 10, 12, 9, 0, tzinfo=UTC))

    def now(self) -> datetime:
        return self.current

    def advance(self, **delta: float) -> None:
        self.current = self.current + timedelta(**delta)


@dataclass(slots=True)
class RecordingMailSender:
    """Keeps every message in memory instead of sending it."""

    sent: list[OutgoingMail] = field(default_factory=list)

    async def send(self, mail: OutgoingMail) -> None:
        self.sent.append(mail)


@dataclass(slots=True)
class StaticBreachChecker:
    """Reports exactly the passwords in `breached` as breached."""

    breached: frozenset[str] = frozenset()
    calls: list[str] = field(default_factory=list)

    async def is_breached(self, password: str) -> bool:
        self.calls.append(password)
        return password in self.breached


class InMemoryRateLimiter:
    """Sliding-window limiter over a dict; a stand-in where Redis is not the subject."""

    def __init__(self, rules: Mapping[str, RateLimitRule], clock: FixedClock) -> None:
        self._rules = dict(rules)
        self._clock = clock
        self._hits: dict[tuple[str, str], list[float]] = {}

    async def hit(self, rule: str, subject: str) -> RateLimitDecision:
        limit = self._rules[rule]
        now = self._clock.now().timestamp()
        window = [t for t in self._hits.get((rule, subject), []) if t > now - limit.window_seconds]
        if len(window) >= limit.limit:
            self._hits[(rule, subject)] = window
            retry_after = math.ceil(window[0] + limit.window_seconds - now)
            return RateLimitDecision(allowed=False, remaining=0, retry_after_seconds=retry_after)
        window.append(now)
        self._hits[(rule, subject)] = window
        return RateLimitDecision(
            allowed=True, remaining=limit.limit - len(window), retry_after_seconds=0
        )


class PeerClientIpMiddleware:
    """Test-only: sets `request.state.client_ip` from the ASGI peer (pass `client=` to
    `httpx.ASGITransport` to choose it). The production middleware lives in `app.core`."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            client = scope.get("client")
            scope.setdefault("state", {})["client_ip"] = client[0] if client else "127.0.0.1"
        await self.app(scope, receive, send)


def build_test_app(services: Services, *, peer_ip_middleware: bool = True) -> FastAPI:
    """The real `create_app` composition with the given services."""
    application = create_app(services=services)
    if peer_ip_middleware:
        application.add_middleware(PeerClientIpMiddleware)
    return application
