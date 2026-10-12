import asyncio
import uuid
from datetime import datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import router as admin_router
from app.auth.schemas import BearerOut
from app.auth.step_up import SessionStepUpSource, record_step_up
from app.auth.tokens import decode_access_token
from app.core.deps import Principal, Services
from app.models import AuditLog, Export, SessionStepUp, User
from app.models.enums import UserRole
from app.security.audit import audit
from tests.auth.conftest import PASSWORD, bearer_headers, login_user
from tests.security.conftest import create_account, sign_in
from tests.security.test_admin_routes import actor_account, diff_digest
from tests.support.app import FixedClock, build_test_app
from tests.support.domain import seed_city
from tests.support.storage import S3Buckets
from tests.totp.test_totp_step_up import problem

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]


async def test_export_audit_failure_leaves_no_export_row(
    services: Services,
    client: httpx.AsyncClient,
    clock: FixedClock,
    s3_buckets: S3Buckets,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    services.step_up = SessionStepUpSource()
    await seed_city(services)
    services.object_store = s3_buckets.store
    services.settings = services.settings.model_copy(update=s3_buckets.settings_overrides())
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)

    def broken_audit(
        db: AsyncSession,
        actor_id: Principal | uuid.UUID | None,
        action: str,
        target_type: str,
        target_id: uuid.UUID | None,
        diff: object,
        now: datetime,
    ) -> None:
        raise RuntimeError("audit storage unavailable")

    monkeypatch.setattr(admin_router, "audit", broken_audit)
    transport = httpx.ASGITransport(app=build_test_app(services), raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as connection:
        response = await connection.post("/v1/admin/exports/ornek-test-sehri", headers=headers)
    assert response.status_code == 500
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(Export)) == 0


async def test_users_read_is_audited_without_pii(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    await create_account(services, UserRole.USER)
    response = await client.get(
        "/v1/admin/users", headers=headers, params={"role": "user", "limit": 2, "offset": 0}
    )
    assert response.status_code == 200
    diff = {"filters": {"role": "user", "limit": 2, "offset": 0}, "result_count": 1}
    async with services.session_factory() as db:
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "admin.users_read"))
        assert row is not None
        assert (row.actor_id, row.target_type, row.target_id) == (actor, "user", None)
        assert row.diff_hash == diff_digest(diff)


async def test_audit_read_is_audited(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    target = uuid.uuid4()
    now = clock.now()
    since = now - timedelta(days=2)
    async with services.session_factory() as db:
        audit(db, actor, "admin.export", "city", target, {"version": 1}, now)
        await db.commit()
    response = await client.get(
        "/v1/admin/audit-logs",
        headers=headers,
        params={
            "actor_id": str(actor),
            "action": "admin.export",
            "target_type": "city",
            "target_id": str(target),
            "since": since.isoformat(),
            "until": now.isoformat(),
            "limit": 2,
            "offset": 0,
        },
    )
    assert response.status_code == 200
    diff = {
        "filters": {
            "actor_id": str(actor),
            "action": "admin.export",
            "target_type": "city",
            "target_id": str(target),
            "since": since.isoformat(),
            "until": now.isoformat(),
            "limit": 2,
            "offset": 0,
        },
        "result_count": 1,
    }
    async with services.session_factory() as db:
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "admin.audit_read"))
        assert row is not None
        assert (row.actor_id, row.target_type, row.target_id) == (actor, "audit_log", None)
        assert row.diff_hash == diff_digest(diff)


async def test_audit_logs_default_window_excludes_old_rows(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    actor, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    async with services.session_factory() as db:
        audit(db, actor, "test.old", "user", actor, {}, clock.now() - timedelta(days=40))
        await db.commit()
    response = await client.get(
        "/v1/admin/audit-logs", headers=headers, params={"action": "test.old"}
    )
    assert response.status_code == 200
    assert response.json()["items"] == []
    expanded = await client.get(
        "/v1/admin/audit-logs",
        headers=headers,
        params={"action": "test.old", "since": (clock.now() - timedelta(days=45)).isoformat()},
    )
    assert expanded.status_code == 200
    assert len(expanded.json()["items"]) == 1


async def test_audit_logs_since_only_is_range_capped(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.step_up = SessionStepUpSource()
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    response = await client.get(
        "/v1/admin/audit-logs",
        headers=headers,
        params={"since": (clock.now() - timedelta(days=400)).isoformat()},
    )
    problem(response, 422, "validation.failed")


async def test_concurrent_admin_self_deletions_keep_one_admin(
    client: httpx.AsyncClient, services: Services
) -> None:
    first, first_email = await create_account(services, UserRole.ADMIN)
    second, second_email = await create_account(services, UserRole.ADMIN)
    headers = [await sign_in(client, email) for email in (first_email, second_email)]
    responses = await asyncio.gather(
        *(
            client.request("DELETE", "/v1/me", json={"password": PASSWORD}, headers=item)
            for item in headers
        )
    )
    assert sorted(response.status_code for response in responses) == [202, 409]
    problem(
        next(response for response in responses if response.status_code == 409),
        409,
        "admin.last_admin",
    )
    async with services.session_factory() as db:
        remaining = list(
            await db.scalars(
                select(User.id).where(User.role == "admin", User.deactivated_at.is_(None))
            )
        )
        assert len(remaining) == 1
        assert remaining[0] in (first, second)


async def test_last_admin_cannot_delete_account(
    client: httpx.AsyncClient, services: Services
) -> None:
    identity, email = await create_account(services, UserRole.ADMIN)
    headers = await sign_in(client, email)
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=headers
    )
    problem(response, 409, "admin.last_admin")
    async with services.session_factory() as db:
        user = await db.get(User, identity)
        assert user is not None
        assert user.deactivated_at is None


async def test_refresh_reuse_clears_step_up(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    identity, email = await create_account(services, UserRole.ADMIN)
    response = await login_user(client, email=email, mode="bearer")
    login = BearerOut.model_validate(response.json())
    family = decode_access_token(login.access_token, services.settings, clock.now()).family_id
    async with services.session_factory() as db:
        await record_step_up(db, Principal(identity, UserRole.ADMIN, family, "bearer"), clock.now())
        await db.commit()
    assert (
        await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    ).status_code == 200
    replay = await client.post("/v1/auth/refresh", json={"refresh_token": login.refresh_token})
    problem(replay, 401, "auth.token_invalid")
    async with services.session_factory() as db:
        assert await db.get(SessionStepUp, family) is None
    assert (await client.get("/v1/me", headers=bearer_headers(response))).status_code == 401
