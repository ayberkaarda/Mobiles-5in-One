import uuid

import httpx
import pytest

from app.core.deps import Services
from app.core.errors import ProblemError
from app.geo import geodesic_length
from app.models import Trace, User
from app.traces.derive import derive_line_geometry
from app.workers.traces import purge_expired_traces
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import create_account, sign_in
from tests.traces.test_traces import RAW, upload

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


def test_trim_removes_first_and_last_200m() -> None:
    raw = [(0.0, 0.0), (2000 / 111195.08, 0.0)]
    result = derive_line_geometry(raw)
    assert geodesic_length([raw[0], result[0]]) == pytest.approx(200, abs=1)
    assert geodesic_length([result[-1], raw[-1]]) == pytest.approx(200, abs=1)


def test_too_short_trace_rejected() -> None:
    with pytest.raises(ProblemError) as caught:
        derive_line_geometry([(0.0, 0.0), (0.004, 0.0)])
    assert caught.value.code == "trace.too_short"
    assert caught.value.status == 422


def proposal(sample: Sample, identity: uuid.UUID) -> dict[str, object]:
    return {
        "kind": "update_line",
        "line": str(sample.line_id),
        "base_version_no": 1,
        "changes": {"trace_id": str(identity)},
    }


async def linked_edit(
    client: httpx.AsyncClient,
    contributor: Account,
    clock: FixedClock,
    sample: Sample,
) -> tuple[uuid.UUID, uuid.UUID]:
    trace_id = await upload(client, contributor, clock)
    response = await client.post(
        "/v1/edits", json=proposal(sample, trace_id), headers=contributor.headers
    )
    assert response.status_code == 201
    payload = response.json()["payload"]
    assert "trace_id" not in str(payload)
    assert RAW[0] not in payload["changes"]["geometry"]
    assert RAW[-1] not in payload["changes"]["geometry"]
    assert payload["changes"]["geometry_source"] == "trace"
    return trace_id, uuid.UUID(response.json()["id"])


async def test_trace_derived_edit_stores_only_trimmed_geometry(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    trace_id, edit_id = await linked_edit(client, contributor, clock, sample)
    async with services.session_factory() as db:
        trace = await db.get(Trace, trace_id)
        assert trace is not None
        assert trace.linked_edit_id == edit_id


async def test_cannot_use_other_users_trace(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    identity = await upload(client, contributor, clock)
    _, email = await create_account(services)
    response = await client.post(
        "/v1/edits", json=proposal(sample, identity), headers=await sign_in(client, email)
    )
    assert response.status_code == 404


async def test_trace_cannot_be_linked_twice(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    identity, _ = await linked_edit(client, contributor, clock, sample)
    response = await client.post(
        "/v1/edits", json=proposal(sample, identity), headers=contributor.headers
    )
    assert response.status_code == 409


async def test_new_line_trace_and_geometry_choice(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
    clock: FixedClock,
) -> None:
    identity = await upload(client, contributor, clock)
    body: dict[str, object] = {
        "kind": "new_line",
        "city": "ornek-test-sehri",
        "code": "TRACE-1",
        "name": "Ornek iz",
        "mode": "dolmus",
        "stop_ids": [str(value) for value in sample.stop_ids[:2]],
        "trace_id": str(identity),
    }
    assert (
        await client.post("/v1/edits", json=body | {"geometry": RAW}, headers=contributor.headers)
    ).status_code == 422
    response = await client.post("/v1/edits", json=body, headers=contributor.headers)
    assert response.status_code == 201
    payload = response.json()["payload"]
    assert "trace_id" not in payload
    assert payload["geometry_source"] == "trace"
    assert RAW[0] not in payload["geometry"]
    edit_id = response.json()["id"]
    assert (
        await client.post(
            "/v1/moderation/edits/" + edit_id + "/approve", json={}, headers=moderator.headers
        )
    ).status_code == 200


async def test_retention_deletes_30_days_after_publication(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
    clock: FixedClock,
) -> None:
    identity, edit_id = await linked_edit(client, contributor, clock, sample)
    clock.advance(days=2)
    async with services.session_factory() as db:
        reviewer = await db.get(User, moderator.identity)
        assert reviewer is not None
        email = reviewer.email
    response = await client.post(
        "/v1/moderation/edits/" + str(edit_id) + "/approve",
        json={},
        headers=await sign_in(client, email),
    )
    assert response.status_code == 200
    clock.advance(days=29, hours=23)
    assert await purge_expired_traces(services.session_factory, clock) == 0
    clock.advance(hours=1)
    assert await purge_expired_traces(services.session_factory, clock) == 1
    async with services.session_factory() as db:
        assert await db.get(Trace, identity) is None


async def test_unpublished_trace_expires_30_days_after_upload(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    await upload(client, contributor, clock)
    clock.advance(days=29, hours=23)
    assert await purge_expired_traces(services.session_factory, clock) == 0
    clock.advance(hours=1)
    assert await purge_expired_traces(services.session_factory, clock) == 1
