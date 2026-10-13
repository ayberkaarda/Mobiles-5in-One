import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.step_up import SessionStepUpSource
from app.auth.suppression import suppress
from app.core.deps import Services
from app.core.ids import uuid7
from app.models import AuditLog
from app.models.accounts import User
from app.models.contributions import Edit, Trace
from app.models.enums import SuppressionReason, UserRole
from app.models.ops import EmailSuppression
from tests.security.conftest import create_account, sign_in
from tests.support.app import FixedClock, build_test_app
from tests.totp.test_totp_step_up import enrol, problem, verify

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

type Prepare = Callable[[AsyncSession, uuid.UUID, uuid.UUID | None], Awaitable[None]]


@dataclass(frozen=True)
class IdorCase:
    name: str
    method: str
    path: str
    resource: Literal["trace", "edit"]
    owner_role: UserRole
    actor_role: UserRole | None
    expected_status: int
    prepare: Prepare | None = None


async def make_owner(db: AsyncSession, identity: uuid.UUID, actor: uuid.UUID | None) -> None:
    assert actor is not None
    await db.execute(
        text("UPDATE traces SET author_id = :actor WHERE id = :id"),
        {"actor": actor, "id": identity},
    )


async def make_author(db: AsyncSession, identity: uuid.UUID, actor: uuid.UUID | None) -> None:
    assert actor is not None
    await db.execute(
        text("UPDATE edits SET author_id = :actor WHERE id = :id"),
        {"actor": actor, "id": identity},
    )


async def remove_trace(db: AsyncSession, identity: uuid.UUID, actor: uuid.UUID | None) -> None:
    await db.execute(text("DELETE FROM traces WHERE id = :id"), {"id": identity})


async def mark_approved(db: AsyncSession, identity: uuid.UUID, actor: uuid.UUID | None) -> None:
    assert actor is not None
    await db.execute(
        text(
            "UPDATE edits SET state = 'approved', reviewer_id = :actor, reviewed_at = now() "
            "WHERE id = :id"
        ),
        {"actor": actor, "id": identity},
    )


CASES: list[IdorCase] = [
    IdorCase(
        "user-other-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.USER,
        403,
    ),
    IdorCase(
        "contributor-other-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "owner-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.USER,
        200,
        make_owner,
    ),
    IdorCase(
        "moderator-other-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.MODERATOR,
        200,
    ),
    IdorCase(
        "anonymous-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.USER,
        None,
        401,
    ),
    IdorCase(
        "unknown-trace",
        "GET",
        "/v1/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.USER,
        404,
        remove_trace,
    ),
    IdorCase(
        "contributor-other-edit",
        "GET",
        "/v1/edits/{id}",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "author-edit",
        "GET",
        "/v1/edits/{id}",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.USER,
        200,
        make_author,
    ),
    IdorCase(
        "contributor-approve",
        "POST",
        "/v1/moderation/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "moderator-self-approve",
        "POST",
        "/v1/moderation/edits/{id}/approve",
        "edit",
        UserRole.MODERATOR,
        UserRole.MODERATOR,
        403,
        make_author,
    ),
    IdorCase(
        "moderator-approve-pending",
        "POST",
        "/v1/moderation/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        200,
    ),
    IdorCase(
        "moderator-approve-approved",
        "POST",
        "/v1/moderation/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        403,
        mark_approved,
    ),
    IdorCase(
        "admin-self-approve",
        "POST",
        "/v1/moderation/edits/{id}/approve",
        "edit",
        UserRole.ADMIN,
        UserRole.ADMIN,
        403,
        make_author,
    ),
    IdorCase(
        "moderator-delete-other-trace",
        "DELETE",
        "/v1/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        403,
    ),
    IdorCase(
        "owner-delete-trace",
        "DELETE",
        "/v1/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.USER,
        204,
        make_owner,
    ),
    IdorCase(
        "anonymous-edit",
        "GET",
        "/v1/edits/{id}",
        "edit",
        UserRole.CONTRIBUTOR,
        None,
        401,
    ),
    IdorCase(
        "contributor-reject",
        "POST",
        "/v1/moderation/edits/{id}/reject",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "moderator-self-reject",
        "POST",
        "/v1/moderation/edits/{id}/reject",
        "edit",
        UserRole.MODERATOR,
        UserRole.MODERATOR,
        403,
        make_author,
    ),
    IdorCase(
        "moderator-reject-pending",
        "POST",
        "/v1/moderation/edits/{id}/reject",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        200,
    ),
]


async def create_resource(
    db: AsyncSession, resource: Literal["trace", "edit"], owner: uuid.UUID
) -> uuid.UUID:
    city_id, identity = uuid7(), uuid7()
    await db.execute(
        text(
            "INSERT INTO cities (id, name, slug, bbox, centroid) VALUES "
            "(:id, 'Private city', :slug, "
            "ST_GeomFromText('POLYGON((34 42.5,34.1 42.5,34.1 42.58,34 42.58,34 42.5))', 4326), "
            "ST_GeomFromText('POINT(34.05 42.54)', 4326))"
        ),
        {"id": city_id, "slug": "city-" + city_id.hex},
    )
    if resource == "trace":
        statement = (
            "INSERT INTO traces (id, city_id, author_id, points, started_at, ended_at, "
            "delete_after) VALUES (:id, :city, :owner, '[[34.01,42.51],[34.02,42.52]]'::jsonb, "
            "now(), now(), now() + interval '30 days')"
        )
    else:
        statement = (
            "INSERT INTO edits (id, kind, city_id, payload, author_id) "
            "VALUES (:id, 'new_stop', :city, CAST(:payload AS jsonb), :owner)"
        )
    payload = json.dumps(
        {
            "kind": "new_stop",
            "city": "city-" + city_id.hex,
            "name": "Private proposal",
            "location": [34.05, 42.54],
            "stop_kind": "formal",
        }
    )
    await db.execute(
        text(statement), {"id": identity, "city": city_id, "owner": owner, "payload": payload}
    )
    return identity


def assert_private_body(body: object, private: frozenset[str]) -> None:
    if isinstance(body, dict):
        assert not private.intersection(body)
        for value in body.values():
            assert_private_body(value, private)
    elif isinstance(body, list):
        for value in body:
            assert_private_body(value, private)


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
async def test_idor_case(case: IdorCase, services: Services) -> None:
    owner, owner_email = await create_account(services, case.owner_role)
    actor: uuid.UUID | None = None
    actor_email: str | None = None
    if case.actor_role is not None:
        actor, actor_email = await create_account(services, case.actor_role)
    async with services.session_factory() as db:
        identity = await create_resource(db, case.resource, owner)
        if case.prepare is not None:
            await case.prepare(db, identity, actor)
        await db.commit()
        model = Trace if case.resource == "trace" else Edit
        private = frozenset(
            column.name for column in model.__table__.columns if column.name != "id"
        )
    application = build_test_app(services)
    transport = httpx.ASGITransport(app=application, client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers = await sign_in(client, actor_email) if actor_email is not None else {}
        body = {"reason": "Kanıt yok"} if case.path.endswith("/reject") else None
        response = await client.request(
            case.method, case.path.format(id=identity), headers=headers, json=body
        )
    assert response.status_code == case.expected_status, response.text
    assert owner_email not in response.text
    if case.expected_status >= 400:
        # A refused caller learns nothing about the resource or its owner.
        assert str(owner) not in response.text
        assert "Private proposal" not in response.text
        assert "34.01" not in response.text
        assert_private_body(response.json(), private)
        assert str(identity) not in response.text
        assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
    elif response.content:
        # An allowed caller gets this resource and no other identity's account data.
        assert response.json()["id"] == str(identity)
        assert "author_id" not in response.json()


ADMIN_IDOR_CASES = (
    (UserRole.MODERATOR, True, "auth.forbidden"),
    (UserRole.ADMIN, False, "auth.step_up_required"),
)


@pytest.mark.parametrize(("role", "fresh", "code"), ADMIN_IDOR_CASES)
async def test_admin_role_idor_is_refused(
    services: Services, clock: FixedClock, role: UserRole, fresh: bool, code: str
) -> None:
    services.step_up = SessionStepUpSource()
    target, email = await create_account(services, UserRole.USER)
    _, actor_email = await create_account(services, role)
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers = await sign_in(client, actor_email)
        output = await enrol(client, headers)
        assert (
            await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        if fresh:
            clock.advance(seconds=30)
            assert (await verify(client, headers, output.secret, clock)).status_code == 200
        response = await client.patch(
            f"/v1/admin/users/{target}/role", headers=headers, json={"role": "admin"}
        )
    problem(response, 403, code)
    assert email not in response.text
    assert str(target) not in response.text
    async with services.session_factory() as db:
        stored = await db.get(User, target)
        assert stored is not None
        assert stored.role == "user"


async def test_stepped_up_contributor_cannot_read_admin_users(
    services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    _, email = await create_account(services, UserRole.CONTRIBUTOR)
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers = await sign_in(client, email)
        output = await enrol(client, headers)
        assert (
            await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        clock.advance(seconds=30)
        assert (await verify(client, headers, output.secret, clock)).status_code == 200
        response = await client.get("/v1/admin/users", headers=headers)
    problem(response, 403, "auth.forbidden")
    assert email not in response.text


@pytest.mark.parametrize(("role", "fresh", "code"), ADMIN_IDOR_CASES)
async def test_suppression_removal_idor_is_refused(
    services: Services, clock: FixedClock, role: UserRole, fresh: bool, code: str
) -> None:
    services.step_up = SessionStepUpSource()
    address = "victim.suppressed@example.com"
    async with services.session_factory() as db:
        await suppress(db, services.settings, [address], SuppressionReason.BOUNCE, clock.now())
        await db.commit()
    _, actor_email = await create_account(services, role)
    transport = httpx.ASGITransport(app=build_test_app(services), client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers = await sign_in(client, actor_email)
        output = await enrol(client, headers)
        assert (
            await verify(client, headers, output.secret, clock, "/v1/me/totp/confirm")
        ).status_code == 200
        if fresh:
            clock.advance(seconds=30)
            assert (await verify(client, headers, output.secret, clock)).status_code == 200
        response = await client.request(
            "DELETE", "/v1/admin/suppressions", headers=headers, json={"email": address}
        )
    problem(response, 403, code)
    assert address not in response.text
    async with services.session_factory() as db:
        assert await db.scalar(select(EmailSuppression.id)) is not None
        assert (
            await db.scalar(
                select(AuditLog.id).where(AuditLog.action == "admin.suppression_removed")
            )
            is None
        )
