"""Refuse NUL characters in the request path and query (ZAP API scan finding, ADR-0055).

PostgreSQL text cannot hold U+0000: a NUL in a slug, city or search parameter reached the query
and failed with SQLSTATE 22021, which the error boundary turned into a 500. No legitimate URL of
this API carries a NUL, so the request is refused before routing with 422 `validation.failed`,
like any other parameter that fails validation. Bodies are covered by the schema text rules
(`clean_text`, the email and slug patterns).
"""

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import VALIDATION_FAILED
from app.core.handlers import send_problem


def has_nul(path: str, raw_path: bytes | None, query: bytes) -> bool:
    lowered = query.lower()
    return (
        "\x00" in path
        or (raw_path is not None and (b"\x00" in raw_path or b"%00" in raw_path.lower()))
        or b"\x00" in lowered
        or b"%00" in lowered
    )


class UrlGuardMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and has_nul(
            scope.get("path", ""), scope.get("raw_path"), scope.get("query_string", b"")
        ):
            await send_problem(scope, receive, send, VALIDATION_FAILED, 422)
            return
        await self.app(scope, receive, send)
