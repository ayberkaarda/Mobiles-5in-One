from dataclasses import dataclass, field

import httpx
import pytest
from fastapi import FastAPI

from app.core.deps import Services
from app.core.ids import uuid7
from app.models import Edit, Photo
from app.workers.export import export_city
from tests.domain.conftest import Account, Sample
from tests.support.app import FixedClock
from tests.support.domain import create_account, sign_in, trace_media_app
from tests.support.privacy import assert_no_trace_leak
from tests.support.routes import route_signatures
from tests.support.storage import S3Buckets
from tests.traces.test_derive_retention import linked_edit
from tests.traces.test_traces import RAW, upload

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"


@dataclass(frozen=True)
class Probe:
    path: str
    params: dict[str, str] = field(default_factory=dict)
    body: dict[str, object] | None = None
    status: int = 200
    headers: dict[str, str] = field(default_factory=dict)

    def request(self, client: httpx.AsyncClient, method: str) -> httpx.Request:
        return client.build_request(
            method, self.path, params=self.params, json=self.body, headers=self.headers
        )


PUBLIC_PROBES: dict[tuple[str, str], Probe] = {
    ("GET", "/v1/cities/{slug}/pack"): Probe(
        "/v1/cities/" + CITY + "/pack", headers={"X-Pack-Request": "1"}
    ),
    ("GET", "/v1/cities/{slug}/tiles.pmtiles"): Probe(
        "/v1/cities/" + CITY + "/tiles.pmtiles", status=404
    ),
    ("GET", "/v1/export/{city}/latest.geojson"): Probe("/v1/export/" + CITY + "/latest.geojson"),
    ("GET", "/v1/cities/{slug}/sitemap"): Probe("/v1/cities/" + CITY + "/sitemap"),
    ("POST", "/v1/plan"): Probe(
        "/v1/plan",
        body={
            "city": CITY,
            "from": {"lng": 34.01, "lat": 42.51},
            "to": {"lng": 34.09, "lat": 42.57},
            "max_transfers": 2,
        },
    ),
    ("GET", "/v1/health"): Probe("/v1/health"),
    ("GET", "/v1/cities"): Probe("/v1/cities"),
    ("GET", "/v1/cities/{slug}"): Probe("/v1/cities/" + CITY),
    ("GET", "/v1/lines"): Probe("/v1/lines", {"city": CITY}),
    ("GET", "/v1/lines/{slug}"): Probe("/v1/lines/ornek-hat-1", {"city": CITY}),
    ("GET", "/v1/lines/{slug}/versions"): Probe("/v1/lines/ornek-hat-1/versions", {"city": CITY}),
    ("GET", "/v1/stops/{slug}"): Probe("/v1/stops/ornek-durak-1-1", {"city": CITY}),
    ("GET", "/v1/stops/near"): Probe("/v1/stops/near", {"lng": "34.01", "lat": "42.51"}),
    ("POST", "/v1/auth/register"): Probe(
        "/v1/auth/register",
        body={
            "email": "privacy-register@example.com",
            "password": "privacy-password-42",
            "mode": "bearer",
        },
        status=202,
    ),
    ("POST", "/v1/auth/magic-link"): Probe(
        "/v1/auth/magic-link",
        body={
            "email": "privacy-missing@example.com",
        },
        status=202,
    ),
    ("POST", "/v1/auth/login"): Probe(
        "/v1/auth/login",
        body={
            "email": "privacy-missing@example.com",
            "password": "incorrect",
            "mode": "bearer",
        },
        status=401,
    ),
    ("POST", "/v1/auth/magic-link/verify"): Probe(
        "/v1/auth/magic-link/verify",
        body={
            "token": "invalid-token-1234567890",
            "mode": "bearer",
        },
        status=401,
    ),
    ("POST", "/v1/auth/refresh"): Probe(
        "/v1/auth/refresh",
        body={
            "refresh_token": "invalid-token-1234567890",
        },
        status=401,
    ),
}
PRIVATE_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/v1/auth/csrf"),
        ("POST", "/v1/auth/logout"),
        ("POST", "/v1/auth/logout-all"),
        ("GET", "/v1/me"),
        ("PATCH", "/v1/me"),
        ("DELETE", "/v1/me"),
        ("POST", "/v1/me/licence-accept"),
        ("POST", "/v1/edits"),
        ("GET", "/v1/edits"),
        ("GET", "/v1/edits/{identity}"),
        ("GET", "/v1/moderation/edits"),
        ("POST", "/v1/moderation/edits/{identity}/approve"),
        ("POST", "/v1/moderation/edits/{identity}/reject"),
        ("POST", "/v1/moderation/lines/{identity}/rollback"),
        ("GET", "/v1/me/favorites"),
        ("GET", "/v1/me/favorites/{line_id}"),
        ("PUT", "/v1/me/favorites/{line_id}"),
        ("DELETE", "/v1/me/favorites/{line_id}"),
        ("POST", "/v1/traces"),
        ("GET", "/v1/traces/{identity}"),
        ("DELETE", "/v1/traces/{identity}"),
        ("POST", "/v1/media/presign"),
    }
)


def public_app(services: Services) -> FastAPI:
    # Production exposes API routes; development documentation embeds private schema names.
    services.settings = services.settings.model_copy(update={"env": "production"})
    return trace_media_app(services)


def assert_classified(application: FastAPI) -> None:
    actual = route_signatures(application)
    assert actual, "no route was enumerated"
    assert not PUBLIC_PROBES.keys() & PRIVATE_ROUTES
    assert actual == PUBLIC_PROBES.keys() | PRIVATE_ROUTES


async def test_every_route_is_classified(services: Services) -> None:
    assert_classified(public_app(services))


async def test_public_responses_have_no_trace_data(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    moderator: Account,
    clock: FixedClock,
    s3_buckets: S3Buckets,
) -> None:
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    services.object_store = s3_buckets.store
    _, edit_id = await linked_edit(client, contributor, clock, sample)
    async with services.session_factory() as db:
        identity = uuid7()
        db.add(
            Photo(
                id=identity,
                owner_id=contributor.identity,
                key="photos/" + str(identity) + ".webp",
                kind="fare_table",
                moderation_state="pending",
                content_type="image/webp",
                byte_size=100,
                processed_at=clock.now(),
                created_at=clock.now(),
                updated_at=clock.now(),
            )
        )
        await db.flush()
        edit = await db.get(Edit, edit_id)
        assert edit is not None
        edit.photo_id = identity
        await db.commit()
    response = await client.post(
        "/v1/moderation/edits/" + str(edit_id) + "/approve", json={}, headers=moderator.headers
    )
    assert response.status_code == 200
    # The weekly export runs after the trace-derived version is published.
    await export_city(services.session_factory, s3_buckets.store, services.settings, clock, CITY)
    application = public_app(services)
    assert_classified(application)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="https://testserver"
    ) as anonymous:
        for (method, _), probe in PUBLIC_PROBES.items():
            result = await anonymous.send(probe.request(anonymous, method))
            assert result.status_code == probe.status, result.text
            assert_no_trace_leak(result.json(), RAW)
        detail = (await anonymous.get("/v1/lines/ornek-hat-1", params={"city": CITY})).json()
        assert RAW[0] not in detail["geometry"]["coordinates"]
        assert RAW[-1] not in detail["geometry"]["coordinates"]


async def test_trace_read_other_contributor_and_anonymous_denied(
    client: httpx.AsyncClient,
    services: Services,
    sample: Sample,
    contributor: Account,
    clock: FixedClock,
) -> None:
    identity = await upload(client, contributor, clock)
    _, email = await create_account(services)
    path = "/v1/traces/" + str(identity)
    assert (await client.get(path, headers=await sign_in(client, email))).status_code == 403
    assert (await client.get(path)).status_code == 401
