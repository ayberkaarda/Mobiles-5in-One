import uuid

import httpx
import pytest
from sqlalchemy import select

from app.core.deps import Services
from app.geo import point_coordinates
from app.models import Line, LineStop, LineVersion, Stop
from tests.domain.conftest import Account, Sample
from tests.domain.test_moderation import approve_edit
from tests.domain.test_validation import new_line

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_new_line_approval_and_slug_suffix(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    for suffix in ("", "-2"):
        body = new_line(sample)
        body["code"] = "ÇĞİ-ÖŞÜ"
        response = await client.post("/v1/edits", headers=contributor.headers, json=body)
        assert response.status_code == 201
        identity = uuid.UUID(response.json()["id"])
        assert (await approve_edit(client, moderator, identity)).status_code == 200
        async with services.session_factory() as db:
            line = await db.scalar(select(Line).where(Line.slug == "cgi-osu" + suffix))
            assert line is not None
            assert line.status == "published"
            assert line.current_version_id is not None
            version = await db.get(LineVersion, line.current_version_id)
            assert version is not None
            assert version.version_no == 1
            stops = list(
                await db.scalars(
                    select(LineStop.stop_id)
                    .where(
                        LineStop.line_version_id == version.id,
                    )
                    .order_by(LineStop.seq)
                )
            )
            assert stops == sample.stop_ids[:2]


async def test_update_line_copies_unchanged_fields(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "update_line",
            "line": str(sample.line_id),
            "base_version_no": 1,
            "changes": {
                "name": "Yeni isim",
                "hail_notes": "El kaldırın.",
                "geometry": [[34.01, 42.51], [34.03, 42.51]],
                "stop_ids": [str(identity) for identity in sample.stop_ids[:2]],
            },
        },
    )
    assert response.status_code == 201
    identity = uuid.UUID(response.json()["id"])
    assert (await approve_edit(client, moderator, identity)).status_code == 200
    detail = (await client.get("/v1/lines/ornek-hat-1?city=ornek-test-sehri")).json()
    assert detail["name"] == "Yeni isim"
    assert detail["hail_notes"] == "El kaldırın."
    assert detail["fare_minor"] == 2500
    assert detail["hours_text"] == "[ÖRNEK] 06:00-23:00"
    assert len(detail["stops"]) == 2
    assert detail["version_no"] == 2


async def test_new_and_update_stop(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
) -> None:
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "new_stop",
            "city": "ornek-test-sehri",
            "name": "Şişli Durağı",
            "location": [34.02, 42.52],
            "stop_kind": "informal",
        },
    )
    assert response.status_code == 201
    identity = uuid.UUID(response.json()["id"])
    assert (await approve_edit(client, moderator, identity)).status_code == 200
    async with services.session_factory() as db:
        stop = await db.scalar(select(Stop).where(Stop.slug == "sisli-duragi"))
        assert stop is not None
        assert stop.kind == "informal"
        identity = stop.id
    response = await client.post(
        "/v1/edits",
        headers=contributor.headers,
        json={
            "kind": "update_stop",
            "stop": str(identity),
            "changes": {
                "name": "Yeni durak",
                "kind": "formal",
                "location": [34.025, 42.525],
            },
        },
    )
    assert response.status_code == 201
    assert response.json()["diff"]["name"]["from"] == "Şişli Durağı"
    edit_id = uuid.UUID(response.json()["id"])
    assert (await approve_edit(client, moderator, edit_id)).status_code == 200
    async with services.session_factory() as db:
        stop = await db.get(Stop, identity)
        assert stop is not None
        assert stop.name == "Yeni durak"
        assert stop.kind == "formal"
        assert point_coordinates(stop.location) == [34.025, 42.525]
