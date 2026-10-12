"""`DELETE /v1/admin/suppressions` (ADR-0050 item 12): an admin with a fresh TOTP step-up lifts
the suppression of one address given in a bounded JSON body; the audit row keeps only the keyed
digest of the address."""

import hashlib
import json

import httpx
import pytest
from sqlalchemy import func, select, text

from app.auth.suppression import suppress, suppression_hash
from app.core.deps import Services
from app.models import AuditLog
from app.models.enums import SuppressionReason, UserRole
from app.models.ops import EmailSuppression
from tests.security.test_admin_routes import actor_account, client
from tests.support.app import FixedClock
from tests.totp.test_totp_step_up import problem

__all__ = ["client"]

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

URL = "/v1/admin/suppressions"
ADDRESS = "Bounced.Person@Example.com"


async def add(services: Services, address: str, reason: SuppressionReason) -> None:
    async with services.session_factory() as db:
        await suppress(db, services.settings, [address], reason, services.clock.now())
        await db.commit()


async def entries(services: Services) -> int:
    async with services.session_factory() as db:
        return int(await db.scalar(select(func.count()).select_from(EmailSuppression)) or 0)


@pytest.mark.parametrize("reason", list(SuppressionReason))
async def test_admin_removes_a_suppression_and_audits_the_digest_only(
    reason: SuppressionReason, client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    await add(services, ADDRESS, reason)
    await add(services, "kept@example.com", SuppressionReason.BOUNCE)
    async with services.session_factory() as db:
        row_id = await db.scalar(
            select(EmailSuppression.id).where(
                EmailSuppression.email_hash == suppression_hash(services.settings, ADDRESS)
            )
        )
    admin, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    response = await client.request("DELETE", URL, headers=headers, json={"email": ADDRESS.lower()})
    assert (response.status_code, response.json()) == (200, {"removed": True})
    assert ADDRESS.lower() not in response.text.lower()
    assert await entries(services) == 1
    digest = suppression_hash(services.settings, ADDRESS).hex()
    canonical = json.dumps(
        {"email_hash": digest, "removed": True}, sort_keys=True, separators=(",", ":")
    ).encode()
    async with services.session_factory() as db:
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "admin.suppression_removed")
        )
        dump = await db.scalar(
            text("SELECT string_agg(row_to_json(a)::text, ' ') FROM audit_logs a")
        )
    assert audit is not None
    assert (audit.actor_id, audit.target_type, audit.target_id) == (
        admin,
        "email_suppression",
        row_id,
    )
    assert audit.diff_hash == hashlib.sha256(canonical).digest()
    assert dump is not None
    assert "example.com" not in dump.lower()


async def test_unknown_address_is_answered_and_audited(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    await add(services, "kept@example.com", SuppressionReason.BOUNCE)
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    response = await client.request(
        "DELETE", URL, headers=headers, json={"email": "nobody@example.com"}
    )
    assert (response.status_code, response.json()) == (200, {"removed": False})
    assert await entries(services) == 1
    async with services.session_factory() as db:
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "admin.suppression_removed")
        )
    assert audit is not None
    assert audit.target_id is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"email": "no-at-sign"},
        {"email": "a@" + "b" * 320},
        {"email": "two@@example.com"},
        {"email": ADDRESS, "reason": "bounce"},
    ],
    ids=["missing", "no-at", "too-long", "double-at", "extra-field"],
)
async def test_body_is_bounded(
    body: dict[str, str], client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    await add(services, ADDRESS, SuppressionReason.BOUNCE)
    _, headers = await actor_account(client, services, clock, UserRole.ADMIN)
    problem(
        await client.request("DELETE", URL, headers=headers, json=body), 422, "validation.failed"
    )
    assert await entries(services) == 1
    async with services.session_factory() as db:
        assert (
            await db.scalar(
                select(AuditLog.id).where(AuditLog.action == "admin.suppression_removed")
            )
            is None
        )
