import httpx
import pytest
from sqlalchemy import func, select, update

from app.core.deps import Services
from app.models import Edit, Favorite, Photo, Trace, User
from app.models.session import create_engine
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_edit_quota_charged_before_validation(
    review_client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
) -> None:
    invalid_body = {
        "kind": "new_stop",
        "city": "unknown-city-slug",
        "name": "Yeni durak",
        "location": [34.01234567, 42.51234567],
        "stop_kind": "formal",
    }
    for _ in range(10):
        response = await review_client.post(
            "/v1/edits", json=invalid_body, headers=contributor.headers
        )
        assert response.status_code == 404
    valid_response = await review_client.post(
        "/v1/edits",
        json=invalid_body | {"city": "ornek-test-sehri"},
        headers=contributor.headers,
    )
    assert valid_response.status_code == 429


async def test_deactivated_account_cannot_write(
    review_client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    async with services.session_factory() as db:
        await db.execute(
            update(User).where(User.id == contributor.identity).values(deactivated_at=clock.now())
        )
        await db.commit()
        before = {
            Trace: await db.scalar(select(func.count()).select_from(Trace)),
            Edit: await db.scalar(select(func.count()).select_from(Edit)),
            Favorite: await db.scalar(select(func.count()).select_from(Favorite)),
            Photo: await db.scalar(select(func.count()).select_from(Photo)),
        }
    trace_body = {
        "city": "ornek-test-sehri",
        "started_at": clock.now().isoformat(),
        "ended_at": clock.now().isoformat(),
        "points": [[34.01234567, 42.51234567], [34.05234567, 42.51234567]],
    }
    responses = [
        await review_client.post("/v1/traces", json=trace_body, headers=contributor.headers),
        await review_client.post(
            "/v1/edits",
            json={
                "kind": "new_stop",
                "city": "ornek-test-sehri",
                "name": "Yeni durak",
                "location": [34.01234567, 42.51234567],
                "stop_kind": "formal",
            },
            headers=contributor.headers,
        ),
        await review_client.put(
            "/v1/me/favorites/" + str(sample.line_id), headers=contributor.headers
        ),
        await review_client.post(
            "/v1/media/presign",
            json={"kind": "fare_table", "content_type": "image/jpeg", "byte_size": 1024},
            headers=contributor.headers,
        ),
    ]
    assert all(400 <= response.status_code < 500 for response in responses)
    async with services.session_factory() as db:
        after = {
            Trace: await db.scalar(select(func.count()).select_from(Trace)),
            Edit: await db.scalar(select(func.count()).select_from(Edit)),
            Favorite: await db.scalar(select(func.count()).select_from(Favorite)),
            Photo: await db.scalar(select(func.count()).select_from(Photo)),
        }
    assert after == before


def test_engine_hides_parameters() -> None:
    engine = create_engine("postgresql+asyncpg://u@127.0.0.1:1/x")
    assert engine.sync_engine.hide_parameters is True
