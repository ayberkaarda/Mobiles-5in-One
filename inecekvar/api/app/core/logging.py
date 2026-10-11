"""JSON logging with recursive privacy filtering and one event per HTTP request."""

import hashlib
import hmac
import logging.config
import re
import time
from collections.abc import Callable, MutableMapping
from typing import Any, cast
from urllib.parse import unquote

import structlog
from pydantic import SecretStr
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.client_ip import resolve_client_ip
from app.core.settings import Settings

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_COORDINATE = re.compile(r"([?&](?:lat|lng|lon)=)(-?\d+\.\d{4,})(?=[&#\s\"']|$)", re.I)
_PRIVATE_PATH = re.compile(r"(/v1/(?:auth/[^?\s\"']*|traces[^?\s\"']*))\?[^\s\"']*")
_HEADER_VALUE = re.compile(
    r"\b(authorization|cookie|set-cookie|x-csrf-token)\s*[:=]\s*[^\r\n]+", re.I
)
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
    }
)
_COORDINATE_KEYS = frozenset({"lat", "lng", "lon", "latitude", "longitude"})
Processor = Callable[[Any, str, MutableMapping[str, Any]], MutableMapping[str, Any]]


def hash_for_log(settings: Settings, value: str) -> str:
    return hmac.new(
        settings.require_secret("log_hash_key"), value.strip().lower().encode(), hashlib.sha256
    ).hexdigest()[:16]


def mask_sensitive(settings: Settings) -> Processor:
    settings.require_secret("log_hash_key")

    def text(value: str) -> str:
        value = unquote(value)
        value = _PRIVATE_PATH.sub(r"\1", value)
        value = _HEADER_VALUE.sub(r"\1: [redacted]", value)
        value = _COORDINATE.sub(lambda match: match[1] + f"{float(match[2]):.3f}", value)
        return _EMAIL.sub(lambda match: "email_hash=" + hash_for_log(settings, match[0]), value)

    def clean(value: object, key: str = "") -> object:
        if isinstance(value, dict):
            result: dict[str, object] = {}
            for name, item in value.items():
                label = str(name)
                lower = label.lower()
                if lower in _DROP:
                    continue
                if lower == "email":
                    result["email_hash"] = hash_for_log(settings, str(item))
                else:
                    result[text(label)] = clean(item, lower)
            return result
        if isinstance(value, (list, tuple)):
            return [clean(item, key) for item in value]
        if isinstance(value, float) and key in _COORDINATE_KEYS:
            return round(value, 3)
        if isinstance(value, str):
            return text(value)
        return value

    def processor(
        logger: Any, method_name: str, event_dict: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        return cast(MutableMapping[str, Any], clean(dict(event_dict)))

    return processor


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
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "json",
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
            query = scope.get("query_string", b"").decode("latin-1")
            path = scope["path"] + ("?" + query if query else "")
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
