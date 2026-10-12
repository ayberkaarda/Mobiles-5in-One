import json
from collections.abc import Callable, Sequence

import httpx
import pytest
from redis.asyncio import Redis
from structlog.testing import capture_logs

from app.core.deps import Services
from app.planner import search, service
from app.planner.graph import Network
from app.planner.search import PlannerTimeout, PlanResult

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def body(k: int = 2) -> dict[str, object]:
    return {
        "city": "ornek-test-sehri",
        "from": {"lng": 34.01, "lat": 42.51},
        "to": {"lng": 34.09, "lat": 42.57},
        "max_transfers": k,
    }


async def test_plan_sample_city_one_transfer(planner_client: httpx.AsyncClient) -> None:
    response = await planner_client.post("/v1/plan", json=body(1))
    assert response.status_code == 200
    data = response.json()
    assert data["degraded"] is False
    assert data["itineraries"]
    itinerary = data["itineraries"][0]
    assert itinerary["transfers"] == 1
    rides = [leg for leg in itinerary["legs"] if leg["kind"] == "ride"]
    assert [ride["line_code"] for ride in rides] == ["ORN-1", "ORN-3"]
    assert rides[0]["board_stop"]["slug"] == "ornek-durak-1-1"
    assert rides[-1]["alight_stop"]["slug"] == "ornek-durak-4-5"


async def test_plan_respects_max_transfers_zero(planner_client: httpx.AsyncClient) -> None:
    response = await planner_client.post("/v1/plan", json=body(0))
    assert response.status_code == 200
    assert response.json()["itineraries"] == []


async def test_plan_outside_bbox_is_422(planner_client: httpx.AsyncClient) -> None:
    request = body()
    request["from"] = {"lng": 35, "lat": 43}
    response = await planner_client.post("/v1/plan", json=request)
    assert response.status_code == 422
    assert response.json()["code"] == "plan.outside_city"


async def test_plan_unknown_city_404(planner_client: httpx.AsyncClient) -> None:
    request = body()
    request["city"] = "absent-city"
    response = await planner_client.post("/v1/plan", json=request)
    assert response.status_code == 404


async def test_plan_rate_limited_31st_request(planner_client: httpx.AsyncClient) -> None:
    for _ in range(30):
        assert (await planner_client.post("/v1/plan", json=body())).status_code == 200
    response = await planner_client.post("/v1/plan", json=body())
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0


async def test_plan_cache_hit_same_cell(
    planner_client: httpx.AsyncClient,
    services: Services,
    redis_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = services.redis
    connection = Redis.from_url(redis_url)
    services.redis = connection
    key = "plan:v1:ornek-test-sehri:0:34.010,42.510:34.090,42.570:2"
    await connection.delete(key)
    calls = 0
    real_plan = search.plan

    def counted(
        network: Network,
        origins: Sequence[tuple[str, float]],
        destinations: Sequence[tuple[str, float]],
        max_transfers: int,
        max_itineraries: int = 3,
        *,
        deadline: float | None,
        now: Callable[[], float],
    ) -> PlanResult:
        nonlocal calls
        calls += 1
        return real_plan(
            network,
            origins,
            destinations,
            max_transfers,
            max_itineraries,
            deadline=deadline,
            now=now,
        )

    monkeypatch.setattr(service, "plan", counted)
    try:
        first = await planner_client.post("/v1/plan", json=body())
        assert first.status_code == 200
        assert await connection.exists(key)
        assert 0 < await connection.ttl(key) <= services.settings.planner_cache_ttl_seconds
        second_body = body()
        second_body["from"] = {"lng": 34.01019, "lat": 42.51019}
        second_body["to"] = {"lng": 34.09019, "lat": 42.57019}
        second = await planner_client.post("/v1/plan", json=second_body)
        assert second.status_code == 200
        assert second.json() == first.json()
        assert calls == 1
    finally:
        services.redis = original
        await connection.delete(key)
        await connection.aclose()


@pytest.mark.parametrize("always_timeout", [False, True])
async def test_plan_timeout_returns_degraded_not_500(
    planner_client: httpx.AsyncClient,
    services: Services,
    monkeypatch: pytest.MonkeyPatch,
    always_timeout: bool,
) -> None:
    real_plan = search.plan
    calls: list[int] = []

    def interrupted(
        network: Network,
        origins: Sequence[tuple[str, float]],
        destinations: Sequence[tuple[str, float]],
        max_transfers: int,
        max_itineraries: int = 3,
        *,
        deadline: float | None,
        now: Callable[[], float],
    ) -> PlanResult:
        calls.append(max_transfers)
        if len(calls) == 1 or always_timeout:
            raise PlannerTimeout
        return real_plan(
            network,
            origins,
            destinations,
            max_transfers,
            max_itineraries,
            deadline=deadline,
            now=now,
        )

    monkeypatch.setattr(service, "plan", interrupted)
    response = await planner_client.post("/v1/plan", json=body())
    assert response.status_code == 200
    assert response.json()["degraded"] is True
    assert calls == [2, 1]
    if always_timeout:
        assert response.json()["itineraries"] == []
    else:
        assert response.json()["itineraries"]
    key = "plan:v1:ornek-test-sehri:0:34.010,42.510:34.090,42.570:2"
    assert 0 < await services.redis.ttl(key) <= 60


async def test_plan_log_has_no_precise_coordinates(planner_client: httpx.AsyncClient) -> None:
    request = body()
    request["from"] = {"lng": 34.010123456, "lat": 42.510123456}
    with capture_logs() as logs:
        response = await planner_client.post("/v1/plan", json=request)
    assert response.status_code == 200
    encoded = json.dumps(logs)
    assert "34.010123456" not in encoded
    assert "42.510123456" not in encoded
    records = [record for record in logs if record.get("event") == "plan"]
    assert records
    assert set(records[0]) <= {
        "event",
        "log_level",
        "city",
        "result_count",
        "degraded",
        "cache_hit",
    }


@pytest.mark.parametrize("extra", [{"max_transfers": 3}, {"surplus": 1}])
async def test_plan_rejects_invalid_body(
    planner_client: httpx.AsyncClient, extra: dict[str, int]
) -> None:
    request = body()
    request.update(extra)
    assert (await planner_client.post("/v1/plan", json=request)).status_code == 422


async def test_plan_city_beyond_capacity_degrades(
    planner_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "MAX_PLANNER_STOPS", 5)
    request = body()
    request["max_transfers"] = 1
    response = await planner_client.post("/v1/plan", json=request)
    assert response.status_code == 200
    assert response.json()["degraded"] is True
    assert response.json()["itineraries"] == []
