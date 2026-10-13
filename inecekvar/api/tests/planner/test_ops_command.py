"""`python -m app.ops.planner_degrade` (ADR-0054)."""

import asyncio
import json
from collections.abc import Callable

import fakeredis
import pytest
from redis.asyncio import Redis

from app.ops import planner_degrade
from app.planner.degrade import DEGRADE_KEY


def factory(server: fakeredis.FakeServer) -> Callable[[], Redis]:
    return lambda: fakeredis.FakeAsyncRedis(server=server)


def run(
    argv: list[str], server: fakeredis.FakeServer, capsys: pytest.CaptureFixture[str]
) -> tuple[dict[str, object], list[dict[str, object]]]:
    assert planner_degrade.main(argv, factory(server)) == 0
    captured = capsys.readouterr()
    audit = [json.loads(line) for line in captured.err.splitlines() if line.strip()]
    return json.loads(captured.out), audit


def test_on_status_off_with_audit_lines(capsys: pytest.CaptureFixture[str]) -> None:
    server = fakeredis.FakeServer()
    state, audit = run(
        ["on", "--minutes", "5", "--reason", "cpu_alert", "--operator", "nobet"], server, capsys
    )
    assert state["active"] is True
    flag = state["flag"]
    assert isinstance(flag, dict)
    assert (flag["source"], flag["reason"]) == ("ops", "cpu_alert")
    assert len(audit) == 1
    line = audit[0]
    assert line["event"] == "ops.planner_degrade"
    assert line["level"] == "warning"
    assert (line["action"], line["previous"], line["ttl_seconds"]) == ("on", "off", 300)
    assert line["operator"] == "nobet"
    assert "timestamp" in line

    status, audit = run(["status"], server, capsys)
    assert status["active"] is True
    assert audit == []

    off, audit = run(["off"], server, capsys)
    assert off == {"active": False, "flag": None}
    assert audit[0]["action"] == "off"
    assert audit[0]["previous"] == "on"
    assert audit[0]["removed"] is True
    assert audit[0]["previous_source"] == "ops"

    status, _ = run(["status"], server, capsys)
    assert status == {"active": False, "flag": None}


def test_flag_lifetime_matches_minutes(capsys: pytest.CaptureFixture[str]) -> None:
    server = fakeredis.FakeServer()
    run(["on", "--minutes", "2"], server, capsys)

    async def ttl() -> int:
        redis = fakeredis.FakeAsyncRedis(server=server)
        try:
            return int(await redis.ttl(DEGRADE_KEY))
        finally:
            await redis.aclose()

    assert 0 < asyncio.run(ttl()) <= 120


@pytest.mark.parametrize(
    "argv",
    [
        ["on", "--minutes", "0"],
        ["on", "--minutes", "1441"],
        ["on", "--reason", "Ayse Yilmaz"],
        ["on", "--operator", "ops@example.com"],
        ["toggle"],
        [],
    ],
)
def test_bad_arguments_are_refused(argv: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    server = fakeredis.FakeServer()
    with pytest.raises(SystemExit) as raised:
        planner_degrade.main(argv, factory(server))
    assert raised.value.code == 2
    capsys.readouterr()


def test_missing_redis_url_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INECEKVAR_REDIS_URL", raising=False)
    with pytest.raises(SystemExit, match="INECEKVAR_REDIS_URL"):
        planner_degrade.redis_from_environment()
