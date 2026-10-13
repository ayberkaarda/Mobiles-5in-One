"""Scrub hook of logs and error reports (spec section 6 item 14, ADR-0054)."""

import io
import json
import types
from typing import Any

import pytest
import structlog
from pydantic import SecretStr
from structlog.testing import capture_logs

from app.core.logging import (
    ErrorReportingSettings,
    init_error_reporting,
    mask_sensitive,
    scrub_event,
)
from app.core.settings import Settings
from tests.core.test_logging import log_stream

__all__ = ["log_stream"]

# Built from parts so no literal reads as a credential.
JWT = ".".join(("eyJhbGciOiJFUzI1NiJ9", "eyJzdWIiOiIxMjM0NSJ9", "c2lnbmF0dXJlLXBhcnQ"))
OPAQUE = "-".join(("opak", "erisim", "anahtari", "0123456789"))


@pytest.mark.parametrize(
    ("sample", "expected"),
    [
        (
            {"detail": "header was Bearer " + OPAQUE + " end"},
            {"detail": "header was Bearer [redacted] end"},
        ),
        ({"detail": "basic " + OPAQUE}, {"detail": "basic [redacted]"}),
        ({"detail": "token " + JWT + " seen"}, {"detail": "token [redacted-jwt] seen"}),
        ({"detail": "Proxy-Authorization: x y z"}, {"detail": "Proxy-Authorization: [redacted]"}),
        (
            {"geometry": {"type": "LineString", "coordinates": [[29.1234567, 41.1234567]]}},
            {},
        ),
        ({"coordinates": [[29.1234567, 41.1234567], [29.2, 41.2]]}, {}),
        ({"trace_points": [{"lat": 41.1, "lng": 29.1}]}, {}),
        ({"location": (29.1234567, 41.1234567)}, {}),
        ({"points": 120, "location": "kadikoy"}, {"points": 120, "location": "kadikoy"}),
        ({"pair": [29.1234567, 41.1234567]}, {"pair": [29.123, 41.123]}),
        ({"pair": (29.1234567, -41.1234567)}, {"pair": [29.123, -41.123]}),
        ({"ids": [1, 2]}, {"ids": [1, 2]}),
        ({"flags": [True, 0.5]}, {"flags": [True, 0.5]}),
        ({"detail": "at 41.0123456, 29.0987654 now"}, {"detail": "at 41.012, 29.099 now"}),
        ({"detail": "at 41.0123456,29.0987654"}, {"detail": "at 41.012,29.099"}),
        ({"duration_ms": 12.34567}, {"duration_ms": 12.34567}),
        (
            {
                "x-api-key": "k",
                "id_token": "k",
                "client_secret": "k",
                "private_key": "k",
                "password_hash": "k",
                "webhook_secret": "k",
                "dsn": "k",
                "cookies": {"a": "b"},
                "kept": "yes",
            },
            {"kept": "yes"},
        ),
    ],
)
def test_scrub_rules(settings: Settings, sample: dict[str, object], expected: object) -> None:
    assert mask_sensitive(settings)(None, "info", sample) == expected


def test_scrub_applies_to_production_log_lines(log_stream: io.StringIO) -> None:
    structlog.get_logger().warning(
        "probe",
        detail="Authorization header Bearer " + OPAQUE,
        upstream="failed with " + JWT,
        trace={"coordinates": [[29.1234567, 41.1234567]]},
        pair=[41.0123456, 29.0987654],
        note="mail to a.person@example.com at 41.0123456, 29.0987654",
    )
    captured = log_stream.getvalue()
    line = json.loads(captured.strip().splitlines()[-1])
    assert line["event"] == "probe"
    assert OPAQUE not in captured
    assert JWT not in captured
    assert "@" not in captured
    assert "1234567" not in captured
    assert "0123456" not in captured
    assert line["pair"] == [41.012, 29.099]
    assert line["trace"] == {}


def sentry_event() -> dict[str, Any]:
    return {
        "event_id": "0f1e2d3c",
        "level": "error",
        "server_name": "api-host-1",
        "message": "login failed for a.person@example.com",
        "user": {"id": "u-1", "email": "a.person@example.com", "ip_address": "203.0.113.9"},
        "request": {
            "url": "https://api.inecekvar.app/v1/auth/magic-link/verify?token=" + OPAQUE,
            "method": "POST",
            "query_string": "token=" + OPAQUE,
            "data": {"password": "x", "token": OPAQUE},
            "cookies": {"__Host-iv_session": OPAQUE},
            "headers": {
                "Authorization": "Bearer " + OPAQUE,
                "Cookie": "__Host-iv_session=" + OPAQUE,
                "X-CSRF-Token": OPAQUE,
                "User-Agent": "test",
            },
            "env": {"REMOTE_ADDR": "203.0.113.9"},
        },
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": "bad point 41.0123456, 29.0987654 from " + JWT,
                    "stacktrace": {
                        "frames": [
                            {"function": "plan", "vars": {"lat": 41.0123456, "token": OPAQUE}}
                        ]
                    },
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {"category": "http", "message": "GET /v1/near?lat=41.0123456&lng=29.0987654"},
                {"category": "auth", "data": {"email": "a.person@example.com"}},
            ]
        },
        "extra": {"geometry": {"coordinates": [[29.1, 41.1]]}, "count": 3},
    }


def test_scrub_event_on_a_fake_report() -> None:
    cleaned = scrub_event(sentry_event(), None)
    assert cleaned is not None
    text = json.dumps(cleaned)
    assert OPAQUE not in text
    assert JWT not in text
    assert "a.person" not in text
    assert "203.0.113.9" not in text
    assert "0123456" not in text
    assert "api-host-1" not in text
    assert cleaned["user"] == {"id": "u-1"}
    request = cleaned["request"]
    assert request["url"] == "https://api.inecekvar.app/v1/auth/magic-link/verify"
    assert set(request) == {"url", "method", "headers"}
    assert request["headers"] == {"User-Agent": "test"}
    assert cleaned["message"] == "login failed for [email]"
    frame = cleaned["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert frame["vars"] == {"lat": 41.012}
    assert cleaned["exception"]["values"][0]["value"] == (
        "bad point 41.012, 29.099 from [redacted-jwt]"
    )
    assert cleaned["breadcrumbs"]["values"][0]["message"] == "GET /v1/near"
    assert cleaned["extra"] == {"count": 3}


def test_scrub_event_without_user_or_request() -> None:
    assert scrub_event({"message": "plain"}) == {"message": "plain"}
    assert scrub_event({"user": {"email": "x@example.com"}}) == {"user": {}}


def test_no_dsn_imports_nothing() -> None:
    calls: list[str] = []

    def importer(name: str) -> types.ModuleType:
        calls.append(name)
        raise AssertionError("must not import")

    assert init_error_reporting(ErrorReportingSettings(dsn=None), importer) is False
    assert calls == []


def test_dsn_with_sdk_installs_the_scrubber() -> None:
    received: dict[str, Any] = {}
    module = types.ModuleType("sentry_sdk")

    def init(**kwargs: Any) -> None:
        received.update(kwargs)

    module.init = init  # type: ignore[attr-defined]
    dsn = "https://" + "public" + "@errors.example.invalid/1"
    config = ErrorReportingSettings(dsn=SecretStr(dsn), environment="test")
    assert init_error_reporting(config, lambda name: module) is True
    assert received["before_send"] is scrub_event
    assert received["send_default_pii"] is False
    assert received["include_local_variables"] is False
    assert received["dsn"] == dsn
    assert received["environment"] == "test"


def test_dsn_without_sdk_warns_and_stays_off() -> None:
    def importer(name: str) -> types.ModuleType:
        raise ModuleNotFoundError(name)

    config = ErrorReportingSettings(dsn=SecretStr("https://k@errors.example.invalid/1"))
    with capture_logs() as logs:
        assert init_error_reporting(config, importer) is False
    assert logs == [{"event": "error_reporting.sdk_missing", "log_level": "warning"}]


def test_settings_read_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INECEKVAR_SENTRY_DSN", raising=False)
    assert ErrorReportingSettings().dsn is None
    monkeypatch.setenv("INECEKVAR_SENTRY_DSN", "https://k@errors.example.invalid/1")
    configured = ErrorReportingSettings().dsn
    assert configured is not None
    assert "k@" not in repr(configured)
