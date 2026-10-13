"""JSON logging with recursive privacy filtering and one event per HTTP request.

The scrub (spec section 6 item 14, ADR-0010, ADR-0054) drops the keys in `_DROP`, hashes email
addresses with the keyed digest, strips query strings, redacts header values, bearer and basic
credentials and JSON Web Tokens inside text, drops coordinate collections (`coordinates`,
`points`, `geometry`, ...) and rounds coordinates, two-number pairs and long decimal pairs in
text to three decimals. The same cleaner backs `scrub_event`, the `before_send` hook of an
error reporting SDK, which is initialised only when `INECEKVAR_SENTRY_DSN` is set and the SDK
is installed (neither is the case in this repository: docs/ops/logging.md).
"""

import hashlib
import hmac
import importlib
import logging.config
import re
import time
from collections.abc import Callable, MutableMapping
from types import ModuleType
from typing import Any, cast
from urllib.parse import unquote

import structlog
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.client_ip import resolve_client_ip
from app.core.settings import Settings

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_COORDINATE = re.compile(r"([?&](?:lat|lng|lon)=)(-?\d+\.\d{4,})(?=[&#\s\"']|$)", re.I)
# Query strings are never logged: they can carry tokens, emails or exact coordinates.
# An encoded question mark (%3F) starts a query too, so decoding cannot reveal one later.
_QUERY = re.compile(r"(/[^\s\"?]*?)(?:\?|%3[Ff])[^\s\"]*")
_HEADER_VALUE = re.compile(
    r"\b(authorization|proxy-authorization|cookie|set-cookie|x-csrf-token)\s*[:=]\s*[^\r\n]+",
    re.I,
)
_CREDENTIAL = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}", re.I)
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+")
# Two decimals with four or more places separated by a comma: a coordinate pair in text.
_DECIMAL_PAIR = re.compile(r"(-?\d{1,3}\.\d{4,})(\s*,\s*)(-?\d{1,3}\.\d{4,})")
_DROP = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-csrf-token",
        "csrf_token",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "session",
        "body",
        "email_token",
        "secret",
        "totp_secret",
        "otpauth_uri",
        "code",
        "totp_code",
        "totp_secret_enc",
        "signature",
        "svix_signature",
        "api_key",
        "x-api-key",
        "proxy-authorization",
        "cookies",
        "id_token",
        "client_secret",
        "private_key",
        "password_hash",
        "webhook_secret",
        "dsn",
    }
)
_COORDINATE_KEYS = frozenset({"lat", "lng", "lon", "latitude", "longitude"})
# Collections under these keys are dropped whole; a number under the same key (a count) stays.
_GEOMETRY_KEYS = frozenset(
    {"coordinates", "points", "geometry", "polyline", "trace_points", "location", "locations"}
)
Processor = Callable[[Any, str, MutableMapping[str, Any]], MutableMapping[str, Any]]


def hash_for_log(settings: Settings, value: str) -> str:
    return hmac.new(
        settings.require_secret("log_hash_key"), value.strip().lower().encode(), hashlib.sha256
    ).hexdigest()[:16]


def _round_pair(match: re.Match[str]) -> str:
    return f"{float(match[1]):.3f}{match[2]}{float(match[3]):.3f}"


class Scrubber:
    """Recursive cleaner of log events and error reports; `email` decides how addresses read."""

    def __init__(self, email: Callable[[str], str]) -> None:
        self.email = email

    def text(self, value: str) -> str:
        # Strip queries before and after decoding, so an encoded space or quote cannot end
        # the match early and leave the rest of the query in the line.
        value = _QUERY.sub(r"\1", value)
        value = unquote(value)
        value = _QUERY.sub(r"\1", value)
        value = _HEADER_VALUE.sub(r"\1: [redacted]", value)
        value = _CREDENTIAL.sub(r"\1 [redacted]", value)
        value = _JWT.sub("[redacted-jwt]", value)
        value = _COORDINATE.sub(lambda match: match[1] + f"{float(match[2]):.3f}", value)
        value = _DECIMAL_PAIR.sub(_round_pair, value)
        return _EMAIL.sub(lambda match: self.email(match[0]), value)

    def clean(self, value: object, key: str = "") -> object:
        if isinstance(value, dict):
            result: dict[str, object] = {}
            for name, item in value.items():
                label = str(name)
                lower = label.lower()
                if lower in _DROP:
                    continue
                if lower in _GEOMETRY_KEYS and isinstance(item, (dict, list, tuple)):
                    continue
                if lower == "email":
                    result["email_hash"] = self.email(str(item)).removeprefix("email_hash=")
                else:
                    result[self.text(label)] = self.clean(item, lower)
            return result
        if isinstance(value, (list, tuple)):
            if len(value) == 2 and all(type(item) is float for item in value):
                # A pair of floats is treated as a coordinate: three decimals at most.
                return [round(cast(float, item), 3) for item in value]
            return [self.clean(item, key) for item in value]
        if isinstance(value, float) and key in _COORDINATE_KEYS:
            return round(value, 3)
        if isinstance(value, str):
            return self.text(value)
        return value


def mask_sensitive(settings: Settings) -> Processor:
    settings.require_secret("log_hash_key")
    scrubber = Scrubber(lambda address: "email_hash=" + hash_for_log(settings, address))

    def processor(
        logger: Any, method_name: str, event_dict: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        return cast(MutableMapping[str, Any], scrubber.clean(dict(event_dict)))

    return processor


# --- Error reports (spec section 6 item 14: Sentry `beforeSend` scrub) ----------------------

_EVENT_SCRUBBER = Scrubber(lambda address: "[email]")
# Request parts an error report never carries: bodies, cookies, query strings, environment.
_REQUEST_DROP = ("data", "cookies", "query_string", "env")


def scrub_event(event: dict[str, Any], hint: object | None = None) -> dict[str, Any] | None:
    """`before_send` for an error reporting SDK: the log scrub plus request and user rules.

    Keeps only the user id, drops request bodies, cookies and query strings, and runs every
    other value (messages, exception values, breadcrumbs, frame variables, headers, URLs)
    through the same cleaner as the logs, with addresses replaced by `[email]`.
    """
    cleaned = cast(dict[str, Any], _EVENT_SCRUBBER.clean(event))
    request = cleaned.get("request")
    if isinstance(request, dict):
        for name in _REQUEST_DROP:
            request.pop(name, None)
    user = cleaned.get("user")
    if isinstance(user, dict):
        cleaned["user"] = {"id": user["id"]} if "id" in user else {}
    cleaned.pop("server_name", None)
    return cleaned


class ErrorReportingSettings(BaseSettings):
    """`INECEKVAR_SENTRY_*`: unset means no error reporting and no SDK import."""

    model_config = SettingsConfigDict(
        env_prefix="INECEKVAR_SENTRY_", extra="ignore", frozen=True, case_sensitive=False
    )

    dsn: SecretStr | None = None
    environment: str = "production"


Importer = Callable[[str], ModuleType]


def init_error_reporting(
    config: ErrorReportingSettings, importer: Importer = importlib.import_module
) -> bool:
    """Initialise the SDK with `scrub_event` only when a DSN is configured and it is installed.

    No DSN: nothing is imported. A DSN without the SDK logs one warning and reports nothing.
    """
    if config.dsn is None:
        return False
    try:
        sdk = importer("sentry_sdk")
    except ImportError:
        structlog.get_logger().warning("error_reporting.sdk_missing")
        return False
    sdk.init(
        dsn=config.dsn.get_secret_value(),
        environment=config.environment,
        before_send=scrub_event,
        send_default_pii=False,
        include_local_variables=False,
    )
    return True


def json_formatter(log_hash_key: str) -> structlog.stdlib.ProcessorFormatter:
    """Factory usable by stdlib dictConfig and a serialized uvicorn log config."""
    settings = Settings(env="local", log_hash_key=SecretStr(log_hash_key))
    return structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
        ],
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            mask_sensitive(settings),
            structlog.processors.JSONRenderer(),
        ],
    )


class UvicornAccessFilter(logging.Filter):
    """Replaces the client address of uvicorn access records by its keyed digest before the
    record is formatted; the path is masked by the formatter like any other text."""

    def __init__(self, log_hash_key: str) -> None:
        super().__init__()
        self.settings = Settings(env="local", log_hash_key=SecretStr(log_hash_key))

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == "uvicorn.access" and isinstance(record.args, tuple) and record.args:
            client = str(record.args[0])
            host = client.rsplit(":", 1)[0] if ":" in client else client
            digest = "client_ip_hash=" + hash_for_log(self.settings, host)
            record.args = (digest, *record.args[1:])
        return True


def uvicorn_log_config(settings: Settings) -> dict[str, object]:
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": "app.core.logging.json_formatter",
                "log_hash_key": settings.require_secret("log_hash_key").decode(),
            },
        },
        "filters": {
            "uvicorn_access": {
                "()": "app.core.logging.UvicornAccessFilter",
                "log_hash_key": settings.require_secret("log_hash_key").decode(),
            },
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "json",
                "filters": ["uvicorn_access"],
            },
        },
        "root": {"handlers": ["stdout"], "level": settings.log_level},
        "loggers": {
            name: {"handlers": [], "level": settings.log_level, "propagate": True}
            for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
        },
    }


def configure_logging(settings: Settings) -> None:
    logging.config.dictConfig(uvicorn_log_config(settings))
    init_error_reporting(ErrorReportingSettings())
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,
    )


class AccessLogMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings
        self.mask = mask_sensitive(settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def track_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, track_status)
        finally:
            client = scope.get("client")
            client_ip = scope.get("state", {}).get("client_ip")
            if not isinstance(client_ip, str):
                client_ip = resolve_client_ip(
                    client[0] if client else None, Headers(scope=scope), self.settings
                )
            path = scope["path"].split("?", 1)[0]
            event = self.mask(
                None,
                "info",
                {
                    "method": scope["method"],
                    "path": path,
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                    "client_ip_hash": hash_for_log(self.settings, client_ip),
                },
            )
            structlog.get_logger().info("http.request", **event)
