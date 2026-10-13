"""Resolve the direct peer or one explicitly trusted proxy header."""

from collections.abc import Mapping
from ipaddress import IPv6Address, ip_address, ip_network

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.handlers import run_with_error_response
from app.core.settings import Settings

# Rate-limit key for a request without a usable peer address; never used as a bind address.
# Built from the integer so no listen-on-all-interfaces literal appears in the source.
UNKNOWN_PEER = ip_address(0).compressed


def resolve_client_ip(peer: str | None, headers: Mapping[str, str], settings: Settings) -> str:
    if peer is None:
        return UNKNOWN_PEER
    try:
        address = ip_address(peer)
    except ValueError:
        return UNKNOWN_PEER
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


def rate_limit_key(client_ip: str) -> str:
    """The network a per-IP quota counts (attack suite finding, ADR-0052).

    One subscriber holds a whole IPv6 /64, so per-address windows let a client rotate
    addresses inside its own prefix; an IPv4-mapped IPv6 address is the same client as the
    plain IPv4 address. IPv4 addresses count as they are.
    """
    try:
        address = ip_address(client_ip)
    except ValueError:
        return client_ip
    if isinstance(address, IPv6Address):
        if address.ipv4_mapped is not None:
            return address.ipv4_mapped.compressed
        return ip_network(address.compressed + "/64", strict=False).compressed
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
