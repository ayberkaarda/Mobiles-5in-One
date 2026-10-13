"""Attack suite (spec section 6 item 23, phase 6 package 6B).

One section per heading of `docs/security/threat-model.md`, each with at least one executed
attack and the refusal the control must produce, followed by the section 6 extras (spoofed
client-IP headers, JWT tampering, refresh reuse, body limits, geometry, bbox, uploads, planner
inputs, mass assignment, enum fuzzing, search injection, CORS, host header, method override,
CSRF, step-up bypass, account enumeration and rate-limit bypass variants). Every request goes
through the real ASGI application (`create_app` with all routers) against a Testcontainers
PostGIS database; the upload section adds MinIO and the rate-limit section a real Redis.

The webhook forgery checks of phase 5 are not repeated (`tests/webhooks/*`, ADR-0050); the
webhook section here adds the one combination they do not cover: a forged purchase event
followed by the entitlement check it would unlock.
"""

import asyncio
import base64
import hashlib
import hmac
import io
import json
import unicodedata
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from geoalchemy2.shape import from_shape
from PIL import Image
from pydantic import BaseModel, SecretStr
from redis.asyncio import Redis
from shapely.geometry import Point, Polygon
from sqlalchemy import func, select

from app.auth.schemas import BearerOut, CookieOut
from app.auth.step_up import SessionStepUpSource
from app.billing.entitlements import SubscriptionEntitlements
from app.core.deps import Services
from app.core.ratelimit import RedisSlidingWindowLimiter
from app.core.storage import StoredObject
from app.models import City, Edit, Favorite, Line, Photo, Stop, Trace, User
from app.models.enums import UserRole
from app.models.ops import WebhookEvent
from app.workers.media import process_photo
from tests.auth.conftest import mailed_token
from tests.security.payloads import PAYLOADS, REFUSED, STORED, as_json, fit
from tests.support.app import FixedClock, RecordingMailSender, build_test_app
from tests.support.billing import rc_event
from tests.support.domain import PASSWORD, create_account, seed_city
from tests.support.storage import S3Buckets
from tests.totp.test_totp_step_up import enrol, verify, wrong_code

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

PEER = ("203.0.113.10", 50000)
PROXY_PEER = ("127.0.0.1", 50000)
WEB_ORIGIN = "https://app.inecekvar.app"
CITY = "ornek-test-sehri"
PROBLEM_KEYS = {"type", "title", "status", "code", "request_id"}
API_DIR = Path(__file__).resolve().parents[2]


# --- Harness ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Actor:
    identity: uuid.UUID
    email: str
    headers: dict[str, str]
    refresh_token: str


@dataclass(frozen=True)
class Sample:
    city_id: uuid.UUID
    line_id: uuid.UUID
    stop_ids: list[uuid.UUID]


@asynccontextmanager
async def connect(
    application: FastAPI,
    peer: tuple[str, int] = PEER,
    headers: Mapping[str, str] | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=application, client=peer)
    async with httpx.AsyncClient(
        transport=transport, base_url="https://testserver", headers=dict(headers or {})
    ) as client:
        yield client


async def login(client: httpx.AsyncClient, email: str, password: str = PASSWORD) -> httpx.Response:
    return await client.post(
        "/v1/auth/login", json={"email": email, "password": password, "mode": "bearer"}
    )


async def actor(
    client: httpx.AsyncClient,
    services: Services,
    role: UserRole = UserRole.CONTRIBUTOR,
    *,
    reputation: int = 0,
    licence_accepted: bool = True,
) -> Actor:
    identity, email = await create_account(
        services, role, reputation=reputation, licence_accepted=licence_accepted
    )
    response = await login(client, email)
    assert response.status_code == 200, response.text
    bearer = BearerOut.model_validate(response.json())
    return Actor(
        identity, email, {"Authorization": "Bearer " + bearer.access_token}, bearer.refresh_token
    )


async def sample(services: Services) -> Sample:
    await seed_city(services)
    async with services.session_factory() as db:
        city = await db.scalar(select(City).where(City.slug == CITY))
        line = await db.scalar(select(Line).where(Line.slug == "ornek-hat-1"))
        assert city is not None
        assert line is not None
        stops = list(
            await db.scalars(select(Stop.id).where(Stop.city_id == city.id).order_by(Stop.slug))
        )
        return Sample(city.id, line.id, stops)


async def add_city(services: Services, slug: str, *, is_sample: bool = False) -> uuid.UUID:
    async with services.session_factory() as db:
        city = City(
            name="Saldırı şehri " + slug,
            slug=slug,
            bbox=from_shape(
                Polygon(((35.0, 41.0), (35.1, 41.0), (35.1, 41.08), (35.0, 41.08))), srid=4326
            ),
            centroid=from_shape(Point(35.05, 41.04), srid=4326),
            timezone="Europe/Istanbul",
            is_sample=is_sample,
        )
        db.add(city)
        await db.commit()
        return city.id


def assert_problem(response: httpx.Response, status: int, code: str | None = None) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert PROBLEM_KEYS <= set(body) <= PROBLEM_KEYS | {"detail"}
    if code is not None:
        assert body["code"] == code, body


async def count(services: Services, model: type[Any]) -> int:
    async with services.session_factory() as db:
        return int(await db.scalar(select(func.count()).select_from(model)) or 0)


def new_line(stops: Sequence[uuid.UUID], **changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "kind": "new_line",
        "city": CITY,
        "code": "S-1",
        "name": "Saldırı hattı",
        "mode": "dolmus",
        "geometry": [[34.01, 42.51], [34.03, 42.51]],
        "stop_ids": [str(identity) for identity in stops[:2]],
        "payment_methods": ["nakit"],
    }
    body.update(changes)
    return body


def trace_body(points: list[list[float]], city: str = CITY) -> dict[str, object]:
    return {
        "city": city,
        "started_at": "2026-10-12T08:00:00+00:00",
        "ended_at": "2026-10-12T08:30:00+00:00",
        "points": points,
    }


TRACE_POINTS = [[34.0123457, 42.5123457], [34.0173457, 42.5163457], [34.0223457, 42.5203457]]


# --- Threat model: GPS trace privacy ---------------------------------------------------------


async def test_trace_privacy_other_owner_anonymous_and_public_reads(services: Services) -> None:
    await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        owner = await actor(client, services)
        other = await actor(client, services)
        created = await client.post(
            "/v1/traces", headers=owner.headers, json=trace_body(TRACE_POINTS)
        )
        assert created.status_code == 201, created.text
        identity = created.json()["id"]
        for headers, status in ((other.headers, 403), ({}, 401)):
            refused = await client.get(f"/v1/traces/{identity}", headers=headers)
            assert_problem(refused, status)
            assert "34.0123457" not in refused.text
        assert_problem(await client.delete(f"/v1/traces/{identity}", headers=other.headers), 403)
        assert (
            await client.get(f"/v1/traces/{identity}", headers=owner.headers)
        ).status_code == 200
        public = [
            f"/v1/lines?city={CITY}",
            f"/v1/cities/{CITY}",
            f"/v1/cities/{CITY}/sitemap",
            "/v1/stops/near?lat=42.5123457&lng=34.0123457&radius=2000",
            f"/v1/stops?city={CITY}",
        ]
        for path in public:
            response = await client.get(path)
            assert response.status_code == 200, path
            assert "34.0123457" not in response.text, path
            assert "42.5123457" not in response.text, path


# --- Threat model: data poisoning -------------------------------------------------------------


async def test_poisoned_proposals_are_refused_without_publication(services: Services) -> None:
    data = await sample(services)
    stops = data.stop_ids
    application = build_test_app(services)
    poisoned: list[dict[str, object]] = [
        new_line(stops, fare_minor=10_000_001),
        new_line(stops, fare_minor=-1),
        new_line(stops, geometry=[[34.01 + i / 1_000_000, 42.51] for i in range(5001)]),
        new_line(stops, geometry=[[34.01, 42.51], [35.5, 42.51]]),
        new_line(stops, geometry=[[34.01, 42.51], [34.09, 42.57], [34.01, 42.57], [34.09, 42.51]]),
        new_line(stops, geometry=[[34.01, 42.51], [34.01, 42.51]]),
        new_line(stops, geometry=[[200.0, 95.0], [34.01, 42.51]]),
        new_line(stops, geometry=[[34.01, 42.51, 7.0], [34.03, 42.51, 7.0]]),
        new_line(stops, state="approved"),
        new_line(stops, name="x" * 161),
        new_line(stops, name="Hat\u0007"),
        {
            "kind": "new_stop",
            "city": CITY,
            "name": "Dış",
            "location": [34.5, 42.9],
            "stop_kind": "formal",
        },
    ]
    async with connect(application) as client:
        contributor = await actor(client, services, reputation=100)
        for body in poisoned:
            response = await client.post("/v1/edits", headers=contributor.headers, json=body)
            assert_problem(response, 422)
        raw = json.dumps(new_line(stops)).replace("34.03", "NaN").encode()
        response = await client.post(
            "/v1/edits",
            headers=contributor.headers | {"Content-Type": "application/json"},
            content=raw,
        )
        assert_problem(response, 422)
        injection = "x'); DROP TABLE lines;--"
        stored = await client.post(
            "/v1/edits",
            headers=contributor.headers,
            json={
                "kind": "new_stop",
                "city": CITY,
                "name": injection,
                "location": [34.05, 42.54],
                "stop_kind": "formal",
            },
        )
        assert stored.status_code == 201, stored.text
        assert stored.json()["payload"]["name"] == injection
    assert await count(services, Edit) == 1
    assert await count(services, Line) == 3


# --- Threat model: sockpuppet approval -------------------------------------------------------


async def test_sockpuppet_cannot_approve_and_low_reputation_floods_are_capped(
    services: Services,
) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        author = await actor(client, services)
        puppet = await actor(client, services)
        created = await client.post(
            "/v1/edits",
            headers=author.headers,
            json={
                "kind": "fare_update",
                "line": str(data.line_id),
                "base_version_no": 1,
                "fare_minor": 2750,
            },
        )
        assert created.status_code == 201
        edit = created.json()["id"]
        assert_problem(
            await client.post(f"/v1/moderation/edits/{edit}/approve", headers=puppet.headers),
            403,
            "auth.forbidden",
        )
        assert_problem(
            await client.post(f"/v1/moderation/edits/{edit}/approve", headers=author.headers),
            403,
            "auth.forbidden",
        )
        statuses = []
        for index in range(11):
            response = await client.post(
                "/v1/edits",
                headers=puppet.headers,
                json={
                    "kind": "fare_update",
                    "line": str(data.line_id),
                    "base_version_no": 1,
                    "fare_minor": 3000 + index,
                },
            )
            statuses.append(response.status_code)
        assert statuses == [201] * 10 + [429]
    async with services.session_factory() as db:
        stored = await db.get(Edit, uuid.UUID(edit))
        assert stored is not None
        assert stored.state == "pending"


# --- Threat model: planner denial of service --------------------------------------------------


PLAN = {"city": CITY, "from": {"lat": 42.51, "lng": 34.01}, "to": {"lat": 42.57, "lng": 34.09}}


@pytest.mark.parametrize(
    "body",
    [
        {**PLAN, "from": {"lat": 41.0, "lng": 29.0}},
        {**PLAN, "to": {"lat": 42.9, "lng": 34.5}},
        {**PLAN, "max_transfers": 3},
        {**PLAN, "max_transfers": 99},
        {**PLAN, "max_transfers": -1},
        {**PLAN, "max_transfers": "2"},
        {**PLAN, "max_transfers": 2.5},
        {**PLAN, "max_transfers": True},
        {**PLAN, "from": {"lat": 91, "lng": 34.01}},
        {**PLAN, "from": {"lat": 42.51, "lng": 181}},
        {**PLAN, "from": {"lat": 1e308, "lng": 1e308}},
        {**PLAN, "from": "Kadıköy"},
        {**PLAN, "city": "ornek' OR '1'='1"},
        {**PLAN, "city": "x" * 81},
        {**PLAN, "degraded": False},
        {**PLAN, "from": {"lat": 42.51, "lng": 34.01, "radius": 999999}},
    ],
    ids=[
        "from-outside-bbox",
        "to-outside-bbox",
        "three-transfers",
        "absurd-transfers",
        "negative-transfers",
        "string-transfers",
        "float-transfers",
        "bool-transfers",
        "latitude-91",
        "longitude-181",
        "huge-coordinates",
        "string-point",
        "slug-injection",
        "long-slug",
        "extra-field",
        "nested-extra",
    ],
)
async def test_planner_refuses_outside_bbox_and_absurd_parameters(
    services: Services, body: dict[str, object]
) -> None:
    await sample(services)
    async with connect(build_test_app(services)) as client:
        response = await client.post("/v1/plan", json=body)
    assert_problem(response, 422)


async def test_planner_rejects_non_finite_numbers_and_floods(services: Services) -> None:
    await sample(services)
    async with connect(build_test_app(services)) as client:
        for literal in ("NaN", "Infinity", "-Infinity", "1e999"):
            raw = json.dumps(PLAN).replace("42.51", literal, 1).encode()
            response = await client.post(
                "/v1/plan", content=raw, headers={"Content-Type": "application/json"}
            )
            assert_problem(response, 422)
        same = {**PLAN, "to": PLAN["from"]}
        statuses = [(await client.post("/v1/plan", json=same)).status_code for _ in range(26)]
    assert statuses == [200] * 26
    async with connect(build_test_app(services)) as client:
        response = await client.post("/v1/plan", json=PLAN)
    # 4 refused + 26 accepted requests used the 30 per minute; the next one is refused.
    assert_problem(response, 429, "rate_limited")
    assert int(response.headers["retry-after"]) >= 1


# --- Threat model: PMTiles egress ------------------------------------------------------------


async def test_tiles_redirect_ignores_host_and_packs_are_capped(services: Services) -> None:
    services.settings = services.settings.model_copy(
        update={"pmtiles_base_url": "https://tiles.inecekvar.app"}
    )
    await sample(services)
    application = build_test_app(services)
    hostile = {
        "Host": "evil.example",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "http",
    }
    async with connect(application) as client:
        response = await client.get(f"/v1/cities/{CITY}/tiles.pmtiles", headers=hostile)
        assert response.status_code == 302
        assert response.headers["location"] == f"https://tiles.inecekvar.app/{CITY}.pmtiles"
        for path in (
            "/v1/cities/..%2F..%2Fadmin/tiles.pmtiles",
            "/v1/cities/evil.example/tiles.pmtiles",
        ):
            assert_problem(await client.get(path), 404)
        statuses = []
        for index in range(11):
            spoofed = {
                "X-Pack-Request": "1",
                "X-Real-IP": f"198.51.100.{index}",
                "X-Forwarded-For": f"192.0.2.{index}",
            }
            statuses.append(
                (await client.get(f"/v1/cities/{CITY}/pack", headers=spoofed)).status_code
            )
    assert statuses == [200] * 10 + [429]


# --- Threat model: plugin permission bypass ---------------------------------------------------


async def test_native_origins_cannot_use_or_obtain_cookie_sessions(services: Services) -> None:
    _, email = await create_account(services)
    application = build_test_app(services)
    async with connect(application, headers={"Origin": "capacitor://localhost"}) as native:
        refused = await native.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "cookie"}
        )
        assert_problem(refused, 403, "origin.not_allowed")
        assert "set-cookie" not in refused.headers
        bearer = await native.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "bearer"}
        )
        assert bearer.status_code == 200
        assert "set-cookie" not in bearer.headers
        assert bearer.headers["access-control-allow-origin"] == "capacitor://localhost"
        assert "access-control-allow-credentials" not in bearer.headers
    async with connect(application, headers={"Origin": WEB_ORIGIN}) as web:
        cookie = await web.post(
            "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "cookie"}
        )
        assert cookie.status_code == 200
        jar = dict(web.cookies.items())
    async with connect(application, headers={"Origin": "capacitor://localhost"}) as native:
        for name, value in jar.items():
            native.cookies.set(name, value)
        assert_problem(await native.get("/v1/me"), 403, "origin.not_allowed")


# --- Threat model: SSR cache poisoning (API side) --------------------------------------------


async def test_api_answers_are_uncacheable_json_and_never_reflect_host_or_query(
    services: Services,
) -> None:
    await sample(services)
    application = build_test_app(services)
    hostile = {
        "Host": "evil.example",
        "X-Forwarded-Host": "evil.example",
        "X-Original-URL": "/admin",
        "X-Rewrite-URL": "/admin",
    }
    async with connect(application) as client:
        reads = [
            f"/v1/lines/ornek-hat-1?city={CITY}&utm=%3Cscript%3Ealert(1)%3C/script%3E",
            f"/v1/cities/{CITY}?callback=%3Csvg%20onload%3Dalert(1)%3E",
            f"/v1/stops/%3Cscript%3E?city={CITY}",
            "/v1/lines?city=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E",
        ]
        for path in reads:
            response = await client.get(path, headers=hostile)
            assert response.status_code in {200, 404}, path
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.headers["content-type"].startswith(
                ("application/json", "application/problem+json")
            )
            assert "evil.example" not in response.text
            assert "<script" not in response.text
            assert "onerror" not in response.text
            assert "onload" not in response.text


# --- Threat model: account deletion ---------------------------------------------------------


async def test_deleted_account_tokens_traces_and_favourites_are_gone(services: Services) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        victim = await actor(client, services)
        trace = await client.post(
            "/v1/traces", headers=victim.headers, json=trace_body(TRACE_POINTS)
        )
        assert trace.status_code == 201
        assert (
            await client.put(f"/v1/me/favorites/{data.line_id}", headers=victim.headers)
        ).status_code == 204
        deleted = await client.request(
            "DELETE", "/v1/me", headers=victim.headers, json={"password": PASSWORD}
        )
        assert deleted.status_code == 202, deleted.text
        assert_problem(await client.get("/v1/me", headers=victim.headers), 401)
        assert_problem(
            await client.post("/v1/auth/refresh", json={"refresh_token": victim.refresh_token}),
            401,
        )
        assert_problem(
            await client.get(f"/v1/traces/{trace.json()['id']}", headers=victim.headers), 401
        )
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Trace)) == 0
        assert await db.scalar(select(func.count()).select_from(Favorite)) == 0
        user = await db.get(User, victim.identity)
        assert user is not None
        assert user.deactivated_at is not None


# --- Threat model: CSRF in cookie mode -------------------------------------------------------


async def cookie_session(application: FastAPI, email: str) -> tuple[httpx.AsyncClient, str]:
    transport = httpx.ASGITransport(app=application, client=PEER)
    client = httpx.AsyncClient(
        transport=transport, base_url="https://testserver", headers={"Origin": WEB_ORIGIN}
    )
    response = await client.post(
        "/v1/auth/login", json={"email": email, "password": PASSWORD, "mode": "cookie"}
    )
    assert response.status_code == 200, response.text
    return client, CookieOut.model_validate(response.json()).csrf_token


async def test_csrf_missing_foreign_cross_site_and_tunnelled_requests_are_refused(
    services: Services,
) -> None:
    identity, email = await create_account(services)
    application = build_test_app(services)
    first, token = await cookie_session(application, email)
    second, other_token = await cookie_session(application, email)
    try:
        attempts: list[tuple[dict[str, str], str]] = [
            ({}, "csrf.invalid"),
            ({"X-CSRF-Token": other_token}, "csrf.invalid"),
            ({"X-CSRF-Token": token + "x"}, "csrf.invalid"),
            ({"X-CSRF-Token": token.lower()}, "csrf.invalid"),
            ({"X-CSRF-Token": token, "Origin": "https://evil.example"}, "origin.not_allowed"),
            ({"X-CSRF-Token": token, "Origin": "capacitor://localhost"}, "origin.not_allowed"),
            ({"X-CSRF-Token": token, "Origin": "null"}, "origin.not_allowed"),
            ({"X-HTTP-Method-Override": "GET"}, "csrf.invalid"),
        ]
        for headers, code in attempts:
            response = await first.patch(
                "/v1/me", headers=headers, json={"display_name": "Saldırgan"}
            )
            assert_problem(response, 403, code)
        in_query = await first.patch(
            "/v1/me?csrf_token=" + token, json={"display_name": "Saldırgan"}
        )
        assert_problem(in_query, 403, "csrf.invalid")
        tunnelled = await first.post("/v1/auth/logout", headers={"X-HTTP-Method-Override": "GET"})
        assert_problem(tunnelled, 403, "csrf.invalid")
        assert (await first.get("/v1/me")).status_code == 200
        allowed = await first.patch(
            "/v1/me", headers={"X-CSRF-Token": token}, json={"display_name": "Sahibi"}
        )
        assert allowed.status_code == 200
    finally:
        await first.aclose()
        await second.aclose()
    async with services.session_factory() as db:
        user = await db.get(User, identity)
        assert user is not None
        assert user.display_name == "Sahibi"


# --- Threat model: Capacitor and CORS --------------------------------------------------------


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "null",
        "https://inecekvar.app.evil.example",
        "https://evilinecekvar.app",
        "http://inecekvar.app",
        "https://app.inecekvar.app:8443",
        "https://APP.INECEKVAR.APP",
        "capacitor://evil",
        "http://localhost:4200",
        "https://app.inecekvar.app, https://evil.example",
    ],
)
async def test_hostile_origins_get_no_cors_headers(services: Services, origin: str) -> None:
    await sample(services)
    async with connect(build_test_app(services)) as client:
        simple = await client.get(f"/v1/cities/{CITY}", headers={"Origin": origin})
        preflight = await client.options(
            "/v1/me",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type, x-csrf-token",
            },
        )
    assert simple.status_code == 200
    assert_problem(preflight, 403, "origin.not_allowed")
    for response in (simple, preflight):
        assert not [name for name in response.headers if name.lower().startswith("access-control-")]


async def test_duplicate_origin_headers_and_unlisted_preflight_headers_are_refused(
    services: Services,
) -> None:
    async with connect(build_test_app(services)) as client:
        duplicated = await client.get(
            "/v1/health", headers=[("Origin", WEB_ORIGIN), ("Origin", "https://evil.example")]
        )
        wildcard = await client.options(
            "/v1/me",
            headers={
                "Origin": WEB_ORIGIN,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "x-admin-override",
            },
        )
        verb = await client.options(
            "/v1/me",
            headers={"Origin": WEB_ORIGIN, "Access-Control-Request-Method": "TRACE"},
        )
        native = await client.options(
            "/v1/me",
            headers={
                "Origin": "capacitor://localhost",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert "access-control-allow-origin" not in duplicated.headers
    assert_problem(wildcard, 403, "origin.not_allowed")
    assert_problem(verb, 403, "origin.not_allowed")
    assert native.status_code == 204
    assert native.headers["access-control-allow-origin"] == "capacitor://localhost"
    assert "access-control-allow-credentials" not in native.headers
    assert "*" not in native.headers["access-control-allow-headers"]


# --- Threat model: webhook forgery (phase 5 suite is the reference) ---------------------------


async def test_forged_purchase_event_unlocks_no_second_city(
    services: Services, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(
        update={"revenuecat_webhook_secret": SecretStr("rc-webhook-" + "s" * 40)}
    )
    services.entitlements = SubscriptionEntitlements()
    await sample(services)
    await add_city(services, "ikinci-sehir")
    application = build_test_app(services)
    async with connect(application) as client:
        attacker = await actor(client, services)
        body = json.dumps(rc_event("INITIAL_PURCHASE", str(attacker.identity), clock.now()))
        for authorization in (None, "Bearer guessed", attacker.headers["Authorization"]):
            headers = {"Content-Type": "application/json"}
            if authorization is not None:
                headers["Authorization"] = authorization
            forged = await client.post("/v1/webhooks/revenuecat", content=body, headers=headers)
            assert_problem(forged, 401, "webhook.unauthorized")
        pack = attacker.headers | {"X-Pack-Request": "1"}
        assert (await client.get(f"/v1/cities/{CITY}/pack", headers=pack)).status_code == 200
        second = await client.get("/v1/cities/ikinci-sehir/pack", headers=pack)
        assert_problem(second, 403, "pack.entitlement_required")
    assert await count(services, WebhookEvent) == 0


# --- Threat model: pack entitlement bypass ----------------------------------------------------


async def test_second_city_refused_despite_forged_purchase_flags(services: Services) -> None:
    services.entitlements = SubscriptionEntitlements()
    await sample(services)
    await add_city(services, "ikinci-sehir")
    application = build_test_app(services)
    forged = {
        "X-Pack-Request": "1",
        "X-Plus": "1",
        "X-Entitlement": "plus",
        "X-RevenueCat-Entitlement": "plus",
        "X-Purchase-Token": "fake-purchase",
    }
    async with connect(application) as client:
        assert (await client.get(f"/v1/cities/{CITY}/pack", headers=forged)).status_code == 200
        for query in ("", "?plus=1", "?entitlement=plus&is_plus=true"):
            response = await client.get(f"/v1/cities/ikinci-sehir/pack{query}", headers=forged)
            assert_problem(response, 403, "pack.entitlement_required")
        user = await actor(client, services)
        signed = user.headers | forged
        assert (await client.get(f"/v1/cities/{CITY}/pack", headers=signed)).status_code == 200
        response = await client.get("/v1/cities/ikinci-sehir/pack?plus=1", headers=signed)
        assert_problem(response, 403, "pack.entitlement_required")
        assert_problem(await client.get(f"/v1/cities/{CITY}/pack"), 422)


# --- Threat model: refresh token reuse --------------------------------------------------------


async def test_refresh_reuse_kills_the_whole_family(services: Services) -> None:
    application = build_test_app(services)
    async with connect(application) as client:
        victim = await actor(client, services)
        rotated = await client.post(
            "/v1/auth/refresh", json={"refresh_token": victim.refresh_token}
        )
        assert rotated.status_code == 200
        child = rotated.json()
        replayed = await client.post(
            "/v1/auth/refresh", json={"refresh_token": victim.refresh_token}
        )
        assert_problem(replayed, 401, "auth.token_invalid")
        assert_problem(
            await client.post("/v1/auth/refresh", json={"refresh_token": child["refresh_token"]}),
            401,
            "auth.token_invalid",
        )
        assert_problem(
            await client.get(
                "/v1/me", headers={"Authorization": "Bearer " + child["access_token"]}
            ),
            401,
        )
        assert_problem(await client.get("/v1/me", headers=victim.headers), 401)
        racer = await actor(client, services)
        first, second = await asyncio.gather(
            client.post("/v1/auth/refresh", json={"refresh_token": racer.refresh_token}),
            client.post("/v1/auth/refresh", json={"refresh_token": racer.refresh_token}),
        )
    assert sorted([first.status_code, second.status_code]) == [200, 401]


# --- Threat model: magic link interception ----------------------------------------------------


async def test_magic_links_are_single_use_expiring_and_unguessable(
    services: Services, clock: FixedClock
) -> None:
    mail = cast(RecordingMailSender, services.mail_sender)
    _, email = await create_account(services)
    application = build_test_app(services)
    async with connect(application) as client:
        assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
        token = mailed_token(mail)
        body = {"token": token, "mode": "bearer"}
        tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
        assert_problem(
            await client.post("/v1/auth/magic-link/verify", json=body | {"token": tampered}),
            401,
            "auth.token_invalid",
        )
        first, second = await asyncio.gather(
            client.post("/v1/auth/magic-link/verify", json=body),
            client.post("/v1/auth/magic-link/verify", json=body),
        )
        assert sorted([first.status_code, second.status_code]) == [200, 401]
        assert_problem(
            await client.post("/v1/auth/magic-link/verify", json=body), 401, "auth.token_invalid"
        )
        clock.advance(seconds=1)
        assert (await client.post("/v1/auth/magic-link", json={"email": email})).status_code == 202
        late = mailed_token(mail)
        clock.advance(minutes=15, seconds=1)
        assert_problem(
            await client.post("/v1/auth/magic-link/verify", json={"token": late, "mode": "bearer"}),
            401,
            "auth.token_invalid",
        )
        assert token not in (first.text + second.text)


# --- Threat model: moderator collusion -------------------------------------------------------


async def test_reciprocal_approval_between_two_moderators_is_refused(services: Services) -> None:
    await sample(services)
    application = build_test_app(services)

    def stop(name: str) -> dict[str, object]:
        return {
            "kind": "new_stop",
            "city": CITY,
            "name": name,
            "location": [34.05, 42.54],
            "stop_kind": "formal",
        }

    async with connect(application) as client:
        first = await actor(client, services, UserRole.MODERATOR)
        second = await actor(client, services, UserRole.MODERATOR)
        own = await client.post("/v1/edits", headers=first.headers, json=stop("Birinci durak"))
        assert own.status_code == 201
        approved = await client.post(
            f"/v1/moderation/edits/{own.json()['id']}/approve", headers=second.headers
        )
        assert approved.status_code == 200, approved.text
        favour = await client.post("/v1/edits", headers=second.headers, json=stop("İkinci durak"))
        assert favour.status_code == 201
        returned = await client.post(
            f"/v1/moderation/edits/{favour.json()['id']}/approve", headers=first.headers
        )
        assert_problem(returned, 409, "moderation.reciprocal_conflict")
    async with services.session_factory() as db:
        stored = await db.get(Edit, uuid.UUID(favour.json()["id"]))
        assert stored is not None
        assert stored.state == "pending"


# --- Threat model: photo upload abuse ---------------------------------------------------------


def webp_with_gps() -> bytes:
    output = io.BytesIO()
    exif = Image.Exif()
    exif[271] = "Telefon"
    exif[34853] = {1: "N", 2: (42.0, 30.0, 0.0), 3: "E", 4: (34.0, 0.0, 0.0)}
    with Image.new("RGB", (2400, 1200), (20, 30, 60)) as image:
        image.save(output, format="WEBP", exif=exif)
    return output.getvalue()


async def test_upload_type_size_spoof_and_metadata_attacks(
    services: Services, s3_buckets: S3Buckets
) -> None:
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    application = build_test_app(services)
    async with connect(application) as client:
        uploader = await actor(client, services)
        refused = [
            {"kind": "fare_table", "content_type": "image/svg+xml", "byte_size": 100},
            {"kind": "fare_table", "content_type": "image/png", "byte_size": 100},
            {"kind": "fare_table", "content_type": "text/html", "byte_size": 100},
            {"kind": "fare_table", "content_type": "image/jpeg; charset=utf-8", "byte_size": 100},
            {"kind": "fare_table", "content_type": "image/jpeg", "byte_size": 4 * 1024 * 1024 + 1},
            {"kind": "fare_table", "content_type": "image/jpeg", "byte_size": 0},
            {"kind": "avatar", "content_type": "image/jpeg", "byte_size": 100},
            {
                "kind": "fare_table",
                "content_type": "image/jpeg",
                "byte_size": 100,
                "key": "photos/forged.webp",
            },
        ]
        for body in refused:
            assert_problem(
                await client.post("/v1/media/presign", headers=uploader.headers, json=body), 422
            )

        async def upload(data: bytes, content_type: str) -> uuid.UUID:
            presigned = await client.post(
                "/v1/media/presign",
                headers=uploader.headers,
                json={"kind": "stop_sign", "content_type": content_type, "byte_size": len(data)},
            )
            assert presigned.status_code == 201, presigned.text
            body = presigned.json()
            async with httpx.AsyncClient() as raw:
                put = await raw.put(body["upload_url"], content=data, headers=body["headers"])
            assert put.status_code == 200
            return uuid.UUID(body["photo_id"])

        polyglot = b"\xff\xd8\xff\xe0" + b"<html><script>alert(1)</script></html>" * 4
        spoofed = await upload(polyglot, "image/jpeg")
        svg = await upload(
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "image/webp"
        )
        located = await upload(webp_with_gps(), "image/webp")
    for identity in (spoofed, svg):
        outcome = await process_photo(
            services.session_factory, s3_buckets.store, services.settings, services.clock, identity
        )
        assert outcome == "quarantined"
    assert (
        await process_photo(
            services.session_factory, s3_buckets.store, services.settings, services.clock, located
        )
        == "pending"
    )
    stored = await s3_buckets.store.get(
        s3_buckets.media_bucket, "photos/" + str(located) + ".webp", 4 * 1024 * 1024
    )
    with Image.open(io.BytesIO(stored)) as image:
        assert not image.getexif()
        assert not {"exif", "icc_profile", "xmp"}.intersection(image.info)
        assert max(image.size) <= 1600
    async with services.session_factory() as db:
        for identity in (spoofed, svg):
            photo = await db.get(Photo, identity)
            assert photo is not None
            assert photo.moderation_state == "quarantined"


# --- Threat model: object authorization bypass ------------------------------------------------


async def test_favourites_and_edit_lists_are_scoped_to_the_caller(services: Services) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        owner = await actor(client, services)
        intruder = await actor(client, services)
        assert (
            await client.put(f"/v1/me/favorites/{data.line_id}", headers=owner.headers)
        ).status_code == 204
        created = await client.post(
            "/v1/edits",
            headers=owner.headers,
            json={
                "kind": "fare_update",
                "line": str(data.line_id),
                "base_version_no": 1,
                "fare_minor": 2600,
            },
        )
        assert created.status_code == 201
        assert_problem(
            await client.get(f"/v1/me/favorites/{data.line_id}", headers=intruder.headers), 404
        )
        assert (await client.get("/v1/me/favorites", headers=intruder.headers)).json() == []
        assert (await client.get("/v1/edits", headers=intruder.headers)).json() == []
        assert_problem(
            await client.get(f"/v1/edits/{created.json()['id']}", headers=intruder.headers), 403
        )
        removal = await client.delete(f"/v1/me/favorites/{data.line_id}", headers=intruder.headers)
        assert removal.status_code == 204
        assert len((await client.get("/v1/me/favorites", headers=owner.headers)).json()) == 1
        role = await client.patch(
            f"/v1/admin/users/{intruder.identity}/role",
            headers=intruder.headers,
            json={"role": "admin"},
        )
        assert_problem(role, 403)


# --- Threat model: rate-limit and token tampering (JWT) ----------------------------------------


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unsigned(header: dict[str, object], claims: dict[str, object]) -> bytes:
    return (b64(json.dumps(header).encode()) + "." + b64(json.dumps(claims).encode())).encode()


def attacker_key() -> bytes:
    return ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


async def test_tampered_access_tokens_are_refused(services: Services, clock: FixedClock) -> None:
    application = build_test_app(services)
    settings = services.settings
    async with connect(application) as client:
        victim = await actor(client, services, UserRole.USER)
        attacker = await actor(client, services, UserRole.USER)
        genuine = victim.headers["Authorization"].removeprefix("Bearer ")
        claims = cast(
            dict[str, object],
            jwt.decode(genuine, options={"verify_signature": False}),
        )
        now = int(clock.now().timestamp())
        private = settings.jwt_private_key()
        public = settings.jwt_public_key()
        forged: dict[str, str] = {}
        forged["alg-none"] = unsigned({"alg": "none", "typ": "JWT"}, claims).decode() + "."
        signing_input = unsigned({"alg": "HS256", "typ": "JWT"}, claims)
        forged["hs256-public-key"] = (
            signing_input.decode()
            + "."
            + b64(hmac.new(public, signing_input, hashlib.sha256).digest())
        )
        forged["attacker-key-with-kid"] = jwt.encode(
            claims,
            attacker_key(),
            algorithm="ES256",
            headers={"kid": "../../../../dev/null", "jku": "https://evil.example/jwks.json"},
        )
        forged["genuine-header-other-signature"] = (
            genuine.rsplit(".", 1)[0] + "." + attacker.headers["Authorization"].rsplit(".", 1)[1]
        )
        forged["expired"] = jwt.encode(
            claims | {"iat": now - 3600, "nbf": now - 3600, "exp": now - 1}, private, "ES256"
        )
        forged["not-yet-valid"] = jwt.encode(claims | {"nbf": now + 600}, private, "ES256")
        forged["wrong-audience"] = jwt.encode(claims | {"aud": "other-api"}, private, "ES256")
        forged["wrong-issuer"] = jwt.encode(
            claims | {"iss": "https://evil.example"}, private, "ES256"
        )
        forged["refresh-typ"] = jwt.encode(claims | {"typ": "refresh"}, private, "ES256")
        forged["float-expiry"] = jwt.encode(claims | {"exp": float(now + 600)}, private, "ES256")
        forged["missing-sid"] = jwt.encode(
            {key: value for key, value in claims.items() if key != "sid"}, private, "ES256"
        )
        forged["other-subject-same-family"] = jwt.encode(
            claims | {"sub": str(attacker.identity)}, private, "ES256"
        )
        forged["attacker-key-other-subject"] = jwt.encode(
            claims | {"sub": str(attacker.identity)}, attacker_key(), "ES256"
        )
        for name, token in forged.items():
            response = await client.get("/v1/me", headers={"Authorization": "Bearer " + token})
            assert_problem(response, 401, "auth.required")
            assert victim.email not in response.text, name
        for header in ("Basic " + b64(b"a:b"), "Bearer", "Bearer a b", "bearer\t" + genuine):
            assert_problem(await client.get("/v1/me", headers={"Authorization": header}), 401)
        elevated = jwt.encode(claims | {"role": "admin"}, private, "ES256")
        response = await client.get(
            "/v1/admin/users", headers={"Authorization": "Bearer " + elevated}
        )
        assert_problem(response, 403, "auth.forbidden")


# --- Threat model: secret exposure and recovery failure ---------------------------------------


async def test_forced_errors_and_validation_failures_echo_nothing(services: Services) -> None:
    application = build_test_app(services)

    async def explode() -> None:
        raise RuntimeError("database password inecekvar_local_dev at 10.0.0.5")

    application.add_api_route("/v1/_attack/explode", explode, methods=["GET"])
    secret = "Gizli-Parola-" + uuid.uuid4().hex
    async with connect(application) as client:
        crash = await client.get("/v1/_attack/explode")
        assert_problem(crash, 500, "internal")
        assert "inecekvar_local_dev" not in crash.text
        assert "Traceback" not in crash.text
        echo = await client.post(
            "/v1/auth/login",
            json={"email": "not-an-email", "password": secret, "mode": "bearer", "x": secret},
        )
        assert_problem(echo, 422, "validation.failed")
        assert secret not in echo.text
        edit = await client.post("/v1/plan", json={"city": secret})
        assert_problem(edit, 422)
        assert secret not in edit.text


# --- Section 6 extras: oversized bodies and traces -------------------------------------------


async def test_body_limits_refuse_declared_streamed_and_oversized_traces(
    services: Services,
) -> None:
    await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        contributor = await actor(client, services)
        headers = contributor.headers | {"Content-Type": "application/json"}
        general = b'{"kind":"new_stop","name":"' + b"x" * (1024 * 1024) + b'"}'
        assert_problem(
            await client.post("/v1/edits", headers=headers, content=general),
            413,
            "request.body_too_large",
        )

        async def stream() -> AsyncIterator[bytes]:
            yield b'{"points":['
            for _ in range(80):
                yield b"[34.0123,42.5123]," * 2000
            yield b"[34.0,42.5]]}"

        streamed = await client.post("/v1/traces", headers=headers, content=stream())
        assert_problem(streamed, 413, "request.body_too_large")
        points = [[34.01 + i / 10_000_000, 42.51] for i in range(100_000)]
        oversized_trace = json.dumps(trace_body(points)).encode()
        assert len(oversized_trace) > 2 * 1024 * 1024
        assert_problem(
            await client.post("/v1/traces", headers=headers, content=oversized_trace),
            413,
            "request.body_too_large",
        )
        within = json.dumps(trace_body([[34.01 + i / 10_000_000, 42.51] for i in range(55_000)]))
        assert 1024 * 1024 < len(within) < 2 * 1024 * 1024
        # Past the 1 MiB general limit but inside the 2 MiB trace limit: validation answers.
        assert_problem(
            await client.post("/v1/traces", headers=headers, content=within.encode()), 422
        )
        lying = await client.post(
            "/v1/edits",
            headers=headers | {"Content-Length": "abc"},
            content=b"{}",
        )
        assert lying.status_code in {400, 413}
        form = await client.post(
            "/v1/edits",
            headers=contributor.headers | {"Content-Type": "text/plain"},
            content=b'{"kind":"new_stop"}',
        )
        assert_problem(form, 415, "request.unsupported_media_type")
    assert await count(services, Trace) == 0


# --- Section 6 extras: coordinates outside the city bbox ---------------------------------------


async def test_coordinates_outside_the_city_are_refused_on_every_write(services: Services) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        contributor = await actor(client, services, reputation=100)
        outside = [
            ("/v1/traces", trace_body([[34.01, 42.51], [34.2, 42.51]]), "trace.outside_bbox"),
            (
                "/v1/edits",
                {
                    "kind": "new_stop",
                    "city": CITY,
                    "name": "Dışarıda",
                    "location": [34.11, 42.54],
                    "stop_kind": "informal",
                },
                "edit.outside_bbox",
            ),
            (
                "/v1/edits",
                new_line(data.stop_ids, geometry=[[34.01, 42.51], [34.05, 42.59]]),
                "edit.outside_bbox",
            ),
            (
                "/v1/edits",
                {
                    "kind": "update_line",
                    "line": str(data.line_id),
                    "base_version_no": 1,
                    "changes": {"geometry": [[34.01, 42.51], [33.99, 42.51]]},
                },
                "edit.outside_bbox",
            ),
        ]
        for path, body, code in outside:
            assert_problem(
                await client.post(path, headers=contributor.headers, json=body), 422, code
            )
        stop = data.stop_ids[0]
        moved = await client.post(
            "/v1/edits",
            headers=contributor.headers,
            json={"kind": "update_stop", "stop": str(stop), "changes": {"location": [29.0, 41.0]}},
        )
        assert_problem(moved, 422, "edit.outside_bbox")
    assert await count(services, Edit) == 0


# --- Section 6 extras: one refusal per field bound (docs/security/input-constraints.md) --------


ZERO_UUID = "00000000-0000-7000-8000-000000000000"
STOPS_PLACEHOLDER = "{stops}"


def line_with(**changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "kind": "new_line",
        "city": CITY,
        "code": "S-1",
        "name": "Sınır hattı",
        "mode": "dolmus",
        "geometry": [[34.01, 42.51], [34.03, 42.51]],
        "stop_ids": STOPS_PLACEHOLDER,
        "payment_methods": ["nakit"],
    }
    body.update(changes)
    return body


# (id, role, method, path, json body or None, query or None)
BOUNDS: list[tuple[str, UserRole | None, str, str, object, dict[str, str] | None]] = [
    ("name-161", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(name="n" * 161), None),
    ("code-33", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(code="A" * 33), None),
    ("code-pattern", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(code="<b>1"), None),
    ("city-slug-81", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(city="c" * 81), None),
    ("hours-501", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(hours_text="h" * 501), None),
    (
        "notes-1001",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        line_with(hail_notes="n" * 1001),
        None,
    ),
    ("blank-name", UserRole.CONTRIBUTOR, "POST", "/v1/edits", line_with(name="   "), None),
    (
        "stop-ids-one",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        line_with(stop_ids=[ZERO_UUID]),
        None,
    ),
    (
        "stop-ids-201",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        line_with(stop_ids=[str(uuid.UUID(int=index)) for index in range(201)]),
        None,
    ),
    (
        "payments-four",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        line_with(payment_methods=["nakit", "kart", "istanbulkart", "kart"]),
        None,
    ),
    (
        "geometry-one-point",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        line_with(geometry=[[34.01, 42.51]]),
        None,
    ),
    (
        "base-version-zero",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        {"kind": "fare_update", "line": ZERO_UUID, "base_version_no": 0, "fare_minor": 100},
        None,
    ),
    (
        "retire-reason-501",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/edits",
        {"kind": "retire", "line": ZERO_UUID, "reason": "r" * 501},
        None,
    ),
    (
        "reject-reason-1001",
        UserRole.MODERATOR,
        "POST",
        f"/v1/moderation/edits/{ZERO_UUID}/reject",
        {"reason": "r" * 1001},
        None,
    ),
    (
        "reject-reason-blank",
        UserRole.MODERATOR,
        "POST",
        f"/v1/moderation/edits/{ZERO_UUID}/reject",
        {"reason": " \t "},
        None,
    ),
    (
        "rollback-version-zero",
        UserRole.MODERATOR,
        "POST",
        f"/v1/moderation/lines/{ZERO_UUID}/rollback",
        {"version_no": 0},
        None,
    ),
    ("display-name-61", UserRole.CONTRIBUTOR, "PATCH", "/v1/me", {"display_name": "d" * 61}, None),
    (
        "display-name-control",
        UserRole.CONTRIBUTOR,
        "PATCH",
        "/v1/me",
        {"display_name": "Ad\u0000Soyad"},
        None,
    ),
    ("email-321", None, "POST", "/v1/auth/magic-link", {"email": "e" * 309 + "@example.com"}, None),
    (
        "password-1025",
        None,
        "POST",
        "/v1/auth/login",
        {"email": "a@example.com", "password": "p" * 1025, "mode": "bearer"},
        None,
    ),
    ("token-short", None, "POST", "/v1/auth/refresh", {"refresh_token": "abc"}, None),
    ("token-charset", None, "POST", "/v1/auth/refresh", {"refresh_token": "!" * 32}, None),
    ("totp-code-five", UserRole.CONTRIBUTOR, "POST", "/v1/auth/step-up", {"code": "12345"}, None),
    (
        "totp-code-letters",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/auth/step-up",
        {"code": "12a456"},
        None,
    ),
    (
        "trace-city-81",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body(TRACE_POINTS, city="c" * 81),
        None,
    ),
    (
        "trace-one-point",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body(TRACE_POINTS[:1]),
        None,
    ),
    (
        "trace-naive-time",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body(TRACE_POINTS) | {"started_at": "2026-10-12T08:00:00"},
        None,
    ),
    (
        "trace-span-13h",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body(TRACE_POINTS) | {"started_at": "2026-10-11T19:00:00+00:00"},
        None,
    ),
    (
        "trace-over-150km",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body([[34.0, 42.5], [35.0, 42.5], [34.0, 42.51], [35.0, 42.51]]),
        None,
    ),
    (
        "trace-string-number",
        UserRole.CONTRIBUTOR,
        "POST",
        "/v1/traces",
        trace_body([["34.01", "42.51"], ["34.02", "42.52"]]),
        None,
    ),
    (
        "near-radius-2001",
        None,
        "GET",
        "/v1/stops/near",
        None,
        {"lat": "42.5", "lng": "34.0", "radius": "2001"},
    ),
    ("near-latitude-91", None, "GET", "/v1/stops/near", None, {"lat": "91", "lng": "34.0"}),
    ("lines-limit-101", None, "GET", "/v1/lines", None, {"city": CITY, "limit": "101"}),
    ("lines-offset-negative", None, "GET", "/v1/lines", None, {"city": CITY, "offset": "-1"}),
    ("stops-limit-51", None, "GET", "/v1/stops", None, {"city": CITY, "limit": "51"}),
]


@pytest.mark.parametrize(
    ("role", "method", "path", "body", "query"),
    [case[1:] for case in BOUNDS],
    ids=[case[0] for case in BOUNDS],
)
async def test_field_bounds_are_refused(
    services: Services,
    role: UserRole | None,
    method: str,
    path: str,
    body: object,
    query: dict[str, str] | None,
) -> None:
    data = await sample(services)
    async with connect(build_test_app(services)) as client:
        headers: dict[str, str] = {}
        if role is not None:
            headers = (await actor(client, services, role, reputation=100)).headers
        if isinstance(body, dict) and body.get("stop_ids") == STOPS_PLACEHOLDER:
            body = body | {"stop_ids": [str(identity) for identity in data.stop_ids[:2]]}
        response = await client.request(method, path, headers=headers, json=body, params=query)
    assert_problem(response, 422, "validation.failed")


# --- Section 6 extras: mass assignment ---------------------------------------------------------


BODY_ROUTES: dict[tuple[str, str], str] = {
    ("POST", "/v1/auth/register"): "role",
    ("POST", "/v1/auth/magic-link"): "role",
    ("POST", "/v1/auth/magic-link/verify"): "user_id",
    ("POST", "/v1/auth/login"): "role",
    ("POST", "/v1/auth/refresh"): "user_id",
    ("PATCH", "/v1/me"): "role",
    ("POST", "/v1/me/licence-accept"): "role",
    ("DELETE", "/v1/me"): "user_id",
    ("POST", "/v1/me/totp/enrol"): "secret",
    ("POST", "/v1/me/totp/confirm"): "secret",
    ("POST", "/v1/auth/step-up"): "verified_at",
    ("POST", "/v1/edits"): "author_id",
    ("POST", "/v1/moderation/edits/{identity}/reject"): "state",
    ("POST", "/v1/moderation/lines/{identity}/rollback"): "published_by",
    ("POST", "/v1/traces"): "author_id",
    ("POST", "/v1/media/presign"): "owner_id",
    ("POST", "/v1/plan"): "degraded",
    ("PATCH", "/v1/admin/users/{identity}/role"): "totp_enabled",
    ("DELETE", "/v1/admin/suppressions"): "reason",
}


def body_models(application: FastAPI) -> dict[tuple[str, str], object]:
    from fastapi.routing import APIRoute

    found: dict[tuple[str, str], object] = {}
    for route in application.routes:
        contexts = getattr(route, "effective_route_contexts", None)
        pairs: list[tuple[object, str]] = []
        if callable(contexts):
            pairs = [(context.original_route, str(context.path)) for context in contexts()]
        elif isinstance(route, APIRoute):
            pairs = [(route, route.path)]
        for original, path in pairs:
            if isinstance(original, APIRoute) and original.body_field is not None:
                for method in original.methods or set():
                    found[(method, path)] = original.body_field.field_info.annotation
    return found


def forbids_extra(annotation: object, seen: set[type[BaseModel]]) -> list[str]:
    import typing

    failures: list[str] = []
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if annotation in seen:
            return failures
        seen.add(annotation)
        if annotation.model_config.get("extra") != "forbid":
            failures.append(annotation.__name__)
        for field in annotation.model_fields.values():
            failures.extend(forbids_extra(field.annotation, seen))
        return failures
    for argument in typing.get_args(annotation):
        failures.extend(forbids_extra(argument, seen))
    origin = typing.get_origin(annotation)
    if origin is not None and hasattr(origin, "__value__"):
        failures.extend(forbids_extra(origin.__value__, seen))
    value = getattr(annotation, "__value__", None)
    if value is not None:
        failures.extend(forbids_extra(value, seen))
    return failures


def test_every_body_route_is_listed_and_forbids_extra_fields() -> None:
    from app.main import create_app
    from tests.support.app import make_test_settings

    models = body_models(create_app(make_test_settings()))
    assert set(models) == set(BODY_ROUTES)
    failures = [name for model in models.values() for name in forbids_extra(model, set())]
    assert failures == []


class UnreachableStore:
    """Configured but never reached: the refused requests stop at validation."""

    async def presign_put(
        self, bucket: str, key: str, content_type: str, content_length: int, expires_in: int
    ) -> str:
        raise AssertionError("a refused request reached the object store")

    async def head(self, bucket: str, key: str) -> StoredObject | None:
        raise AssertionError("a refused request reached the object store")

    async def get(self, bucket: str, key: str, max_bytes: int) -> bytes:
        raise AssertionError("a refused request reached the object store")

    async def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        raise AssertionError("a refused request reached the object store")

    async def delete(self, bucket: str, key: str) -> None:
        raise AssertionError("a refused request reached the object store")

    async def list_keys(self, bucket: str, prefix: str) -> list[str]:
        raise AssertionError("a refused request reached the object store")


async def stepped_up_admin(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> Actor:
    admin = await actor(client, services, UserRole.ADMIN)
    secret = (await enrol(client, admin.headers)).secret
    assert (
        await verify(client, admin.headers, secret, clock, "/v1/me/totp/confirm")
    ).status_code == 200
    clock.advance(seconds=30)
    assert (await verify(client, admin.headers, secret, clock)).status_code == 200
    return admin


async def test_mass_assignment_is_refused_on_every_body_route(
    services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    services.object_store = UnreachableStore()
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        contributor = await actor(client, services, reputation=100)
        moderator = await actor(client, services, UserRole.MODERATOR)
        admin = await stepped_up_admin(client, services, clock)
        pending = await client.post(
            "/v1/edits",
            headers=contributor.headers,
            json={
                "kind": "fare_update",
                "line": str(data.line_id),
                "base_version_no": 1,
                "fare_minor": 2900,
            },
        )
        assert pending.status_code == 201
        edit = pending.json()["id"]
        bodies: dict[tuple[str, str], tuple[str, dict[str, object], dict[str, str]]] = {
            ("POST", "/v1/auth/register"): (
                "/v1/auth/register",
                {"email": "yeni@example.com", "password": "uzun-parola-2026", "mode": "bearer"},
                {},
            ),
            ("POST", "/v1/auth/magic-link"): (
                "/v1/auth/magic-link",
                {"email": "a@example.com"},
                {},
            ),
            ("POST", "/v1/auth/magic-link/verify"): (
                "/v1/auth/magic-link/verify",
                {"token": "a" * 43, "mode": "bearer"},
                {},
            ),
            ("POST", "/v1/auth/login"): (
                "/v1/auth/login",
                {"email": contributor.email, "password": PASSWORD, "mode": "bearer"},
                {},
            ),
            ("POST", "/v1/auth/refresh"): (
                "/v1/auth/refresh",
                {"refresh_token": contributor.refresh_token},
                {},
            ),
            ("PATCH", "/v1/me"): ("/v1/me", {"display_name": "Ad"}, contributor.headers),
            ("POST", "/v1/me/licence-accept"): ("/v1/me/licence-accept", {}, contributor.headers),
            ("DELETE", "/v1/me"): ("/v1/me", {"password": PASSWORD}, contributor.headers),
            ("POST", "/v1/me/totp/enrol"): ("/v1/me/totp/enrol", {}, contributor.headers),
            ("POST", "/v1/me/totp/confirm"): (
                "/v1/me/totp/confirm",
                {"code": "123456"},
                contributor.headers,
            ),
            ("POST", "/v1/auth/step-up"): ("/v1/auth/step-up", {"code": "123456"}, admin.headers),
            ("POST", "/v1/edits"): (
                "/v1/edits",
                {
                    "kind": "fare_update",
                    "line": str(data.line_id),
                    "base_version_no": 1,
                    "fare_minor": 3100,
                },
                contributor.headers,
            ),
            ("POST", "/v1/moderation/edits/{identity}/reject"): (
                f"/v1/moderation/edits/{edit}/reject",
                {"reason": "Kanıt yok"},
                moderator.headers,
            ),
            ("POST", "/v1/moderation/lines/{identity}/rollback"): (
                f"/v1/moderation/lines/{data.line_id}/rollback",
                {"version_no": 1},
                moderator.headers,
            ),
            ("POST", "/v1/traces"): ("/v1/traces", trace_body(TRACE_POINTS), contributor.headers),
            ("POST", "/v1/media/presign"): (
                "/v1/media/presign",
                {"kind": "fare_table", "content_type": "image/jpeg", "byte_size": 10},
                contributor.headers,
            ),
            ("POST", "/v1/plan"): ("/v1/plan", dict(PLAN), {}),
            ("PATCH", "/v1/admin/users/{identity}/role"): (
                f"/v1/admin/users/{contributor.identity}/role",
                {"role": "contributor"},
                admin.headers,
            ),
            ("DELETE", "/v1/admin/suppressions"): (
                "/v1/admin/suppressions",
                {"email": "a@example.com"},
                admin.headers,
            ),
        }
        assert set(bodies) == set(BODY_ROUTES)
        values: dict[str, object] = {
            "role": "admin",
            "user_id": str(admin.identity),
            "secret": "JBSWY3DPEHPK3PXP",
            "verified_at": "2026-10-12T09:00:00+00:00",
            "author_id": str(admin.identity),
            "state": "approved",
            "published_by": str(admin.identity),
            "owner_id": str(admin.identity),
            "degraded": False,
            "totp_enabled": True,
            "reason": "manual",
        }
        for key, (path, body, headers) in bodies.items():
            field = BODY_ROUTES[key]
            response = await client.request(
                key[0], path, headers=headers, json=body | {field: values[field]}
            )
            assert_problem(response, 422, "validation.failed")
        privileged_patch = await client.patch(
            "/v1/me",
            headers=contributor.headers,
            json={"display_name": "Ad", "reputation": 9999, "email": "admin@example.com"},
        )
        assert_problem(privileged_patch, 422, "validation.failed")
        ignored = await client.post(
            f"/v1/moderation/edits/{edit}/approve",
            headers=contributor.headers,
            json={"state": "approved", "reviewer_id": str(contributor.identity)},
        )
        assert_problem(ignored, 403)
    async with services.session_factory() as db:
        user = await db.get(User, contributor.identity)
        assert user is not None
        assert (user.role, user.reputation, user.deactivated_at) == ("contributor", 100, None)
        stored = await db.get(Edit, uuid.UUID(edit))
        assert stored is not None
        assert stored.state == "pending"
        assert await db.scalar(select(func.count()).select_from(Trace)) == 0


# --- Section 6 extras: enum fuzzing ------------------------------------------------------------


async def test_enum_fuzzing_is_refused(services: Services, clock: FixedClock) -> None:
    services.step_up = SessionStepUpSource()
    data = await sample(services)
    stops = data.stop_ids
    application = build_test_app(services)
    async with connect(application) as client:
        contributor = await actor(client, services, reputation=100)
        moderator = await actor(client, services, UserRole.MODERATOR)
        admin = await stepped_up_admin(client, services, clock)
        edits: list[dict[str, object]] = [
            new_line(stops, mode="DOLMUS"),
            new_line(stops, mode="taksi"),
            new_line(stops, mode="dolmus "),
            new_line(stops, mode=1),
            new_line(stops, mode=None),
            new_line(stops, payment_methods=["NAKIT"]),
            new_line(stops, payment_methods=["bitcoin"]),
            new_line(stops, kind="approve"),
            new_line(stops, kind="new_line\u0000"),
            {
                "kind": "new_stop",
                "city": CITY,
                "name": "Durak",
                "location": [34.05, 42.54],
                "stop_kind": "resmi",
            },
        ]
        for body in edits:
            assert_problem(
                await client.post("/v1/edits", headers=contributor.headers, json=body), 422
            )
        for mode in ("session", "COOKIE", "", None):
            assert_problem(
                await client.post(
                    "/v1/auth/register",
                    json={
                        "email": "yeni@example.com",
                        "password": "uzun-parola-2026",
                        "mode": mode,
                    },
                ),
                422,
            )
        for state in ("all", "PENDING", "pending' OR '1'='1"):
            assert_problem(
                await client.get(f"/v1/moderation/edits?state={state}", headers=moderator.headers),
                422,
            )
        for role in ("superadmin", "ADMIN", "root"):
            assert_problem(
                await client.patch(
                    f"/v1/admin/users/{contributor.identity}/role",
                    headers=admin.headers,
                    json={"role": role},
                ),
                422,
            )
            assert_problem(
                await client.get(f"/v1/admin/users?role={role}", headers=admin.headers), 422
            )
    async with services.session_factory() as db:
        user = await db.get(User, contributor.identity)
        assert user is not None
        assert user.role == "contributor"
    assert await count(services, Edit) == 0


# --- Section 6 extras: LIKE and sort injection on q ------------------------------------------


async def test_search_wildcards_injection_and_sort_parameters_are_inert(services: Services) -> None:
    await sample(services)
    async with connect(build_test_app(services)) as client:
        baseline = (await client.get(f"/v1/lines?city={CITY}&q=ORN")).json()
        assert len(baseline) == 3
        for term in ("%", "_", "ORN%", "%25", "\\", "' OR '1'='1", "ORN-_", "*", ".*"):
            response = await client.get("/v1/lines", params={"city": CITY, "q": term})
            assert response.status_code == 200, term
            assert response.json() == [], term
            stops = await client.get("/v1/stops", params={"city": CITY, "q": term})
            assert stops.status_code == 200, term
            assert stops.json() == [], term
        for extra in ("sort=password_hash", "order_by=email", "order=desc;DROP", "limit=1000"):
            response = await client.get(f"/v1/lines?city={CITY}&q=ORN&{extra}")
            if extra.startswith("limit"):
                assert_problem(response, 422)
            else:
                assert response.json() == baseline, extra
        assert_problem(await client.get("/v1/lines", params={"city": CITY, "q": "x" * 81}), 422)
        assert_problem(await client.get("/v1/stops", params={"city": CITY, "q": "x" * 65}), 422)
        assert_problem(await client.get("/v1/lines", params={"city": CITY, "q": ""}), 422)


# --- Section 6 extras: host header abuse --------------------------------------------------------


async def test_host_header_never_reaches_links_or_responses(services: Services) -> None:
    mail = cast(RecordingMailSender, services.mail_sender)
    _, email = await create_account(services)
    application = build_test_app(services)
    hostile = {
        "Host": "evil.example",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "http",
        "Forwarded": "host=evil.example;proto=http",
    }
    async with connect(application, headers=hostile) as client:
        response = await client.post("/v1/auth/magic-link", json={"email": email})
        assert response.status_code == 202
        assert "evil.example" not in response.text
        missing = await client.get("/v1/nowhere")
        assert_problem(missing, 404)
        assert "evil.example" not in missing.text
    assert mail.sent[-1].text.count("https://app.inecekvar.app/giris/baglanti#token=") == 1
    assert "evil.example" not in mail.sent[-1].text


# --- Section 6 extras: method override and verb tunnelling -------------------------------------


async def test_method_override_and_verb_tunnelling_do_nothing(services: Services) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        victim = await actor(client, services)
        for header in ("X-HTTP-Method-Override", "X-HTTP-Method", "X-Method-Override"):
            response = await client.post(
                "/v1/me", headers=victim.headers | {header: "DELETE"}, json={"password": PASSWORD}
            )
            assert_problem(response, 405, "method_not_allowed")
        tunnelled = await client.post(
            "/v1/me?_method=DELETE", headers=victim.headers, json={"password": PASSWORD}
        )
        assert_problem(tunnelled, 405)
        favourite = await client.get(
            f"/v1/me/favorites/{data.line_id}?_method=PUT", headers=victim.headers
        )
        assert_problem(favourite, 404, "favorite.not_found")
        for verb in ("TRACE", "CONNECT", "PROPFIND", "DEBUG"):
            response = await client.request(verb, "/v1/me", headers=victim.headers)
            assert response.status_code in {400, 405}, verb
            assert victim.email not in response.text
        assert (await client.get("/v1/me", headers=victim.headers)).status_code == 200
    async with services.session_factory() as db:
        user = await db.get(User, victim.identity)
        assert user is not None
        assert user.deactivated_at is None
        assert await db.scalar(select(func.count()).select_from(Favorite)) == 0


# --- Section 6 extras: step-up bypass ----------------------------------------------------------


async def test_step_up_replay_other_session_other_account_and_expiry_are_refused(
    services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    application = build_test_app(services)
    async with connect(application) as client:
        admin = await actor(client, services, UserRole.ADMIN)
        secret = (await enrol(client, admin.headers)).secret
        assert (
            await verify(client, admin.headers, secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        assert_problem(
            await client.get("/v1/admin/users", headers=admin.headers), 403, "auth.step_up_required"
        )
        # The confirmation code replayed as a step-up (same counter).
        replayed_confirm = await verify(client, admin.headers, secret, clock)
        assert_problem(replayed_confirm, 403, "auth.totp_invalid_code")
        clock.advance(seconds=30)
        assert (await verify(client, admin.headers, secret, clock)).status_code == 200
        assert (await client.get("/v1/admin/users", headers=admin.headers)).status_code == 200
        assert_problem(
            await verify(client, admin.headers, secret, clock), 403, "auth.totp_invalid_code"
        )
        other = BearerOut.model_validate((await login(client, admin.email)).json())
        other_headers = {"Authorization": "Bearer " + other.access_token}
        assert_problem(
            await client.get("/v1/admin/users", headers=other_headers),
            403,
            "auth.step_up_required",
        )
        intruder = await actor(client, services, UserRole.ADMIN)
        assert_problem(
            await verify(client, intruder.headers, secret, clock),
            403,
            "auth.totp_enrolment_required",
        )
        assert_problem(
            await client.get("/v1/admin/users", headers=intruder.headers),
            403,
            "auth.totp_enrolment_required",
        )
        clock.advance(minutes=15, seconds=1)
        # A refreshed access token keeps the session (token family) but not an old step-up.
        refreshed = await client.post(
            "/v1/auth/refresh", json={"refresh_token": admin.refresh_token}
        )
        assert refreshed.status_code == 200
        renewed = {"Authorization": "Bearer " + refreshed.json()["access_token"]}
        assert_problem(
            await client.get("/v1/admin/users", headers=renewed), 403, "auth.step_up_required"
        )


async def test_step_up_code_guessing_is_rate_limited(services: Services, clock: FixedClock) -> None:
    services.step_up = SessionStepUpSource()
    application = build_test_app(services)
    async with connect(application) as client:
        admin = await actor(client, services, UserRole.ADMIN)
        secret = (await enrol(client, admin.headers)).secret
        assert (
            await verify(client, admin.headers, secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        guesses = [
            (
                await client.post(
                    "/v1/auth/step-up",
                    headers=admin.headers,
                    json={"code": wrong_code(secret, clock)},
                )
            ).status_code
            for _ in range(5)
        ]
        clock.advance(seconds=30)
        genuine = await verify(client, admin.headers, secret, clock)
    assert guesses == [403] * 4 + [429]
    assert_problem(genuine, 429, "rate_limited")


# --- Section 6 extras: account enumeration ------------------------------------------------------


def comparable(response: httpx.Response) -> tuple[int, dict[str, object], str]:
    body = cast(dict[str, object], response.json())
    body.pop("request_id", None)
    return response.status_code, body, response.headers.get("content-type", "")


async def test_register_login_and_magic_link_answer_alike_for_known_and_unknown(
    services: Services,
) -> None:
    _, known = await create_account(services)
    unknown = "kimse-" + uuid.uuid4().hex[:8] + "@example.com"
    application = build_test_app(services)
    async with connect(application) as client:
        pairs = []
        for email in (known, unknown):
            client_ip = {"X-Real-IP": "192.0.2.1"}
            pairs.append(
                (
                    comparable(
                        await client.post(
                            "/v1/auth/register",
                            headers=client_ip,
                            json={"email": email, "password": "uzun-parola-2026", "mode": "bearer"},
                        )
                    ),
                    comparable(
                        await client.post(
                            "/v1/auth/login",
                            json={"email": email, "password": "yanlis-parola-1", "mode": "bearer"},
                        )
                    ),
                    comparable(await client.post("/v1/auth/magic-link", json={"email": email})),
                )
            )
    assert pairs[0] == pairs[1]
    assert pairs[0][0][0] == 202
    assert pairs[0][1][0] == 401
    assert pairs[0][2][0] == 202


# --- Section 6 extras: rate-limit bypass variants (real Redis) ---------------------------------


@pytest.fixture
async def real_limiter(services: Services, redis_url: str) -> AsyncIterator[Services]:
    connection = Redis.from_url(redis_url)
    await connection.flushdb()
    services.rate_limiter = RedisSlidingWindowLimiter(
        connection,
        services.settings.rate_limit_rules,
        services.settings.require_secret("log_hash_key"),
        services.clock,
    )
    try:
        yield services
    finally:
        await connection.flushdb()
        await connection.aclose()


async def failed_logins(
    client: httpx.AsyncClient, attempts: Sequence[tuple[Mapping[str, str], str]]
) -> list[int]:
    statuses = []
    for headers, email in attempts:
        response = await client.post(
            "/v1/auth/login",
            headers=dict(headers),
            json={"email": email, "password": "yanlis-parola-1", "mode": "bearer"},
        )
        statuses.append(response.status_code)
    return statuses


def unique_email() -> str:
    return "deneme-" + uuid.uuid4().hex[:10] + "@example.com"


async def test_spoofed_forwarding_headers_do_not_reset_the_ip_limit(real_limiter: Services) -> None:
    spoofed = [
        {"X-Forwarded-For": "198.51.100.1"},
        {"X-Real-IP": "198.51.100.2"},
        {"Forwarded": "for=198.51.100.3"},
        {"X-Forwarded-For": "198.51.100.4, 127.0.0.1", "X-Real-IP": "127.0.0.1"},
        {"True-Client-IP": "198.51.100.5", "CF-Connecting-IP": "198.51.100.5"},
        {"X-Client-IP": "198.51.100.6", "X-Cluster-Client-IP": "198.51.100.6"},
    ]
    async with connect(build_test_app(real_limiter)) as client:
        statuses = await failed_logins(client, [(headers, unique_email()) for headers in spoofed])
    assert statuses == [401] * 5 + [429]


async def test_trusted_proxy_header_forms_of_one_address_share_a_window(
    real_limiter: Services,
) -> None:
    forms = [
        "2001:db8::7",
        "2001:DB8:0:0:0:0:0:7",
        "2001:0db8:0000:0000:0000:0000:0000:0007",
        "2001:db8:0::7",
        "2001:db8::0:7",
        "2001:db8::7",
    ]
    async with connect(build_test_app(real_limiter), peer=PROXY_PEER) as client:
        statuses = await failed_logins(
            client, [({"X-Real-IP": ip}, unique_email()) for ip in forms]
        )
        garbled = await failed_logins(client, [({"X-Real-IP": "not-an-ip"}, unique_email())])
    assert statuses == [401] * 5 + [429]
    # An unparsable header falls back to the proxy peer, a separate window.
    assert garbled == [401]


async def test_ipv6_rotation_within_one_64_and_mapped_ipv4_share_a_window(
    real_limiter: Services,
) -> None:
    rotation = [f"2001:db8:1:2::{index:x}" for index in range(1, 7)]
    mapped = [
        "::ffff:198.51.100.7",
        "198.51.100.7",
        "::ffff:c633:6407",
        "198.51.100.7",
        "::ffff:198.51.100.7",
        "198.51.100.7",
    ]
    async with connect(build_test_app(real_limiter), peer=PROXY_PEER) as client:
        rotated = await failed_logins(
            client, [({"X-Real-IP": ip}, unique_email()) for ip in rotation]
        )
        aliased = await failed_logins(
            client, [({"X-Real-IP": ip}, unique_email()) for ip in mapped]
        )
        neighbour = await failed_logins(
            client, [({"X-Real-IP": "2001:db8:1:3::1"}, unique_email())]
        )
    assert rotated == [401] * 5 + [429]
    assert aliased == [401] * 5 + [429]
    assert neighbour == [401]


async def test_email_spelling_variants_share_the_victim_window(real_limiter: Services) -> None:
    victim_email = "çiçek." + uuid.uuid4().hex[:6] + "@example.com"
    _, stored = await create_account(real_limiter)
    async with real_limiter.session_factory() as db:
        user = await db.scalar(select(User).where(User.email == stored))
        assert user is not None
        user.email = victim_email
        await db.commit()
    local = victim_email.split("@")[0]
    decomposed = unicodedata.normalize("NFD", local)
    variants = [
        local.upper() + "@EXAMPLE.COM",
        decomposed + "@example.com",
        " " + local + "@Example.com",
        local + "@EXAMPLE.com",
        unicodedata.normalize("NFD", local.upper()) + "@example.com",
    ]
    async with connect(build_test_app(real_limiter), peer=PROXY_PEER) as client:
        statuses = await failed_logins(
            client,
            [
                ({"X-Real-IP": f"192.0.2.{index + 10}"}, email)
                for index, email in enumerate(variants)
            ],
        )
        final = await client.post(
            "/v1/auth/login",
            headers={"X-Real-IP": "192.0.2.50"},
            json={"email": victim_email, "password": PASSWORD, "mode": "bearer"},
        )
        aliases = []
        for index, alias in enumerate(
            [
                local + "+x@example.com",
                local.replace(".", "") + "@example.com",
                "\uff43" + local[1:] + "@example.com",
            ]
        ):
            response = await client.post(
                "/v1/auth/login",
                headers={"X-Real-IP": f"192.0.2.{index + 60}"},
                json={"email": alias, "password": PASSWORD, "mode": "bearer"},
            )
            aliases.append(response.status_code)
    assert statuses == [401] * 5
    assert_problem(final, 429, "rate_limited")
    # Plus, dot and full-width spellings are other mailboxes: they never open the victim's account.
    assert aliases == [401, 401, 401]


# --- Item 16 at the API: payloads are stored as text or refused ---------------------------------


def test_payload_file_matches_the_python_list() -> None:
    shared = API_DIR.parent / "apps" / "web-e2e" / "src" / "xss-payloads.json"
    assert json.loads(shared.read_text(encoding="utf-8")) == as_json()
    assert len(PAYLOADS) >= 22
    assert {payload.name for payload in REFUSED} == {
        "rtl-override",
        "bidi-isolate",
        "zero-width",
        "nul-byte",
    }


async def test_payloads_round_trip_as_json_text_or_are_refused(services: Services) -> None:
    data = await sample(services)
    application = build_test_app(services)
    async with connect(application) as client:
        contributor = await actor(client, services, reputation=1000)
        for payload in PAYLOADS:
            body = {
                "kind": "update_line",
                "line": str(data.line_id),
                "base_version_no": 1,
                "changes": {
                    "name": fit(payload.value, 160),
                    "hours_text": fit(payload.value, 500),
                    "hail_notes": fit(payload.value, 1000),
                },
            }
            response = await client.post("/v1/edits", headers=contributor.headers, json=body)
            if payload.refused:
                assert_problem(response, 422, "validation.failed")
                continue
            assert response.status_code == 201, (payload.name, response.text)
            assert response.headers["content-type"] == "application/json"
            changes = response.json()["payload"]["changes"]
            assert changes["name"] == fit(payload.value, 160).strip()
            assert changes["hail_notes"] == fit(payload.value, 1000).strip()
            if len(payload.value) > 160:
                over = dict(body)
                over["changes"] = {"name": payload.value}
                assert_problem(
                    await client.post("/v1/edits", headers=contributor.headers, json=over), 422
                )
        for payload in STORED:
            patched = await client.patch(
                "/v1/me", headers=contributor.headers, json={"display_name": fit(payload.value, 60)}
            )
            assert patched.status_code == 200, payload.name
            assert patched.json()["display_name"] == fit(payload.value, 60).strip()
