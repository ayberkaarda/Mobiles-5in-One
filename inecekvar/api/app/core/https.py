"""Refuse plain http (spec section 6.10, ADR-0055).

A request counts as https when it arrived over TLS (`scope["scheme"]`) or when its direct peer is
a trusted proxy (`INECEKVAR_TRUSTED_PROXY_CIDRS`, the same networks the client IP trusts) that
sends exactly one forwarded-proto header with the value `https`. The header from any other peer
is ignored, so a client cannot claim https by sending it. Refused requests get 403
`transport.https_required` and never reach routing: no redirect, because a client that already
sent a token or cookie over plain http must fail loudly instead of being sent on (browsers are
redirected by the reverse proxy before they reach the API, and HSTS keeps them on https).
"""

from collections.abc import Sequence
from ipaddress import ip_address

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import HTTPS_REQUIRED
from app.core.handlers import send_problem
from app.core.settings import Settings

# Liveness probes of the hosting platform reach the process directly; the answer holds no data.
EXEMPT_PATHS: frozenset[str] = frozenset({"/v1/health"})


def is_trusted_peer(peer: str | None, settings: Settings) -> bool:
    if peer is None:
        return False
    try:
        address = ip_address(peer)
    except ValueError:
        return False
    return any(address in network for network in settings.trusted_proxy_networks)


def effective_scheme(
    scheme: str, peer: str | None, forwarded: Sequence[str], settings: Settings
) -> str:
    """The scheme the client used: the forwarded value only from a trusted proxy."""
    if is_trusted_peer(peer, settings) and len(forwarded) == 1:
        value = forwarded[0].strip().lower()
        if value in {"http", "https"}:
            return value
    return scheme.lower()


class HttpsOnlyMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or not self.settings.https_enforced
            or scope["path"] in EXEMPT_PATHS
        ):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        forwarded = Headers(scope=scope).getlist(self.settings.forwarded_proto_header)
        scheme = effective_scheme(
            scope.get("scheme", "http"), client[0] if client else None, forwarded, self.settings
        )
        if scheme != "https":
            await send_problem(scope, receive, send, HTTPS_REQUIRED, 403)
            return
        await self.app(scope, receive, send)
