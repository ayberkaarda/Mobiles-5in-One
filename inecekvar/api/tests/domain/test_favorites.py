import httpx
import pytest
from sqlalchemy import update

from app.core.deps import Services
from app.models import Line
from tests.domain.conftest import Account, Sample
from tests.support.domain import create_account, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_favorites_are_scoped_to_owner(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    user: Account,
) -> None:
    _, email = await create_account(services)
    other = await sign_in(client, email)
    path = "/v1/me/favorites/" + str(sample.line_id)
    assert (await client.put(path, headers=user.headers)).status_code == 204
    response = await client.get(path, headers=user.headers)
    assert response.status_code == 200
    assert response.json() == {
        "line_id": str(sample.line_id),
        "slug": "ornek-hat-1",
        "city": "ornek-test-sehri",
    }
    assert (await client.get(path, headers=other)).status_code == 404
    assert (await client.get("/v1/me/favorites", headers=other)).json() == []
    assert (await client.delete(path, headers=other)).status_code == 204
    assert (await client.get(path, headers=user.headers)).status_code == 200


async def test_favorites_idempotency(
    client: httpx.AsyncClient,
    sample: Sample,
    user: Account,
) -> None:
    path = "/v1/me/favorites/" + str(sample.line_id)
    for _ in range(2):
        response = await client.put(path, headers=user.headers)
        assert response.status_code == 204
        assert response.content == b""
    assert len((await client.get("/v1/me/favorites", headers=user.headers)).json()) == 1
    for _ in range(2):
        assert (await client.delete(path, headers=user.headers)).status_code == 204
    assert (await client.get(path, headers=user.headers)).status_code == 404


async def test_favorites_only_accept_published_lines(
    client: httpx.AsyncClient,
    sample: Sample,
    user: Account,
    services: Services,
) -> None:
    async with services.session_factory() as db:
        await db.execute(update(Line).where(Line.id == sample.line_id).values(status="retired"))
        await db.commit()
    response = await client.put("/v1/me/favorites/" + str(sample.line_id), headers=user.headers)
    assert response.status_code == 404
