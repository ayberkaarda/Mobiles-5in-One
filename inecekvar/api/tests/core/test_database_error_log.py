import io

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import IntegrityError

from app.core.deps import Services
from app.core.settings import Settings
from tests.core.conftest import make_core_app
from tests.core.test_logging import log_stream

__all__ = ["log_stream"]

pytestmark = [pytest.mark.anyio]

ROW_TEXT = "Failing row contains (01a1, [[34.0123456, 42.5123456]], person@example.com)."


class CheckViolationError(Exception):
    sqlstate = "23514"


def routes(application: FastAPI) -> None:
    @application.post("/v1/_test/database")
    async def database() -> None:
        raise IntegrityError(
            "INSERT INTO traces ...", {"points": "[[34.0123456]]"}, CheckViolationError(ROW_TEXT)
        )


async def test_database_error_logs_no_row_values(
    settings: Settings, services: Services, log_stream: io.StringIO
) -> None:
    application = make_core_app(settings, services, routes)
    transport = httpx.ASGITransport(app=application, client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.post("/v1/_test/database")
    assert response.status_code == 500
    assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
    output = log_stream.getvalue()
    assert "request.database_error" in output
    assert "23514" in output
    for secret in ("34.0123456", "42.5123456", "person@example.com", "Failing row"):
        assert secret not in output
    assert ROW_TEXT not in response.text
