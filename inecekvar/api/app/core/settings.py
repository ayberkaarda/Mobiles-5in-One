"""Application settings (spec section 6 items 1, 5, 8, 11, 12).

Every value comes from the process environment with the `INECEKVAR_` prefix; secrets have no
default and are never read from a file in the repository. Tests build a `Settings` object
directly (see `tests/support/app.py`) with a key pair created for the test session.
"""

import base64
import re
from dataclasses import dataclass
from functools import cached_property
from ipaddress import IPv4Network, IPv6Network, ip_network
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "test", "production"]


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    """At most `limit` hits inside any sliding window of `window_seconds`."""

    limit: int
    window_seconds: int


# Spec section 6.5. The auth rules apply per client IP and, separately, per normalized email
# (refresh: per IP and per token family). Edits, traces and plan are declared now and wired by
# the phase 2 endpoints.
RATE_LIMIT_RULES: dict[str, RateLimitRule] = {
    "auth.login": RateLimitRule(limit=5, window_seconds=15 * 60),
    "auth.register": RateLimitRule(limit=5, window_seconds=15 * 60),
    "auth.magic_link": RateLimitRule(limit=5, window_seconds=15 * 60),
    "auth.refresh": RateLimitRule(limit=5, window_seconds=15 * 60),
    "auth.step_up": RateLimitRule(limit=5, window_seconds=15 * 60),
    "edits.low_reputation": RateLimitRule(limit=10, window_seconds=24 * 60 * 60),
    "edits.default": RateLimitRule(limit=100, window_seconds=24 * 60 * 60),
    "traces": RateLimitRule(limit=20, window_seconds=24 * 60 * 60),
    "plan": RateLimitRule(limit=30, window_seconds=60),
    "public.stop_pairs": RateLimitRule(limit=60, window_seconds=60),
    "admin.export": RateLimitRule(limit=10, window_seconds=3600),
    # Spec section 6.7: photo presign quota per user; section 6.22: pack downloads per
    # anonymous hash (or signed-in user) per day.
    "media.presign": RateLimitRule(limit=20, window_seconds=24 * 60 * 60),
    "pack.download": RateLimitRule(limit=10, window_seconds=24 * 60 * 60),
}

# Reputation below this value uses `edits.low_reputation` (spec section 6.5).
EDITS_REPUTATION_THRESHOLD = 20

# Spec section 6.8. Cookie (credentialed) mode is allowed only for the two web origins; the
# Capacitor origins are bearer-only and never receive Access-Control-Allow-Credentials.
COOKIE_ORIGINS: tuple[str, ...] = ("https://inecekvar.app", "https://app.inecekvar.app")
BEARER_ORIGINS: tuple[str, ...] = ("capacitor://localhost", "https://localhost")
LOCAL_COOKIE_ORIGINS: tuple[str, ...] = ("http://localhost:4200", "http://localhost:8100")
CORS_METHODS: tuple[str, ...] = ("GET", "POST", "PUT", "PATCH", "DELETE")
CORS_REQUEST_HEADERS: tuple[str, ...] = (
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    "X-Request-ID",
    "X-Pack-Request",
)
CORS_EXPOSED_HEADERS: tuple[str, ...] = ("Retry-After", "X-Request-ID")
CORS_MAX_AGE_SECONDS = 600

IPNetwork = IPv4Network | IPv6Network


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="INECEKVAR_",
        extra="ignore",
        frozen=True,
        case_sensitive=False,
    )

    # Required: a missing INECEKVAR_ENV must never fall back to the local defaults.
    env: Environment

    # --- Storage -------------------------------------------------------------------------
    database_url: SecretStr | None = None
    redis_url: SecretStr | None = None

    # --- Access tokens (ES256, spec section 6.12) -----------------------------------------
    # Either the PEM text or a path to a PEM file outside the repository. Tests create a
    # P-256 key pair per session and pass the PEM text.
    jwt_private_key_pem: SecretStr | None = None
    jwt_private_key_path: Path | None = None
    jwt_public_key_pem: str | None = None
    jwt_public_key_path: Path | None = None
    jwt_issuer: str = "https://api.inecekvar.app"
    jwt_audience: str = "inecekvar-api"
    access_token_ttl_seconds: int = Field(default=15 * 60, ge=60, le=15 * 60)
    refresh_token_ttl_days: int = Field(default=30, ge=1, le=30)

    # --- Web session cookie and CSRF (spec section 6.12) ----------------------------------
    session_cookie_name: Literal["__Host-iv_session"] = "__Host-iv_session"
    session_ttl_days: int = Field(default=7, ge=1, le=7)
    csrf_cookie_name: Literal["__Host-iv_csrf"] = "__Host-iv_csrf"
    csrf_header_name: Literal["X-CSRF-Token"] = "X-CSRF-Token"
    # HMAC key that binds a CSRF token to one session; at least 32 bytes of entropy.
    csrf_secret: SecretStr | None = None
    totp_encryption_key: SecretStr | None = None
    totp_previous_encryption_key: SecretStr | None = None

    # --- Magic links (spec section 3 story 5, section 6.11) --------------------------------
    magic_link_ttl_minutes: int = Field(default=15, ge=1, le=15)
    # Where the emailed link points; the PWA route reads the token and calls the verify API.
    magic_link_base_url: str = "https://app.inecekvar.app/giris/baglanti"

    # --- Passwords (spec section 6.11) ------------------------------------------------------
    argon2_time_cost: int = Field(default=3, ge=1)
    argon2_memory_cost_kib: int = Field(default=65536, ge=8)
    argon2_parallelism: int = Field(default=1, ge=1)
    password_min_length: int = Field(default=10, ge=10)
    password_max_length: int = Field(default=128, ge=10, le=1024)
    # The k-anonymity range API host is fixed in code (no configurable URL, no redirects).
    hibp_enabled: bool = True
    hibp_timeout_seconds: float = Field(default=2.0, gt=0, le=10)

    # --- Mail (Mailpit locally, Resend SMTP later) -----------------------------------------
    smtp_host: str = "localhost"
    smtp_port: int = Field(default=57025, ge=1, le=65535)
    smtp_use_tls: bool = False
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    mail_from: str = "İnecek Var <no-reply@inecekvar.app>"

    # --- Client IP (spec section 6.5) -------------------------------------------------------
    # The header Caddy sets (`header_up X-Real-IP {remote_host}`) is honoured only when the
    # direct peer is inside one of these networks; X-Forwarded-For is never read.
    client_ip_header: str = "X-Real-IP"
    trusted_proxy_cidrs: tuple[str, ...] = ("127.0.0.1/32", "::1/128")

    # --- Request bodies (spec section 6.6) ---------------------------------------------------
    max_body_bytes: int = Field(default=1024 * 1024, ge=1024)
    max_trace_body_bytes: int = Field(default=2 * 1024 * 1024, ge=1024)

    # --- Object storage (S3 API: MinIO locally, Cloudflare R2 in production) --------------
    # Photos and exports. Without an endpoint the media and export features answer 503.
    s3_endpoint_url: str | None = None
    s3_region: str = "auto"
    s3_access_key_id: SecretStr | None = None
    s3_secret_access_key: SecretStr | None = None
    media_bucket: str = "inecekvar-media"
    exports_bucket: str = "inecekvar-exports"
    export_max_features: int = Field(default=50_000, ge=1)
    export_max_bytes: int = Field(default=50 * 1024 * 1024, ge=1)
    presign_ttl_seconds: int = Field(default=300, ge=30, le=900)
    # Spec section 6.7: photos are image/jpeg or image/webp up to 4 MiB.
    media_max_bytes: int = Field(default=4 * 1024 * 1024, ge=1024, le=4 * 1024 * 1024)

    # --- Planner (spec section 3 story 3, section 6.22) --------------------------------------
    planner_timeout_seconds: float = Field(default=3.0, gt=0, le=10)
    planner_cache_ttl_seconds: int = Field(default=600, ge=1, le=3600)
    stop_pairs_cache_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    stop_pairs_timeout_ms: int = Field(default=2000, ge=100, le=10000)

    # --- Offline packs and tiles (spec section 3 story 4) -------------------------------------
    # CDN base for `cities/{slug}/tiles.pmtiles`; the route answers 404 while it is unset.
    pmtiles_base_url: str | None = None

    # --- Retention (spec section 0 item 6, section 6.21) ---------------------------------------
    trace_retention_days: int = Field(default=30, ge=1, le=30)
    deletion_grace_days: int = Field(default=7, ge=1, le=30)

    # --- Logging (spec section 6.14) ---------------------------------------------------------
    # HMAC key for the email and identifier digests written to logs.
    log_hash_key: SecretStr | None = None
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("totp_encryption_key", "totp_previous_encryption_key")
    @classmethod
    def _valid_totp_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            _decode_totp_key(value)
        return value

    @field_validator("trusted_proxy_cidrs")
    @classmethod
    def _valid_networks(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            ip_network(item, strict=False)
        return value

    @field_validator("pmtiles_base_url")
    @classmethod
    def _https_tiles(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("https://"):
            raise ValueError("pmtiles_base_url must be https")
        return value.rstrip("/") if value is not None else None

    @field_validator("magic_link_base_url")
    @classmethod
    def _https_link(cls, value: str) -> str:
        if not (value.startswith("https://") or value.startswith("http://localhost")):
            raise ValueError("magic_link_base_url must be https (http only for localhost)")
        return value

    @model_validator(mode="after")
    def _secrets_present(self) -> Self:
        if self.env == "local":
            return self
        missing = [
            name
            for name, value in (
                ("database_url", self.database_url),
                ("redis_url", self.redis_url),
                ("csrf_secret", self.csrf_secret),
                ("log_hash_key", self.log_hash_key),
            )
            if value is None
        ]
        if self.jwt_private_key_pem is None and self.jwt_private_key_path is None:
            missing.append("jwt_private_key_pem|jwt_private_key_path")
        if self.jwt_public_key_pem is None and self.jwt_public_key_path is None:
            missing.append("jwt_public_key_pem|jwt_public_key_path")
        if self.env == "production" and self.totp_encryption_key is None:
            missing.append("totp_encryption_key")
        if missing:
            raise ValueError("missing required settings: " + ", ".join(missing))
        if self.env == "production" and not self.smtp_use_tls:
            raise ValueError("smtp_use_tls must be true in production (magic links travel by mail)")
        named = (("csrf_secret", self.csrf_secret), ("log_hash_key", self.log_hash_key))
        for name, secret in named:
            if secret is not None and len(secret.get_secret_value()) < 32:
                raise ValueError(name + " must be at least 32 characters")
        return self

    # --- Derived values ----------------------------------------------------------------------

    @cached_property
    def trusted_proxy_networks(self) -> tuple[IPNetwork, ...]:
        return tuple(ip_network(item, strict=False) for item in self.trusted_proxy_cidrs)

    @property
    def cookie_origins(self) -> tuple[str, ...]:
        """Origins allowed to use cookie mode (credentialed CORS)."""
        if self.env == "local":
            return COOKIE_ORIGINS + LOCAL_COOKIE_ORIGINS
        return COOKIE_ORIGINS

    @property
    def bearer_origins(self) -> tuple[str, ...]:
        """Origins allowed only without credentials (Capacitor shells)."""
        return BEARER_ORIGINS

    @property
    def rate_limit_rules(self) -> dict[str, RateLimitRule]:
        return dict(RATE_LIMIT_RULES)

    def jwt_private_key(self) -> bytes:
        return _pem(self.jwt_private_key_pem, self.jwt_private_key_path, "private")

    def totp_key(self) -> bytes:
        if self.totp_encryption_key is None:
            raise RuntimeError("TOTP encryption key is not configured")
        try:
            return _decode_totp_key(self.totp_encryption_key)
        except ValueError:
            raise RuntimeError("TOTP encryption key is invalid") from None

    def jwt_public_key(self) -> bytes:
        public = SecretStr(self.jwt_public_key_pem) if self.jwt_public_key_pem else None
        return _pem(public, self.jwt_public_key_path, "public")

    def totp_previous_key(self) -> bytes | None:
        if self.totp_previous_encryption_key is None:
            return None
        return _decode_totp_key(self.totp_previous_encryption_key)

    def require_secret(self, name: Literal["csrf_secret", "log_hash_key"]) -> bytes:
        value: SecretStr | None = getattr(self, name)
        if value is None:
            raise RuntimeError("INECEKVAR_" + name.upper() + " is not configured")
        return value.get_secret_value().encode()


def _decode_totp_key(secret: SecretStr) -> bytes:
    value = secret.get_secret_value()
    if re.fullmatch(r"[A-Za-z0-9_-]{43}=?", value) is None:
        raise ValueError("TOTP encryption key must encode exactly 32 bytes")
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError:
        raise ValueError("TOTP encryption key must encode exactly 32 bytes") from None
    if len(decoded) != 32:
        raise ValueError("TOTP encryption key must encode exactly 32 bytes")
    return decoded


def _pem(text: SecretStr | None, path: Path | None, kind: str) -> bytes:
    if text is not None:
        return text.get_secret_value().encode()
    if path is not None:
        return path.read_bytes()
    raise RuntimeError("the JWT " + kind + " key is not configured")


def load_settings() -> Settings:
    """Read the settings from the environment (used by `create_app` when none are passed)."""
    return Settings()
