"""Account erasure removes the RevenueCat subscriber through the REST client (spec section 6.21,
ADR-0026 open item closed by ADR-0050). The provider is a transport double: no real account."""

import uuid

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.billing.revenuecat import RevenueCatRestClient
from app.core.deps import Services
from app.main import build_services
from app.models.accounts import User
from app.models.billing import Subscription
from app.workers.deletion import hard_delete_due
from tests.support.app import FixedClock, make_test_settings
from tests.support.billing import PLUS_PRODUCT
from tests.support.domain import PASSWORD, create_account, sign_in

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]

API_KEY = SecretStr("sk_test_erasure_0123456789abcdefghijkl")


async def schedule_deletion(client: httpx.AsyncClient, services: Services) -> str:
    identity, email = await create_account(services)
    async with services.session_factory() as db:
        db.add(
            Subscription(
                user_id=identity,
                rc_app_user_id=str(identity),
                product_id=PLUS_PRODUCT,
                status="active",
            )
        )
        await db.commit()
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=await sign_in(client, email)
    )
    assert response.status_code == 202
    return str(identity)


@pytest.mark.parametrize("provider_status", [200, 404])
async def test_hard_delete_removes_subscriber_through_rest(
    provider_status: int, client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    identity = await schedule_deletion(client, services)
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(provider_status, json={})

    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    deleter = RevenueCatRestClient(settings, transport=httpx.MockTransport(answer))
    clock.advance(days=7)
    summary = await hard_delete_due(
        services.session_factory, None, services.settings, clock, services.mail_sender, deleter
    )
    assert summary == {"deleted": 1, "deferred": 0}
    assert [(request.method, request.url.path) for request in seen] == [
        ("DELETE", "/v1/subscribers/" + identity)
    ]
    async with services.session_factory() as db:
        assert await db.scalar(select(Subscription.id)) is None
        assert await db.get(User, uuid.UUID(identity)) is None


@pytest.mark.parametrize("provider_status", [200, 404])
async def test_hard_delete_removes_subscriber_of_non_paying_account(
    provider_status: int, client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    # The app identifies every signed-in user at RevenueCat, paying or not (ADR-0050 item 9).
    identity, email = await create_account(services)
    response = await client.request(
        "DELETE", "/v1/me", json={"password": PASSWORD}, headers=await sign_in(client, email)
    )
    assert response.status_code == 202
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(provider_status, json={})

    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    deleter = RevenueCatRestClient(settings, transport=httpx.MockTransport(answer))
    clock.advance(days=7)
    summary = await hard_delete_due(
        services.session_factory, None, services.settings, clock, services.mail_sender, deleter
    )
    assert summary == {"deleted": 1, "deferred": 0}
    assert [(request.method, request.url.path) for request in seen] == [
        ("DELETE", "/v1/subscribers/" + str(identity))
    ]


async def test_provider_error_defers_erasure(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    await schedule_deletion(client, services)
    settings = services.settings.model_copy(update={"revenuecat_api_key": API_KEY})
    deleter = RevenueCatRestClient(
        settings, transport=httpx.MockTransport(lambda request: httpx.Response(503))
    )
    clock.advance(days=7)
    summary = await hard_delete_due(
        services.session_factory, None, services.settings, clock, services.mail_sender, deleter
    )
    assert summary == {"deleted": 0, "deferred": 1}
    async with services.session_factory() as db:
        assert await db.scalar(select(Subscription.id)) is not None


def test_production_composition_wires_the_rest_client() -> None:
    without = build_services(make_test_settings())
    assert (without.subscriber_deleter, without.revenuecat) == (None, None)
    configured = build_services(make_test_settings(revenuecat_api_key=API_KEY))
    assert isinstance(configured.subscriber_deleter, RevenueCatRestClient)
    assert configured.revenuecat is configured.subscriber_deleter
