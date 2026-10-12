import hashlib
import json
import uuid
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, Services
from app.core.ids import uuid7
from app.geo import line_geojson
from app.models import AuditLog, City, Edit, Line, LineStop, LineVersion, Trace, User
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import create_account, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


class FreshStepUp:
    def __init__(self, clock: FixedClock) -> None:
        self.clock = clock

    async def step_up_at(self, db: AsyncSession, principal: Principal) -> datetime:
        return self.clock.now()


async def propose_fare(
    client: httpx.AsyncClient,
    account: Account,
    sample: Sample,
    *,
    fare: int = 3500,
    base: int = 1,
) -> uuid.UUID:
    response = await client.post(
        "/v1/edits",
        headers=account.headers,
        json={
            "kind": "fare_update",
            "line": str(sample.line_id),
            "base_version_no": base,
            "fare_minor": fare,
        },
    )
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


async def approve_edit(
    client: httpx.AsyncClient,
    account: Account,
    identity: uuid.UUID,
) -> httpx.Response:
    return await client.post(
        "/v1/moderation/edits/" + str(identity) + "/approve",
        headers=account.headers,
    )


async def version_snapshot(db: AsyncSession, identity: uuid.UUID) -> tuple[object, ...]:
    version = await db.get(LineVersion, identity)
    assert version is not None
    stops = tuple(
        (
            await db.execute(
                select(
                    LineStop.stop_id,
                    LineStop.seq,
                    LineStop.created_at,
                )
                .where(
                    LineStop.line_version_id == identity,
                )
                .order_by(LineStop.seq)
            )
        ).all()
    )
    return (
        version.id,
        version.line_id,
        version.geom.desc,
        version.version_no,
        version.fare_minor,
        version.fare_updated_at,
        version.hours_text,
        tuple(version.payment_methods),
        version.hail_notes,
        tuple(version.stop_ids),
        version.source_edit_id,
        version.published_by,
        version.published_at,
        version.created_at,
        version.updated_at,
        stops,
    )


async def test_approve_creates_immutable_version(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    async with services.session_factory() as db:
        line = await db.get(Line, sample.line_id)
        city = await db.get(City, sample.city_id)
        assert line is not None
        assert line.current_version_id is not None
        assert city is not None
        old_id = line.current_version_id
        before = await version_snapshot(db, old_id)
        pack_version = city.pack_version
    identity = await propose_fare(client, contributor, sample)
    response = await approve_edit(client, moderator, identity)
    assert response.status_code == 200
    async with services.session_factory() as db:
        assert await version_snapshot(db, old_id) == before
        line = await db.get(Line, sample.line_id)
        city = await db.get(City, sample.city_id)
        author = await db.get(User, contributor.identity)
        assert line is not None
        assert line.current_version_id is not None
        assert line.current_version_id != old_id
        version = await db.get(LineVersion, line.current_version_id)
        assert version is not None
        assert version.version_no == 2
        assert version.fare_minor == 3500
        assert version.source_edit_id == identity
        assert version.published_by == moderator.identity
        assert version.fare_updated_at == services.clock.now()
        assert line.contributor_count == 1
        assert line.last_verified_at == services.clock.now()
        assert author is not None
        assert author.reputation == 5
        assert city is not None
        assert city.pack_version == pack_version + 1
        log = await db.scalar(select(AuditLog).where(AuditLog.target_id == identity))
        assert log is not None
        assert log.diff_hash is not None
        assert len(log.diff_hash) == 32
        assert log.action == "moderation.approve"
        canonical = json.dumps(response.json()["diff"], sort_keys=True, separators=(",", ":"))
        assert log.diff_hash == hashlib.sha256(canonical.encode()).digest()


async def test_self_approval_is_forbidden(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, moderator, sample)
    assert (await approve_edit(client, moderator, identity)).status_code == 403
    async with services.session_factory() as db:
        edit = await db.get(Edit, identity)
        assert edit is not None
        assert edit.state == "pending"


async def test_contributor_cannot_approve(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    identity = await propose_fare(client, contributor, sample)
    assert (await approve_edit(client, contributor, identity)).status_code == 403


async def test_reject_with_reason(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, contributor, sample)
    response = await client.post(
        "/v1/moderation/edits/" + str(identity) + "/reject",
        headers=moderator.headers,
        json={"reason": "Bilgi doğrulanamadı."},
    )
    assert response.status_code == 200
    assert response.json()["state"] == "rejected"
    assert response.json()["reason"] == "Bilgi doğrulanamadı."
    async with services.session_factory() as db:
        log = await db.scalar(select(AuditLog).where(AuditLog.target_id == identity))
        assert log is not None
        assert log.action == "moderation.reject"
        assert log.diff_hash is not None
        assert len(log.diff_hash) == 32


async def test_version_conflict_409(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    first = await propose_fare(client, contributor, sample)
    second = await propose_fare(client, contributor, sample, fare=4000)
    assert (await approve_edit(client, moderator, first)).status_code == 200
    response = await approve_edit(client, moderator, second)
    assert response.status_code == 409
    assert response.json()["code"] == "edit.version_conflict"
    async with services.session_factory() as db:
        edit = await db.get(Edit, second)
        assert edit is not None
        assert edit.state == "pending"


async def test_rollback_copies_old_version(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    clock: FixedClock,
    contributor: Account,
    moderator: Account,
) -> None:
    async with services.session_factory() as db:
        line = await db.get(Line, sample.line_id)
        assert line is not None
        assert line.current_version_id is not None
        old_id = line.current_version_id
        before = await version_snapshot(db, old_id)
    identity = await propose_fare(client, contributor, sample)
    assert (await approve_edit(client, moderator, identity)).status_code == 200
    services.step_up = FreshStepUp(clock)
    async with services.session_factory() as db:
        city = await db.get(City, sample.city_id)
        assert city is not None
        pack_version = city.pack_version
    response = await client.post(
        "/v1/moderation/lines/" + str(sample.line_id) + "/rollback",
        headers=moderator.headers,
        json={"version_no": 1},
    )
    assert response.status_code == 200
    assert response.json()["version_no"] == 3
    async with services.session_factory() as db:
        assert await version_snapshot(db, old_id) == before
        line = await db.get(Line, sample.line_id)
        assert line is not None
        assert line.current_version_id is not None
        old = await db.get(LineVersion, old_id)
        new = await db.get(LineVersion, line.current_version_id)
        assert old is not None
        assert new is not None
        city = await db.get(City, sample.city_id)
        assert city is not None
        assert city.pack_version == pack_version + 1
        assert line_geojson(new.geom) == line_geojson(old.geom)
        assert (
            new.fare_minor,
            new.hours_text,
            new.payment_methods,
            new.hail_notes,
            new.stop_ids,
            new.fare_updated_at,
        ) == (
            old.fare_minor,
            old.hours_text,
            old.payment_methods,
            old.hail_notes,
            old.stop_ids,
            old.fare_updated_at,
        )
        log = await db.scalar(select(AuditLog).where(AuditLog.action == "moderation.rollback"))
        assert log is not None
        assert log.diff_hash is not None
        assert len(log.diff_hash) == 32
        stops = list(
            await db.scalars(
                select(LineStop.stop_id)
                .where(
                    LineStop.line_version_id == new.id,
                )
                .order_by(LineStop.seq)
            )
        )
        assert [str(stop) for stop in stops] == old.stop_ids
    response = await client.post(
        "/v1/moderation/lines/" + str(sample.line_id) + "/rollback",
        headers=moderator.headers,
        json={"version_no": 999},
    )
    assert response.status_code == 404


async def test_rollback_without_step_up_is_403(
    client: httpx.AsyncClient,
    sample: Sample,
    moderator: Account,
) -> None:
    response = await client.post(
        "/v1/moderation/lines/" + str(sample.line_id) + "/rollback",
        headers=moderator.headers,
        json={"version_no": 1},
    )
    assert response.status_code == 403


async def test_retire_requires_step_up(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    clock: FixedClock,
    contributor: Account,
    moderator: Account,
) -> None:
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "retire",
            "line": str(sample.line_id),
            "reason": "Hat kapandı.",
        },
    )
    assert response.status_code == 201
    identity = uuid.UUID(response.json()["id"])
    assert (await approve_edit(client, moderator, identity)).status_code == 403
    services.step_up = FreshStepUp(clock)
    assert (await approve_edit(client, moderator, identity)).status_code == 200
    detail = await client.get("/v1/lines/ornek-hat-1?city=ornek-test-sehri")
    assert detail.json()["status"] == "retired"


async def test_approval_sets_trace_delete_after(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, contributor, sample)
    trace_id = uuid7()
    async with services.session_factory() as db:
        db.add(
            Trace(
                id=trace_id,
                author_id=contributor.identity,
                city_id=sample.city_id,
                points=[[34.01, 42.51], [34.03, 42.51]],
                started_at=services.clock.now(),
                ended_at=services.clock.now(),
                linked_edit_id=identity,
            )
        )
        await db.commit()
    assert (await approve_edit(client, moderator, identity)).status_code == 200
    async with services.session_factory() as db:
        trace = await db.get(Trace, trace_id)
        assert trace is not None
        assert trace.delete_after == services.clock.now() + timedelta(days=30)


async def test_moderation_queue_shows_deleted_contributor_label(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, contributor, sample)
    async with services.session_factory() as db:
        await db.execute(update(Edit).where(Edit.id == identity).values(author_id=None))
        await db.commit()
    response = await client.get("/v1/moderation/edits", headers=moderator.headers)
    assert response.status_code == 200
    assert response.json()[0]["author"] == "silinmiş katkıcı"
    assert response.json()[0]["current_geometry"]["type"] == "LineString"


async def test_edits_rate_limit_low_reputation(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    for index in range(10):
        await propose_fare(client, contributor, sample, fare=3500 + index)
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "fare_update",
            "line": str(sample.line_id),
            "base_version_no": 1,
            "fare_minor": 4500,
        },
    )
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0


async def test_edits_rate_limit_high_reputation(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
) -> None:
    identity, email = await create_account(services, reputation=20)
    account = Account(identity, await sign_in(client, email))
    for index in range(11):
        await propose_fare(client, account, sample, fare=3500 + index)
    assert services.settings.rate_limit_rules["edits.default"].limit == 100


async def test_contributor_count_uses_distinct_authors(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    first = await propose_fare(client, contributor, sample)
    assert (await approve_edit(client, moderator, first)).status_code == 200
    second = await propose_fare(client, contributor, sample, fare=4000, base=2)
    assert (await approve_edit(client, moderator, second)).status_code == 200
    async with services.session_factory() as db:
        line = await db.get(Line, sample.line_id)
        author = await db.get(User, contributor.identity)
        assert line is not None
        assert line.contributor_count == 1
        assert author is not None
        assert author.reputation == 10
