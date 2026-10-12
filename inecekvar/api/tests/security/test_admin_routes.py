import asyncio
import hashlib
import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, cast

import httpx
import pytest
from sqlalchemy import delete, func, select, text, update

from app.auth.step_up import SessionStepUpSource
from app.core.deps import Services
from app.core.ids import uuid7
from app.models import AuditLog, City, Export, SessionStepUp, User
from app.models.enums import UserRole
from app.security.admins import lock_admins
from app.security.audit import audit
from app.security.policy import ROLES, Action, cell
from tests.security.conftest import create_account, sign_in
from tests.support.app import FixedClock, build_test_app
from tests.support.domain import seed_city
from tests.support.routes import route_signatures
from tests.support.storage import S3Buckets
from tests.totp.test_totp_step_up import enrol, problem, verify

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
CITY = "ornek-test-sehri"
type RequestBuilder = Callable[[httpx.AsyncClient, uuid.UUID], httpx.Request]
type StepState = Literal["none", "enrolled", "fresh", "stale", "other-session"]


def users_request(client: httpx.AsyncClient, target: uuid.UUID) -> httpx.Request:
    return client.build_request("GET", "/v1/admin/users")


def role_request(client: httpx.AsyncClient, target: uuid.UUID) -> httpx.Request:
    return client.build_request(
        "PATCH", f"/v1/admin/users/{target}/role", json={"role": "contributor"}
    )


def export_request(client: httpx.AsyncClient, target: uuid.UUID) -> httpx.Request:
    return client.build_request("POST", f"/v1/admin/exports/{CITY}")


def audit_request(client: httpx.AsyncClient, target: uuid.UUID) -> httpx.Request:
    return client.build_request("GET", "/v1/admin/audit-logs")


def suppression_request(client: httpx.AsyncClient, target: uuid.UUID) -> httpx.Request:
    return client.build_request(
        "DELETE", "/v1/admin/suppressions", json={"email": "bounced@example.com"}
    )


@dataclass(frozen=True)
class AdminRoute:
    method: str
    path: str
    request_builder: RequestBuilder
    success_status: int
    action: Action


ADMIN_ROUTES = (
    AdminRoute("GET", "/v1/admin/users", users_request, 200, Action.MANAGE_USERS),
    AdminRoute("PATCH", "/v1/admin/users/{identity}/role", role_request, 200, Action.MANAGE_USERS),
    AdminRoute("POST", "/v1/admin/exports/{city}", export_request, 201, Action.EXPORT_ADMIN),
    AdminRoute("GET", "/v1/admin/audit-logs", audit_request, 200, Action.MANAGE_USERS),
    AdminRoute(
        "DELETE", "/v1/admin/suppressions", suppression_request, 200, Action.MANAGE_SUPPRESSIONS
    ),
)
ACTORS: tuple[tuple[UserRole | None, StepState, int, str | None], ...] = (
    (None, "none", 401, "auth.required"),
    (UserRole.USER, "fresh", 403, "auth.forbidden"),
    (UserRole.CONTRIBUTOR, "fresh", 403, "auth.forbidden"),
    (UserRole.MODERATOR, "fresh", 403, "auth.forbidden"),
    (UserRole.ADMIN, "none", 403, "auth.totp_enrolment_required"),
    (UserRole.ADMIN, "enrolled", 403, "auth.step_up_required"),
    (UserRole.ADMIN, "stale", 403, "auth.step_up_required"),
    (UserRole.ADMIN, "other-session", 403, "auth.step_up_required"),
    (UserRole.ADMIN, "fresh", 200, None),
)


@pytest.fixture
async def client(services: Services) -> AsyncIterator[httpx.AsyncClient]:
    services.step_up = SessionStepUpSource()
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        yield connection


async def actor_account(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    role: UserRole,
    state: StepState = "fresh",
) -> tuple[uuid.UUID, dict[str, str]]:
    identity, email = await create_account(services, role)
    headers = await sign_in(client, email)
    if state == "none":
        return identity, headers
    output = await enrol(client, headers)
    assert (
        await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
    ).status_code == 200
    if state == "enrolled":
        return identity, headers
    clock.advance(seconds=30)
    assert (await verify(client, headers, output.secret, clock)).status_code == 200
    if state == "stale":
        async with services.session_factory() as db:
            await db.execute(
                update(SessionStepUp)
                .where(SessionStepUp.user_id == identity)
                .values(verified_at=clock.now() - timedelta(minutes=16))
            )
            await db.commit()
    elif state == "other-session":
        headers = await sign_in(client, email)
    return identity, headers


async def test_admin_route_table_is_complete(services: Services) -> None:
    actual = {
        (method, path)
        for method, path in route_signatures(build_test_app(services))
        if path.startswith("/v1/admin")
    }
    assert actual == {(route.method, route.path) for route in ADMIN_ROUTES}


@pytest.mark.parametrize("route", ADMIN_ROUTES, ids=[route.path for route in ADMIN_ROUTES])
def test_admin_route_policy(route: AdminRoute) -> None:
    for role in ROLES:
        expected = "allow-if:totp_step_up" if role == UserRole.ADMIN else "deny"
        assert cell(role, route.action) == expected


@pytest.mark.parametrize("route", ADMIN_ROUTES, ids=[route.path for route in ADMIN_ROUTES])
@pytest.mark.parametrize(
    ("role", "state", "status", "code"),
    ACTORS,
    ids=[f"{role}-{state}" for role, state, _, _ in ACTORS],
)
async def test_admin_route_authorization(
    route: AdminRoute,
    role: UserRole | None,
    state: StepState,
    status: int,
    code: str | None,
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    request: pytest.FixtureRequest,
) -> None:
    await seed_city(services)
    target, _ = await create_account(services, UserRole.USER)
    headers: dict[str, str] = {}
    if role is not None:
        _, headers = await actor_account(client, services, clock, role, state)
    if code is None and route.action == Action.EXPORT_ADMIN:
        buckets = cast(S3Buckets, request.getfixturevalue("s3_buckets"))
        services.object_store = buckets.store
        services.settings = services.settings.model_copy(update=buckets.settings_overrides())
    built = route.request_builder(client, target)
    built.headers.update(headers)
    response = await client.send(built)
    assert response.headers["Cache-Control"] == "no-store"
    if code is not None:
        problem(response, status, code)
    else:
        assert response.status_code == route.success_status, response.text


async def test_user_paging_and_role_filter(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    admin, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    identities = [await create_account(services, UserRole.USER) for _ in range(3)]
    await create_account(services, UserRole.CONTRIBUTOR)
    async with services.session_factory() as db:
        ordered = list(
            await db.scalars(
                select(User.id).where(User.role == "user").order_by(User.created_at, User.id)
            )
        )
    response = await client.get(
        "/v1/admin/users", headers=headers, params={"role": "user", "limit": 2, "offset": 1}
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (3, 2, 1)
    assert [item["id"] for item in body["items"]] == [str(identity) for identity in ordered[1:3]]
    assert all(item["role"] == "user" and not item["totp_enabled"] for item in body["items"])
    assert set(body["items"][0]) == {
        "id",
        "email",
        "display_name",
        "role",
        "created_at",
        "email_verified_at",
        "totp_enabled",
        "deactivated_at",
    }
    all_users = await client.get("/v1/admin/users", headers=headers)
    assert all_users.json()["total"] == len(identities) + 2
    admin_item = next(item for item in all_users.json()["items"] if item["id"] == str(admin))
    assert admin_item["totp_enabled"]


@pytest.mark.parametrize(
    "params",
    [{"limit": "101"}, {"limit": "0"}, {"offset": "100001"}, {"role": "owner"}],
)
async def test_user_query_bounds(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, params: dict[str, str]
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.get("/v1/admin/users", headers=headers, params=params),
        422,
        "validation.failed",
    )


def diff_digest(diff: object) -> bytes:
    canonical = json.dumps(diff, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).digest()


async def test_role_change_audits_and_same_role_is_noop(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    target, _ = await create_account(services, UserRole.USER)
    path = f"/v1/admin/users/{target}/role"
    clock.advance(seconds=1)
    response = await client.patch(path, headers=headers, json={"role": "contributor"})
    assert response.status_code == 200
    assert response.json()["role"] == "contributor"
    async with services.session_factory() as db:
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "admin.user_role"))
        assert row is not None
        assert (row.actor_id, row.target_type, row.target_id) == (actor, "user", target)
        assert row.diff_hash == diff_digest({"role": {"from": "user", "to": "contributor"}})
        user = await db.get(User, target)
        assert user is not None
        updated_at = user.updated_at
        assert updated_at == clock.now()
    clock.advance(seconds=30)
    assert (
        await client.patch(path, headers=headers, json={"role": "contributor"})
    ).status_code == 200
    async with services.session_factory() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "admin.user_role")
            )
            == 1
        )
        user = await db.get(User, target)
        assert user is not None
        assert user.updated_at == updated_at


async def test_last_admin_self_demotion_is_refused(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    inactive, _ = await create_account(services, UserRole.ADMIN)
    async with services.session_factory() as db:
        await db.execute(update(User).where(User.id == inactive).values(deactivated_at=clock.now()))
        await db.commit()
    problem(
        await client.patch(f"/v1/admin/users/{actor}/role", headers=headers, json={"role": "user"}),
        409,
        "admin.last_admin",
    )
    async with services.session_factory() as db:
        assert await db.scalar(select(User.role).where(User.id == actor)) == "admin"
        assert (
            await db.scalar(select(AuditLog.id).where(AuditLog.action == "admin.user_role")) is None
        )


@pytest.mark.parametrize("self_demotion", [False, True])
@pytest.mark.parametrize("new_role", [UserRole.USER, UserRole.MODERATOR])
async def test_one_of_two_admins_can_be_demoted(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    self_demotion: bool,
    new_role: UserRole,
) -> None:
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    other, _ = await actor_account(client, services, clock, UserRole.ADMIN)
    target = actor if self_demotion else other
    response = await client.patch(
        f"/v1/admin/users/{target}/role", headers=headers, json={"role": new_role.value}
    )
    assert response.status_code == 200, response.text
    async with services.session_factory() as db:
        assert await db.scalar(select(User.role).where(User.id == target)) == new_role.value
        assert await db.scalar(select(AuditLog.id).where(AuditLog.target_id == target)) is not None
        assert (
            await db.scalar(select(SessionStepUp.session_id).where(SessionStepUp.user_id == target))
            is None
        )


async def test_demoted_moderator_loses_all_step_ups(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    target, _ = await actor_account(client, services, clock, UserRole.MODERATOR)
    async with services.session_factory() as db:
        db.add(
            SessionStepUp(
                session_id=uuid7(),
                user_id=target,
                verified_at=clock.now(),
                created_at=clock.now(),
                updated_at=clock.now(),
            )
        )
        await db.commit()
    response = await client.patch(
        f"/v1/admin/users/{target}/role", headers=headers, json={"role": "contributor"}
    )
    assert response.status_code == 200
    async with services.session_factory() as db:
        assert (
            await db.scalar(select(SessionStepUp.session_id).where(SessionStepUp.user_id == target))
            is None
        )


@pytest.mark.parametrize("deactivated", [False, True])
async def test_role_target_errors(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, deactivated: bool
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    target = uuid7()
    if deactivated:
        target, _ = await create_account(services, UserRole.USER)
        async with services.session_factory() as db:
            await db.execute(
                update(User).where(User.id == target).values(deactivated_at=clock.now())
            )
            await db.commit()
    response = await client.patch(
        f"/v1/admin/users/{target}/role", headers=headers, json={"role": "contributor"}
    )
    problem(
        response,
        409 if deactivated else 404,
        "user.deactivated" if deactivated else "user.not_found",
    )
    async with services.session_factory() as db:
        assert (
            await db.scalar(select(AuditLog.id).where(AuditLog.action == "admin.user_role")) is None
        )


@pytest.mark.parametrize("body", [{"role": "owner"}, {"role": "user", "extra": True}])
async def test_role_body_validation(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, body: dict[str, object]
) -> None:
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.patch(f"/v1/admin/users/{actor}/role", headers=headers, json=body),
        422,
        "validation.failed",
    )


async def test_export_publishes_and_audits(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, s3_buckets: S3Buckets
) -> None:
    await seed_city(services)
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    for version in (1, 2):
        response = await client.post(f"/v1/admin/exports/{CITY}", headers=headers)
        assert response.status_code == 201, response.text
        body = response.json()
        assert set(body) == {"city", "version", "path", "published_at"}
        assert (body["city"], body["version"], body["path"]) == (
            CITY,
            version,
            f"exports/{CITY}/{version}.geojson",
        )
        stored = await s3_buckets.store.get(
            services.settings.exports_bucket, body["path"], 50_000_000
        )
        assert json.loads(stored)["version"] == version
    async with services.session_factory() as db:
        city_id = await db.scalar(select(City.id).where(City.slug == CITY))
        logs = list(
            await db.scalars(
                select(AuditLog).where(AuditLog.action == "admin.export").order_by(AuditLog.id)
            )
        )
        assert len(logs) == 2
        for version, log in enumerate(logs, 1):
            assert (log.actor_id, log.target_type, log.target_id) == (actor, "city", city_id)
            assert log.diff_hash == diff_digest({"version": version})
        assert await db.scalar(select(func.count()).select_from(Export)) == 2


async def test_export_requires_storage(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.post(f"/v1/admin/exports/{CITY}", headers=headers), 503, "storage.unavailable"
    )


async def test_export_unknown_city(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, s3_buckets: S3Buckets
) -> None:
    services.object_store = s3_buckets.store
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(await client.post("/v1/admin/exports/missing", headers=headers), 404, "city.not_found")
    async with services.session_factory() as db:
        assert await db.scalar(select(AuditLog.id).where(AuditLog.action == "admin.export")) is None


@pytest.mark.parametrize("city", ["A-city", "a" * 121, "bad_slug"])
async def test_export_slug_bounds(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    s3_buckets: S3Buckets,
    city: str,
) -> None:
    services.object_store = s3_buckets.store
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.post(f"/v1/admin/exports/{city}", headers=headers), 422, "validation.failed"
    )


async def test_audit_filters_paging_and_hex_hash(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    other, _ = await create_account(services, UserRole.USER)
    target, other_target = uuid7(), uuid7()
    now = clock.now()
    async with services.session_factory() as db:
        for actor_id, action, kind, identity, when in (
            (actor, "admin.user_role", "user", target, now),
            (actor, "admin.user_role", "user", target, now),
            (other, "admin.user_role", "user", target, now),
            (actor, "admin.export", "city", target, now),
            (actor, "admin.user_role", "city", other_target, now),
            (actor, "admin.user_role", "user", target, now - timedelta(days=2)),
            (actor, "admin.user_role", "user", target, now + timedelta(days=2)),
        ):
            audit(db, actor_id, action, kind, identity, {"test": True}, when)
        db.add(
            AuditLog(
                action="test.null",
                target_type="user",
                target_id=None,
                actor_id=None,
                diff_hash=None,
                created_at=now,
                updated_at=now,
            )
        )
        await db.commit()
        expected = list(
            await db.scalars(
                select(AuditLog.id)
                .where(
                    AuditLog.actor_id == actor,
                    AuditLog.action == "admin.user_role",
                    AuditLog.target_type == "user",
                    AuditLog.target_id == target,
                    AuditLog.created_at >= now - timedelta(days=1),
                    AuditLog.created_at <= now,
                )
                .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            )
        )
    params = {
        "actor_id": str(actor),
        "action": "admin.user_role",
        "target_type": "user",
        "target_id": str(target),
        "since": (now - timedelta(days=1)).isoformat(),
        "until": now.isoformat(),
        "limit": "1",
        "offset": "1",
    }
    response = await client.get("/v1/admin/audit-logs", headers=headers, params=params)
    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (2, 1, 1)
    item = body["items"][0]
    assert item["id"] == str(expected[1])
    assert item["diff_hash"] == diff_digest({"test": True}).hex()
    assert set(item) == {
        "id",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "diff_hash",
        "created_at",
    }
    for key in ("actor_id", "action", "target_type", "target_id", "since", "until"):
        filtered = await client.get(
            "/v1/admin/audit-logs", headers=headers, params={key: params[key]}
        )
        assert filtered.status_code == 200
        for row in filtered.json()["items"]:
            if key == "since":
                assert datetime.fromisoformat(row["created_at"]) >= now - timedelta(days=1)
            elif key == "until":
                assert datetime.fromisoformat(row["created_at"]) <= now
            else:
                assert row[key] == params[key]
    ordered = await client.get("/v1/admin/audit-logs", headers=headers)
    sort_keys = [
        (datetime.fromisoformat(row["created_at"]), uuid.UUID(row["id"]))
        for row in ordered.json()["items"]
    ]
    assert sort_keys == sorted(sort_keys, reverse=True)
    null_row = await client.get(
        "/v1/admin/audit-logs", headers=headers, params={"action": "test.null"}
    )
    assert null_row.json()["items"][0]["diff_hash"] is None


@pytest.mark.parametrize("days", [0, 366])
async def test_audit_time_window_boundary_is_allowed(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, days: int
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    response = await client.get(
        "/v1/admin/audit-logs",
        headers=headers,
        params={
            "since": (clock.now() - timedelta(days=days)).isoformat(),
            "until": clock.now().isoformat(),
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "params",
    [
        {"action": "a" * 65},
        {"action": "drop table"},
        {"target_type": "a" * 65},
        {"actor_id": "invalid"},
        {"target_id": "invalid"},
        {"limit": "101"},
        {"offset": "100001"},
        {"since": "2026-01-01T00:00:00"},
        {"until": "2026-01-01T00:00:00"},
        {"since": "2025-01-01T00:00:00Z", "until": "2026-01-03T00:00:00Z"},
        {"since": "2026-01-02T00:00:00Z", "until": "2026-01-01T00:00:00Z"},
    ],
)
async def test_audit_query_bounds(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, params: dict[str, str]
) -> None:
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.get("/v1/admin/audit-logs", headers=headers, params=params),
        422,
        "validation.failed",
    )


async def test_demoted_admin_cannot_repromote_self_during_race(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    await actor_account(client, services, clock, UserRole.ADMIN)
    target, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    async with services.session_factory() as held:
        await lock_admins(held)
        backend = await held.scalar(text("SELECT pg_backend_pid()"))
        await held.execute(update(User).where(User.id == target).values(role="user"))
        await held.execute(delete(SessionStepUp).where(SessionStepUp.user_id == target))
        pending = asyncio.create_task(
            client.patch(f"/v1/admin/users/{target}/role", headers=headers, json={"role": "admin"})
        )
        try:
            blocked = False
            async with services.session_factory() as observer:
                for _ in range(100):
                    blocked = bool(
                        await observer.scalar(
                            text(
                                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                "WHERE pid <> :backend AND datname = current_database() "
                                "AND wait_event_type = 'Lock' "
                                "AND query LIKE '%pg_advisory_xact_lock%')"
                            ),
                            {"backend": backend},
                        )
                    )
                    await observer.rollback()
                    if blocked:
                        break
                    await asyncio.sleep(0.05)
            assert blocked, "request never blocked on the admin lock"
            await held.commit()
            problem(await asyncio.wait_for(pending, timeout=5), 403, "auth.forbidden")
        finally:
            await held.rollback()
            if not pending.done():
                pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
    async with services.session_factory() as db:
        assert await db.scalar(select(User.role).where(User.id == target)) == "user"
        assert (
            await db.scalar(
                select(AuditLog.id).where(
                    AuditLog.action == "admin.user_role", AuditLog.target_id == target
                )
            )
            is None
        )


async def test_export_busy_city_answers_409(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, s3_buckets: S3Buckets
) -> None:
    await seed_city(services)
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    path = f"/v1/admin/exports/{CITY}"
    async with services.session_factory() as held:
        await held.scalar(select(City).where(City.slug == CITY).with_for_update())
        responses = await asyncio.gather(
            client.post(path, headers=headers), client.post(path, headers=headers)
        )
        for response in responses:
            problem(response, 409, "export.in_progress")
        await held.rollback()
    assert (await client.post(path, headers=headers)).status_code == 201


async def test_export_quota_answers_429(
    client: httpx.AsyncClient, services: Services, clock: FixedClock, s3_buckets: S3Buckets
) -> None:
    await seed_city(services)
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    path = f"/v1/admin/exports/{CITY}"
    for _ in range(10):
        assert (await client.post(path, headers=headers)).status_code == 201
    response = await client.post(path, headers=headers)
    problem(response, 429, "rate_limited")
    assert int(response.headers["Retry-After"]) > 0
    _, other_headers = await actor_account(client, services, clock, UserRole.ADMIN)
    assert (await client.post(path, headers=other_headers)).status_code == 201


@pytest.mark.parametrize("setting", ["export_max_bytes", "export_max_features"])
async def test_export_size_cap_answers_422(
    client: httpx.AsyncClient,
    services: Services,
    clock: FixedClock,
    s3_buckets: S3Buckets,
    setting: str,
) -> None:
    await seed_city(services)
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(
        update=s3_buckets.settings_overrides() | {setting: 1}
    )
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.post(f"/v1/admin/exports/{CITY}", headers=headers), 422, "export.too_large"
    )
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Export)) == 0
        assert await db.scalar(select(AuditLog.id).where(AuditLog.action == "admin.export")) is None
    objects = await asyncio.to_thread(
        s3_buckets.store.client.list_objects_v2, Bucket=s3_buckets.exports_bucket
    )
    assert objects.get("KeyCount", 0) == 0
