"""Shared test doubles and settings for the API packages.

Nothing here is used at runtime. The ES256 key pair is created once per test process and
never written to disk.
"""

import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import SecretStr

from app.core.deps import OutgoingMail
from app.core.settings import Settings


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
