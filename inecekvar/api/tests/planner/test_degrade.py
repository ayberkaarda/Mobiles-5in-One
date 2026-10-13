"""Planner degrade flag (spec section 6 item 22, ADR-0054)."""

import json
from collections.abc import Callable, Sequence
from datetime import timedelta
from typing import Any

import fakeredis
import httpx
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.deps import Services
from app.planner import degrade, search, service
from app.planner.degrade import (
    DEGRADE_KEY,
    DEGRADED_CACHE_TTL_SECONDS,
    clear_flag,
    count_planner_call,
    degrade_active,
    hour_key,
    parse_flag,
    read_flag,
    set_flag,
)
from app.planner.graph import Network
from app.planner.schemas import PlanOutput
from app.planner.search import PlanResult
from tests.support.app import FixedClock

pytestmark = pytest.mark.anyio

KEY = "plan:v1:ornek-test-sehri:0:34.010,42.510:34.090,42.570"


def body(k: int = 2) -> dict[str, object]:
    return {
        "city": "ornek-test-sehri",
        "from": {"lng": 34.01, "lat": 42.51},
        "to": {"lng": 34.09, "lat": 42.57},
        "max_transfers": k,
    }


class Recorder:
    """Wraps `search.plan` and records the transfer limit and search budget of each call."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, float]] = []

    def __call__(
        self,
        network: Network,
        origins: Sequence[tuple[str, float]],
        destinations: Sequence[tuple[str, float]],
        max_transfers: int,
        max_itineraries: int = 3,
        *,
        deadline: float | None,
        now: Callable[[], float],
    ) -> PlanResult:
        assert deadline is not None
        self.calls.append((max_transfers, deadline - now()))
        return search.plan(
            network,
            origins,
            destinations,
            max_transfers,
            max_itineraries,
            deadline=deadline,
            now=now,
        )


class BrokenRedis(fakeredis.FakeAsyncRedis):
    async def get(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("down")

    def pipeline(self, *args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("down")


@pytest.mark.postgis
async def test_flag_forces_single_transfer_short_budget_and_long_cache(
    planner_client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = Recorder()
    monkeypatch.setattr(service, "plan", recorder)
    await set_flag(services.redis, "ops", "manual", clock.now(), 600)
    response = await planner_client.post("/v1/plan", json=body(2))
    assert response.status_code == 200
    data = PlanOutput.model_validate(response.json())
    assert data.degraded is True
    assert data.itineraries
    assert all(itinerary.transfers <= 1 for itinerary in data.itineraries)
    assert [transfers for transfers, _ in recorder.calls] == [1]
    assert all(budget <= 1.0 for _, budget in recorder.calls)
    ttl = await services.redis.ttl(KEY + ":1:degraded")
    assert services.settings.planner_cache_ttl_seconds < ttl <= DEGRADED_CACHE_TTL_SECONDS
    assert not await services.redis.exists(KEY + ":2")

    # Degraded answers are served from their own cache entry.
    again = await planner_client.post("/v1/plan", json=body(2))
    assert again.json() == response.json()
    assert len(recorder.calls) == 1


@pytest.mark.postgis
async def test_flag_keeps_a_stricter_request(
    planner_client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = Recorder()
    monkeypatch.setattr(service, "plan", recorder)
    await set_flag(services.redis, "cost_guard", "planner_load", clock.now(), 600)
    response = await planner_client.post("/v1/plan", json=body(0))
    assert response.json()["degraded"] is True
    assert [transfers for transfers, _ in recorder.calls] == [0]


@pytest.mark.postgis
async def test_flag_expiry_restores_normal_planning(
    planner_client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = Recorder()
    monkeypatch.setattr(service, "plan", recorder)
    await set_flag(services.redis, "ops", "manual", clock.now(), 60)
    clock.advance(seconds=59)
    assert (await planner_client.post("/v1/plan", json=body(2))).json()["degraded"] is True
    clock.advance(seconds=1)
    # The Redis key may outlive the lifetime by clock skew; `expires_at` decides.
    assert await services.redis.exists(DEGRADE_KEY)
    normal = await planner_client.post("/v1/plan", json=body(2))
    assert normal.json()["degraded"] is False
    assert [transfers for transfers, _ in recorder.calls] == [1, 2]
    assert normal.json()["itineraries"][0]["transfers"] == 1


@pytest.mark.postgis
async def test_planner_counts_every_call_in_the_hour_bucket(
    planner_client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    for _ in range(3):
        assert (await planner_client.post("/v1/plan", json=body())).status_code == 200
    assert await services.redis.get(hour_key(clock.now())) == b"3"
    assert 0 < await services.redis.ttl(hour_key(clock.now())) <= degrade.PLANNER_CALLS_TTL_SECONDS


def test_degraded_is_a_required_response_field() -> None:
    schema = PlanOutput.model_json_schema()
    assert "degraded" in schema["required"]
    assert schema["properties"]["degraded"]["type"] == "boolean"
    with pytest.raises(ValueError, match="degraded"):
        PlanOutput.model_validate({"city": "x", "itineraries": []})


async def test_flag_round_trip_and_expiry() -> None:
    redis = fakeredis.FakeAsyncRedis()
    clock = FixedClock()
    try:
        assert await degrade_active(redis, clock.now()) is False
        flag = await set_flag(redis, "ops", "manual", clock.now(), 120)
        assert 0 < await redis.ttl(DEGRADE_KEY) <= 120
        assert await read_flag(redis) == flag
        assert await degrade_active(redis, clock.now()) is True
        clock.advance(seconds=120)
        assert await degrade_active(redis, clock.now()) is False
        assert await clear_flag(redis) is True
        assert await clear_flag(redis) is False
        with pytest.raises(ValueError, match="lifetime"):
            await set_flag(redis, "ops", "manual", clock.now(), 0)
        with pytest.raises(ValueError, match="lifetime"):
            await set_flag(redis, "ops", "manual", clock.now(), 24 * 3600 + 1)
    finally:
        await redis.aclose()


def test_unreadable_flag_reads_as_absent() -> None:
    assert parse_flag(None) is None
    assert parse_flag(b"not json") is None
    assert parse_flag(json.dumps({"source": "ops"})) is None
    assert parse_flag(json.dumps({"source": "ops", "reason": "x", "set_at": 1})) is None


async def test_redis_errors_never_fail_a_plan() -> None:
    redis = BrokenRedis()
    clock = FixedClock()
    try:
        assert await degrade_active(redis, clock.now()) is False
        await count_planner_call(redis, clock.now())
    finally:
        await redis.aclose()


def test_hour_key_is_utc() -> None:
    clock = FixedClock()
    assert hour_key(clock.now()) == "inecekvar:cost:planner-calls:2026101209"
    assert hour_key(clock.now() + timedelta(minutes=59)).endswith("09")
