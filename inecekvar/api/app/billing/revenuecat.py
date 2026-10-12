"""RevenueCat REST v1: subscriber snapshot for the nightly reconciliation and subscriber
deletion for account erasure (spec section 4 `httpx`, section 6.21, ADR-0026, ADR-0050).

The host is fixed in code (no configurable URL, no redirects). Errors raise `RevenueCatError`
with a fixed message: no response text, key or subscriber id reaches an exception or a log.
Responses are parsed leniently (`extra="ignore"`) because the provider adds fields.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.core.settings import Settings

REVENUECAT_API = "https://api.revenuecat.com/v1"


class RevenueCatError(Exception):
    """The provider did not answer with a usable result; nothing may be changed from it."""


@dataclass(frozen=True, slots=True)
class ProductState:
    product_id: str
    expires_at: datetime | None
    grace_expires_at: datetime | None = None
    unsubscribed_at: datetime | None = None
    billing_issue_at: datetime | None = None
    refunded_at: datetime | None = None
    is_sandbox: bool = False


@dataclass(frozen=True, slots=True)
class SubscriberSnapshot:
    app_user_id: str
    # Product ids the provider currently links to the Plus entitlement.
    entitled_products: frozenset[str]
    products: tuple[ProductState, ...]


class SubscriberDirectory(Protocol):
    async def get_subscriber(self, app_user_id: str) -> SubscriberSnapshot:
        """The provider's current view of one subscriber; raises `RevenueCatError`."""
        ...

    async def delete_subscriber(self, app_user_id: str) -> None:
        """Remove the subscriber (an unknown subscriber counts as removed); raises on failure."""
        ...


class _Entitlement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    product_identifier: str | None = None
    expires_date: datetime | None = None


class _Subscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    expires_date: datetime | None = None
    grace_period_expires_date: datetime | None = None
    unsubscribe_detected_at: datetime | None = None
    billing_issues_detected_at: datetime | None = None
    refunded_at: datetime | None = None
    is_sandbox: bool = False


class _NonSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    is_sandbox: bool = False


class _Subscriber(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entitlements: dict[str, _Entitlement] = {}
    subscriptions: dict[str, _Subscription] = {}
    non_subscriptions: dict[str, list[_NonSubscription]] = {}


class _SubscriberResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    subscriber: _Subscriber


def parse_subscriber(app_user_id: str, content: bytes, entitlement: str) -> SubscriberSnapshot:
    try:
        subscriber = _SubscriberResponse.model_validate_json(content).subscriber
    except ValidationError:
        raise RevenueCatError("RevenueCat subscriber response is not usable") from None
    entitled = subscriber.entitlements.get(entitlement)
    products = [
        ProductState(
            product_id=product_id,
            expires_at=item.expires_date,
            grace_expires_at=item.grace_period_expires_date,
            unsubscribed_at=item.unsubscribe_detected_at,
            billing_issue_at=item.billing_issues_detected_at,
            refunded_at=item.refunded_at,
            is_sandbox=item.is_sandbox,
        )
        for product_id, item in sorted(subscriber.subscriptions.items())
    ]
    products.extend(
        ProductState(
            product_id=product_id,
            expires_at=None,
            is_sandbox=all(item.is_sandbox for item in purchases),
        )
        for product_id, purchases in sorted(subscriber.non_subscriptions.items())
        if purchases and product_id not in subscriber.subscriptions
    )
    return SubscriberSnapshot(
        app_user_id=app_user_id,
        entitled_products=frozenset(
            {entitled.product_identifier}
            if entitled is not None and entitled.product_identifier
            else set()
        ),
        products=tuple(products),
    )


class RevenueCatRestClient:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        if settings.revenuecat_api_key is None:
            raise RuntimeError("INECEKVAR_REVENUECAT_API_KEY is not configured")
        self._key = settings.revenuecat_api_key
        self._entitlement = settings.revenuecat_plus_entitlement
        self._timeout = settings.revenuecat_timeout_seconds
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=self._transport,
            timeout=self._timeout,
            follow_redirects=False,
            headers={
                "Authorization": "Bearer " + self._key.get_secret_value(),
                "Accept": "application/json",
            },
        )

    @staticmethod
    def _url(app_user_id: str) -> str:
        return REVENUECAT_API + "/subscribers/" + quote(app_user_id, safe="")

    async def get_subscriber(self, app_user_id: str) -> SubscriberSnapshot:
        try:
            async with self._client() as client:
                response = await client.get(self._url(app_user_id))
        except httpx.HTTPError:
            raise RevenueCatError("RevenueCat is not reachable") from None
        if response.status_code != 200:
            raise RevenueCatError("RevenueCat answered with an error status")
        return parse_subscriber(app_user_id, response.content, self._entitlement)

    async def delete_subscriber(self, app_user_id: str) -> None:
        try:
            async with self._client() as client:
                response = await client.delete(self._url(app_user_id))
        except httpx.HTTPError:
            raise RevenueCatError("RevenueCat is not reachable") from None
        if response.status_code not in (200, 204, 404):
            raise RevenueCatError("RevenueCat answered with an error status")
