"""Bound request bodies before routing, including streamed and misdeclared bodies."""

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import BODY_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE
from app.core.handlers import run_with_error_response, send_problem
from app.core.settings import Settings


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await run_with_error_response(self.handle, scope, receive, send)

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        limit = (
            self.settings.max_trace_body_bytes
            if path.startswith("/v1/traces")
            else self.settings.max_body_bytes
        )
        headers = Headers(scope=scope)
        lengths = headers.getlist("content-length")
        declared = 0
        if lengths:
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                await send_problem(scope, receive, send, "http.400", 400)
                return
            declared = int(lengths[0])
        if declared > limit:
            await send_problem(scope, receive, send, BODY_TOO_LARGE, 413)
            return
        check_type = scope["method"] in {"POST", "PUT", "PATCH", "DELETE"} and not path.startswith(
            "/v1/webhooks/"
        )
        types = headers.getlist("content-type")
        json_type = (
            len(types) == 1 and types[0].split(";", 1)[0].strip().lower() == "application/json"
        )
        if check_type and declared > 0 and not json_type:
            await send_problem(scope, receive, send, UNSUPPORTED_MEDIA_TYPE, 415)
            return
        body = bytearray()
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
                await send_problem(scope, receive, send, BODY_TOO_LARGE, 413)
                return
            if check_type and size > 0 and not json_type:
                await send_problem(scope, receive, send, UNSUPPORTED_MEDIA_TYPE, 415)
                return
            body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break
        consumed = False

        async def replay() -> Message:
            nonlocal consumed
            if consumed:
                return await receive()
            consumed = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)
