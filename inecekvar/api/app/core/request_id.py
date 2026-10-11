"""Request correlation across responses and structured logs."""

import re

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from structlog.contextvars import bind_contextvars, reset_contextvars

from app.core.handlers import run_with_error_response
from app.core.ids import uuid7

_VALID = re.compile(r"[A-Za-z0-9-]{8,64}")


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        values = Headers(scope=scope).getlist("x-request-id")
        request_id = values[0] if len(values) == 1 and _VALID.fullmatch(values[0]) else str(uuid7())
        scope.setdefault("state", {})["request_id"] = request_id
        context = bind_contextvars(request_id=request_id)

        async def send_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await run_with_error_response(self.app, scope, receive, send_id)
        finally:
            reset_contextvars(**context)
