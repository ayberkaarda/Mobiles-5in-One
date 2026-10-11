"""Resolve the direct peer or one explicitly trusted proxy header."""

from collections.abc import Mapping
from ipaddress import ip_address

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.handlers import run_with_error_response
from app.core.settings import Settings


def resolve_client_ip(peer: str | None, headers: Mapping[str, str], settings: Settings) -> str:
    if peer is None:
        return "0.0.0.0"  # noqa: S104 (missing peer sentinel, not a bind address)
    try:
        address = ip_address(peer)
    except ValueError:
        return "0.0.0.0"  # noqa: S104 (missing peer sentinel, not a bind address)
    if any(address in network for network in settings.trusted_proxy_networks):
        values = [
            value
            for key, value in headers.items()
            if key.lower() == settings.client_ip_header.lower()
        ]
        if len(values) == 1:
            try:
                return ip_address(values[0]).compressed
            except ValueError:
                return address.compressed
    return address.compressed


class ClientIpMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await run_with_error_response(self.handle, scope, receive, send)

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            client = scope.get("client")
            scope.setdefault("state", {})["client_ip"] = resolve_client_ip(
                client[0] if client else None, Headers(scope=scope), self.settings
            )
        await self.app(scope, receive, send)
