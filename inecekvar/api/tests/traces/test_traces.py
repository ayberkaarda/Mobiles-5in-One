import io
import json
import logging
import re
import sys
import uuid
from collections.abc import Iterator
from datetime import timedelta

import httpx
import pytest
import structlog
from sqlalchemy import update

from app.core.deps import Services
from app.core.logging import configure_logging
from app.models import Trace, User
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import create_account, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
RAW = [[34.01234567, 42.51234567], [34.05234567, 42.51234567]]


def trace_body(clock: FixedClock) -> dict[str, object]:
    return {
        "city": "ornek-test-sehri",
        "started_at": clock.now().isoformat(),
        "ended_at": clock.now().isoformat(),
        "points": RAW,
    }


async def upload(client: httpx.AsyncClient, account: Account, clock: FixedClock) -> uuid.UUID:
    response = await client.post("/v1/traces", json=trace_body(clock), headers=account.headers)
    assert response.status_code == 201
    assert "points" not in response.json()
    return uuid.UUID(response.json()["id"])


@pytest.mark.parametrize(
    ("change", "status"),
    [
        ({"points": RAW * 3000}, 422),
        ({"points": [[35, 43], [35.01, 43]]}, 422),
        ({"points": RAW * 100}, 422),
        ({"points": [RAW[0], RAW[0]]}, 422),
        ({"points": [RAW[0]]}, 422),
        ({"points": [[float("nan"), 42.51], RAW[1]]}, 422),
        ({"points": [[34.01, 42.51, float("inf")], RAW[1]]}, 422),
        ({"points": [["34.01", 42.51], RAW[1]]}, 422),
        ({"unknown": True}, 422),
        ({"city": "missing"}, 404),
    ],
)
async def test_trace_invalid_rules(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
    change: dict[str, object],
    status: int,
) -> None:
    body = trace_body(clock) | change
    response = await client.post(
        "/v1/traces",
        headers=contributor.headers | {"Content-Type": "application/json"},
        content=json.dumps(body),
    )
    assert response.status_code == status


@pytest.mark.parametrize("case", ["order", "future", "duration"])
async def test_trace_time_rules(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
    case: str,
) -> None:
    body = trace_body(clock)
    if case == "order":
        body["started_at"] = (clock.now() + timedelta(seconds=1)).isoformat()
    elif case == "future":
        body["ended_at"] = (clock.now() + timedelta(minutes=6)).isoformat()
    else:
        body["started_at"] = (clock.now() - timedelta(hours=13)).isoformat()
    assert (
        await client.post("/v1/traces", json=body, headers=contributor.headers)
    ).status_code == 422


async def test_trace_body_limit(
    client: httpx.AsyncClient,
    contributor: Account,
) -> None:
    response = await client.post(
        "/v1/traces",
        content=b" " * (2 * 1024 * 1024 + 1),
        headers=contributor.headers | {"Content-Type": "application/json"},
    )
    assert response.status_code == 413


async def test_trace_rate_limit_20_per_day(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    for _ in range(20):
        await upload(client, contributor, clock)
    assert (
        await client.post("/v1/traces", json=trace_body(clock), headers=contributor.headers)
    ).status_code == 429


async def test_trace_read_permissions(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
    clock: FixedClock,
) -> None:
    identity = await upload(client, contributor, clock)
    _, email = await create_account(services)
    other = await sign_in(client, email)
    path = "/v1/traces/" + str(identity)
    for headers, status in (
        (contributor.headers, 200),
        (moderator.headers, 200),
        (other, 403),
        ({}, 401),
    ):
        response = await client.get(path, headers=headers)
        assert response.status_code == status
        if status == 200:
            assert response.json()["points"] == RAW


async def test_trace_delete_owner_only(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
    clock: FixedClock,
) -> None:
    identity = await upload(client, contributor, clock)
    path = "/v1/traces/" + str(identity)
    assert (await client.delete(path, headers=moderator.headers)).status_code == 403
    assert (await client.delete(path)).status_code == 401
    async with services.session_factory() as db:
        await db.execute(update(User).where(User.id == contributor.identity).values(role="user"))
        await db.commit()
    assert (await client.delete(path, headers=contributor.headers)).status_code == 204
    async with services.session_factory() as db:
        assert await db.get(Trace, identity) is None


@pytest.fixture
def log_stream(services: Services, monkeypatch: pytest.MonkeyPatch) -> Iterator[io.StringIO]:
    stream = io.StringIO()
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    configuration = structlog.get_config()
    loggers = [logging.getLogger(name) for name in ("uvicorn", "uvicorn.error", "uvicorn.access")]
    previous = [(logger.handlers[:], logger.level, logger.propagate) for logger in loggers]
    monkeypatch.setattr(sys, "stdout", stream)
    configure_logging(services.settings)
    try:
        yield stream
    finally:
        for handler in root.handlers:
            handler.close()
        root.handlers = handlers
        root.setLevel(level)
        for logger, (old_handlers, old_level, propagate) in zip(loggers, previous, strict=True):
            logger.handlers = old_handlers
            logger.setLevel(old_level)
            logger.propagate = propagate
        structlog.configure(**configuration)


async def test_trace_body_not_logged(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
    log_stream: io.StringIO,
) -> None:
    await upload(client, contributor, clock)
    assert "points" not in log_stream.getvalue()
    assert re.search(r"(?:34|42)\.\d{4,}", log_stream.getvalue()) is None
