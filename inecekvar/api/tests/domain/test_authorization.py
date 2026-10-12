import httpx
import pytest

from app.core.deps import Services
from app.core.ids import uuid7
from app.models.enums import UserRole
from tests.domain.conftest import Account, Sample
from tests.domain.test_moderation import propose_fare
from tests.support.domain import create_account, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


@pytest.mark.parametrize("signed_in", [False, True])
async def test_mutation_authorization(
    client: httpx.AsyncClient,
    sample: Sample,
    user: Account,
    signed_in: bool,
) -> None:
    headers = user.headers if signed_in else {}
    expected = 403 if signed_in else 401
    identity = str(uuid7())
    cases: list[tuple[str, dict[str, object]]] = [
        (
            "/v1/edits",
            {
                "kind": "fare_update",
                "line": str(sample.line_id),
                "base_version_no": 1,
                "fare_minor": 3500,
            },
        ),
        ("/v1/moderation/edits/" + identity + "/approve", {}),
        ("/v1/moderation/edits/" + identity + "/reject", {"reason": "Uygun değil."}),
        ("/v1/moderation/lines/" + str(sample.line_id) + "/rollback", {"version_no": 1}),
    ]
    for path, body in cases:
        response = await client.post(path, headers=headers, json=body)
        assert response.status_code == expected


async def test_anonymous_favorites_are_401(client: httpx.AsyncClient, sample: Sample) -> None:
    path = "/v1/me/favorites/" + str(sample.line_id)
    assert (await client.get("/v1/me/favorites")).status_code == 401
    assert (await client.get(path)).status_code == 401
    assert (await client.put(path)).status_code == 401
    assert (await client.delete(path)).status_code == 401


async def test_edit_reads_follow_stored_authorship(
    client: httpx.AsyncClient,
    sample: Sample,
    contributor: Account,
    user: Account,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, contributor, sample)
    path = "/v1/edits/" + str(identity)
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=user.headers)).status_code == 403
    assert (await client.get(path, headers=contributor.headers)).status_code == 200
    assert (await client.get(path, headers=moderator.headers)).status_code == 200
    assert (await client.get("/v1/edits/" + str(uuid7()), headers=user.headers)).status_code == 404
    assert len((await client.get("/v1/edits", headers=contributor.headers)).json()) == 1
    assert (await client.get("/v1/edits", headers=user.headers)).json() == []
    assert (await client.get("/v1/moderation/edits")).status_code == 401
    assert (await client.get("/v1/moderation/edits", headers=user.headers)).status_code == 403


async def test_licence_is_required(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
) -> None:
    _, email = await create_account(services, UserRole.CONTRIBUTOR, licence_accepted=False)
    headers = await sign_in(client, email)
    response = await client.post(
        "/v1/edits",
        headers=headers,
        json={
            "kind": "fare_update",
            "line": str(sample.line_id),
            "base_version_no": 1,
            "fare_minor": 3500,
        },
    )
    assert response.status_code == 403


async def test_moderator_cannot_reject_own_edit(
    client: httpx.AsyncClient,
    sample: Sample,
    moderator: Account,
) -> None:
    identity = await propose_fare(client, moderator, sample)
    response = await client.post(
        "/v1/moderation/edits/" + str(identity) + "/reject",
        headers=moderator.headers,
        json={"reason": "Uygun değil."},
    )
    assert response.status_code == 403
