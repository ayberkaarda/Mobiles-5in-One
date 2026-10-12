"""Webhook routes in the authorization harness (authorization matrix row "POST
webhooks/revenuecat; POST webhooks/resend", ADR-0050): no human role and no human credential
reaches them; only the provider credential does."""

import base64
import json

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.deps import Services
from app.main import create_app
from app.models.enums import UserRole
from app.models.ops import WebhookEvent
from tests.support.app import FixedClock, build_test_app, make_test_settings
from tests.support.billing import rc_event
from tests.support.domain import create_account, sign_in
from tests.support.routes import route_signatures

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

WEBHOOK_ROUTES = {("POST", "/v1/webhooks/revenuecat"), ("POST", "/v1/webhooks/resend")}
RC_SECRET = "rc-webhook-" + "s" * 40
RESEND_SECRET = "whsec_" + base64.b64encode(bytes(range(1, 33))).decode()


def test_webhook_route_table_is_exact() -> None:
    application = create_app(make_test_settings())
    actual = {
        (method, path)
        for method, path in route_signatures(application)
        if path.startswith("/v1/webhooks")
    }
    assert actual == WEBHOOK_ROUTES


def test_webhook_routes_stay_out_of_the_public_contract() -> None:
    paths = create_app(make_test_settings()).openapi()["paths"]
    assert not [path for path in paths if "webhook" in path]


@pytest.mark.parametrize("role", [None, *UserRole], ids=["anonymous", *map(str, UserRole)])
async def test_no_human_role_reaches_webhooks(
    role: UserRole | None, services: Services, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(
        update={
            "revenuecat_webhook_secret": SecretStr(RC_SECRET),
            "resend_webhook_secret": SecretStr(RESEND_SECRET),
        }
    )
    transport = httpx.ASGITransport(app=build_test_app(services), client=("192.0.2.30", 41000))
    async with httpx.AsyncClient(transport=transport, base_url="https://testserver") as client:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        subject = "0190a3c4-0000-7000-8000-00000000abcd"
        if role is not None:
            identity, email = await create_account(services, role)
            subject = str(identity)
            headers |= await sign_in(client, email)
        body = json.dumps(rc_event("INITIAL_PURCHASE", subject, clock.now())).encode()
        revenuecat = await client.post("/v1/webhooks/revenuecat", content=body, headers=headers)
        resend = await client.post("/v1/webhooks/resend", content=body, headers=headers)
    assert (revenuecat.status_code, revenuecat.json()["code"]) == (401, "webhook.unauthorized")
    assert (resend.status_code, resend.json()["code"]) == (401, "webhook.signature_invalid")
    async with services.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(WebhookEvent)) == 0
