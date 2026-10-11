import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

import httpx
import pytest
from fastapi import APIRouter, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ClockDep, DbDep, OptionalPrincipalDep, Services
from app.core.errors import AUTH_FORBIDDEN, AUTH_REQUIRED, NOT_FOUND, ProblemError
from app.core.ids import uuid7
from app.models.contributions import Edit, Trace
from app.models.enums import EditState, UserRole
from app.security.policy import Action, ResourceContext, authorize, can_read_edit
from tests.security.conftest import create_account, sign_in
from tests.support.app import build_test_app

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
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.USER,
        403,
    ),
    IdorCase(
        "contributor-other-trace",
        "GET",
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "owner-trace",
        "GET",
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.CONTRIBUTOR,
        UserRole.USER,
        200,
        make_owner,
    ),
    IdorCase(
        "moderator-other-trace",
        "GET",
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.MODERATOR,
        200,
    ),
    IdorCase(
        "anonymous-trace",
        "GET",
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.USER,
        None,
        401,
    ),
    IdorCase(
        "unknown-trace",
        "GET",
        "/v1/_probe/traces/{id}",
        "trace",
        UserRole.USER,
        UserRole.USER,
        404,
        remove_trace,
    ),
    IdorCase(
        "contributor-other-edit",
        "GET",
        "/v1/_probe/edits/{id}",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "author-edit",
        "GET",
        "/v1/_probe/edits/{id}",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.USER,
        200,
        make_author,
    ),
    IdorCase(
        "contributor-approve",
        "POST",
        "/v1/_probe/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.CONTRIBUTOR,
        403,
    ),
    IdorCase(
        "moderator-self-approve",
        "POST",
        "/v1/_probe/edits/{id}/approve",
        "edit",
        UserRole.MODERATOR,
        UserRole.MODERATOR,
        403,
        make_author,
    ),
    IdorCase(
        "moderator-approve-pending",
        "POST",
        "/v1/_probe/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        204,
    ),
    IdorCase(
        "moderator-approve-approved",
        "POST",
        "/v1/_probe/edits/{id}/approve",
        "edit",
        UserRole.CONTRIBUTOR,
        UserRole.MODERATOR,
        403,
        mark_approved,
    ),
    IdorCase(
        "admin-self-approve",
        "POST",
        "/v1/_probe/edits/{id}/approve",
        "edit",
        UserRole.ADMIN,
        UserRole.ADMIN,
        403,
        make_author,
    ),
]

probe = APIRouter(prefix="/v1/_probe")


@probe.get("/traces/{id}")
async def read_trace(
    id: uuid.UUID, db: DbDep, principal: OptionalPrincipalDep, clock: ClockDep
) -> dict[str, str]:
    trace = await db.get(Trace, id)
    if trace is None:
        raise ProblemError(NOT_FOUND, 404)
    authorize(
        principal,
        Action.VIEW_TRACE,
        ResourceContext(actor_id=None, trace_owner_id=trace.author_id, now=clock.now()),
    )
    return {"id": str(trace.id)}


@probe.get("/edits/{id}")
async def read_edit(id: uuid.UUID, db: DbDep, principal: OptionalPrincipalDep) -> dict[str, str]:
    edit = await db.get(Edit, id)
    if edit is None:
        raise ProblemError(NOT_FOUND, 404)
    if not can_read_edit(principal, edit.author_id):
        if principal is None:
            raise ProblemError(AUTH_REQUIRED, 401)
        raise ProblemError(AUTH_FORBIDDEN, 403)
    return {"id": str(edit.id)}


@probe.post("/edits/{id}/approve", status_code=204)
async def approve_edit(
    id: uuid.UUID, db: DbDep, principal: OptionalPrincipalDep, clock: ClockDep
) -> Response:
    edit = await db.get(Edit, id)
    if edit is None:
        raise ProblemError(NOT_FOUND, 404)
    authorize(
        principal,
        Action.APPROVE_EDIT,
        ResourceContext(
            actor_id=None,
            edit_author_id=edit.author_id,
            edit_state=EditState(edit.state),
            now=clock.now(),
        ),
    )
    return Response(status_code=204)


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
            "INSERT INTO traces (id, city_id, author_id, points, started_at, ended_at) "
            "VALUES (:id, :city, :owner, '[[34.01,42.51],[34.02,42.52]]'::jsonb, now(), now())"
        )
    else:
        statement = (
            "INSERT INTO edits (id, kind, city_id, payload, author_id) "
            "VALUES (:id, 'new_line', :city, '{\"name\":\"Private proposal\"}'::jsonb, :owner)"
        )
    await db.execute(text(statement), {"id": identity, "city": city_id, "owner": owner})
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
    application.include_router(probe)
    transport = httpx.ASGITransport(app=application, client=("203.0.113.10", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers = await sign_in(client, actor_email) if actor_email is not None else {}
        response = await client.request(case.method, case.path.format(id=identity), headers=headers)
    assert response.status_code == case.expected_status
    assert str(owner) not in response.text
    assert owner_email not in response.text
    assert "Private proposal" not in response.text
    assert "34.01" not in response.text
    if response.content:
        assert_private_body(response.json(), private)
    if case.expected_status >= 400:
        assert str(identity) not in response.text
        assert set(response.json()) == {"type", "title", "status", "code", "request_id"}
