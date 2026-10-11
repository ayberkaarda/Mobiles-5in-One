import io
import logging
import sys
from collections.abc import Iterator

import pytest
import structlog

from app.core.logging import configure_logging, hash_for_log, mask_sensitive
from app.core.settings import Settings


@pytest.fixture
def log_stream(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Iterator[io.StringIO]:
    stream = io.StringIO()
    root = logging.getLogger()
    old_handlers, old_level = root.handlers[:], root.level
    old_config = structlog.get_config()
    loggers = [logging.getLogger(name) for name in ("uvicorn", "uvicorn.error", "uvicorn.access")]
    previous = [(logger.handlers[:], logger.level, logger.propagate) for logger in loggers]
    monkeypatch.setattr(sys, "stdout", stream)
    configure_logging(settings)
    try:
        yield stream
    finally:
        for handler in root.handlers:
            handler.close()
        root.handlers = old_handlers
        root.setLevel(old_level)
        for logger, (handlers, level, propagate) in zip(loggers, previous, strict=True):
            logger.handlers = handlers
            logger.setLevel(level)
            logger.propagate = propagate
        structlog.configure(**old_config)


@pytest.mark.parametrize(
    ("sample", "expected"),
    [
        ({"Password": "secret", "Authorization": "Bearer private"}, {}),
        ({"headers": {"Cookie": "private", "Set-Cookie": "private"}}, {"headers": {}}),
        ({"nested": [{"token": "private", "lat": 41.0123456}]}, {"nested": [{"lat": 41.012}]}),
        (
            {"longitude": 29.0987654, "latitude": 41.0123456},
            {"longitude": 29.099, "latitude": 41.012},
        ),
        ({"path": "/v1/auth/login?email=a@b.example&token=private"}, {"path": "/v1/auth/login"}),
        ({"path": "/v1/traces?lat=41.0123456"}, {"path": "/v1/traces"}),
        (
            {"path": "/v1/near?lat=41.0123456&lng=29.0987654"},
            {"path": "/v1/near"},
        ),
        ({"path": "/v1/near?lon=-29.0987654"}, {"path": "/v1/near"}),
        ({"path": "/v1/auth/login?x=%20&token=private"}, {"path": "/v1/auth/login"}),
        ({"path": "/v1/near?q=%22&token=private"}, {"path": "/v1/near"}),
    ],
)
def test_mask_sensitive_unit(
    settings: Settings, sample: dict[str, object], expected: dict[str, object]
) -> None:
    assert mask_sensitive(settings)(None, "info", sample) == expected


def test_email_hash_recursive(settings: Settings) -> None:
    result = mask_sensitive(settings)(
        None,
        "info",
        {"EMAIL": " A@B.Example ", "event": "login a@b.example", "items": ["a@b.example"]},
    )
    digest = hash_for_log(settings, "a@b.example")
    assert result == {
        "email_hash": digest,
        "event": "login email_hash=" + digest,
        "items": ["email_hash=" + digest],
    }
    assert len(digest) == 16
    assert "@" not in str(result)


def test_uvicorn_access_log_masked(log_stream: io.StringIO) -> None:
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d',
        "203.0.113.10:50000",
        "GET",
        "/v1/near?email=a@b.example&lat=41.0123456",
        "1.1",
        200,
    )
    line = log_stream.getvalue()
    assert "a@b.example" not in line
    assert "@" not in line
    assert "41.0123456" not in line
    assert "?" not in line
    assert "203.0.113.10" not in line
    assert "client_ip_hash=" in line
