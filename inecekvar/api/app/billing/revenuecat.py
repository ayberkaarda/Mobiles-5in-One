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


# The `subscriptions.product_id` column bound: a longer provider id cannot be one of ours.
MAX_PRODUCT_ID_LENGTH = 128


class RevenueCatError(Exception):
    """The provider did not answer with a usable result; nothing may be changed from it."""


class RevenueCatUnauthorizedError(RevenueCatError):
    """401/403: the key is wrong or revoked; every later request of the run would fail too."""


class RevenueCatRateLimitedError(RevenueCatError):
    """429: the caller must slow down; `retry_after` is the provider's hint in seconds."""

    def __init__(self, retry_after: float | None) -> None:
        super().__init__("RevenueCat rate limited the request")
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class ProductState:
    product_id: str
    expires_at: datetime | None
    grace_expires_at: datetime | None = None
    unsubscribed_at: datetime | None = None
    billing_issue_at: datetime | None = None
    refunded_at: datetime | None = None
    is_sandbox: bool = False
    # A `non_subscriptions` (lifetime) purchase: it has no refund marker of its own, so its
    # state derives from the Plus entitlement.
    non_subscription: bool = False


@dataclass(frozen=True, slots=True)
class SubscriberSnapshot:
    app_user_id: str
    # Product ids the provider currently links to the Plus entitlement (empty when the
    # entitlement was revoked, refunded or never granted).
    entitled_products: frozenset[str]
    products: tuple[ProductState, ...]
    # `entitlements[plus].expires_date`: None for a lifetime entitlement or for none at all.
    entitlement_expires_at: datetime | None = None
    # The provider's `request_date` (its clock when it built the answer), when it sent one.
    request_date: datetime | None = None


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
    request_date: datetime | None = None
    subscriber: _Subscriber


def parse_subscriber(app_user_id: str, content: bytes, entitlement: str) -> SubscriberSnapshot:
    try:
        response = _SubscriberResponse.model_validate_json(content)
    except ValidationError:
        raise RevenueCatError("RevenueCat subscriber response is not usable") from None
    subscriber = response.subscriber
    entitled = subscriber.entitlements.get(entitlement)
    entitled_product = entitled.product_identifier if entitled is not None else None
    entitlement_expires_at = entitled.expires_date if entitled is not None else None
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
        if len(product_id) <= MAX_PRODUCT_ID_LENGTH
    ]
    products.extend(
        ProductState(
            product_id=product_id,
            # A lifetime purchase lasts as long as the entitlement that names it.
            expires_at=entitlement_expires_at if product_id == entitled_product else None,
            is_sandbox=all(item.is_sandbox for item in purchases),
            non_subscription=True,
        )
        for product_id, purchases in sorted(subscriber.non_subscriptions.items())
        if purchases
        and product_id not in subscriber.subscriptions
        and len(product_id) <= MAX_PRODUCT_ID_LENGTH
    )
    return SubscriberSnapshot(
        app_user_id=app_user_id,
        entitled_products=frozenset({entitled_product} if entitled_product else set()),
        products=tuple(products),
        entitlement_expires_at=entitlement_expires_at,
        request_date=response.request_date,
    )


def retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after", "")
    return float(value) if value.isascii() and value.isdigit() else None


def raise_for_status(response: httpx.Response, accepted: tuple[int, ...]) -> None:
    if response.status_code in accepted:
        return
    if response.status_code in (401, 403):
        raise RevenueCatUnauthorizedError("RevenueCat refused the API key")
    if response.status_code == 429:
        raise RevenueCatRateLimitedError(retry_after_seconds(response))
    raise RevenueCatError("RevenueCat answered with an error status")


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
        raise_for_status(response, (200,))
        return parse_subscriber(app_user_id, response.content, self._entitlement)

    async def delete_subscriber(self, app_user_id: str) -> None:
        try:
            async with self._client() as client:
                response = await client.delete(self._url(app_user_id))
        except httpx.HTTPError:
            raise RevenueCatError("RevenueCat is not reachable") from None
        raise_for_status(response, (200, 204, 404))
