"""Exact origin allowlists with credentials reserved for web clients."""

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import ORIGIN_NOT_ALLOWED
from app.core.handlers import run_with_error_response, send_problem
from app.core.settings import (
    CORS_EXPOSED_HEADERS,
    CORS_MAX_AGE_SECONDS,
    CORS_METHODS,
    CORS_REQUEST_HEADERS,
    Settings,
)


class CorsMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await run_with_error_response(self.handle, scope, receive, send)

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origins = headers.getlist("origin")
        origin = origins[0] if len(origins) == 1 else ""
        cookie = origin in self.settings.cookie_origins
        allowed = cookie or origin in self.settings.bearer_origins
        preflight = scope["method"] == "OPTIONS" and "access-control-request-method" in headers

        async def cors_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                for name in {name.lower() for name in response_headers}:
                    if name.lower().startswith("access-control-"):
                        del response_headers[name]
                if allowed:
                    response_headers["Access-Control-Allow-Origin"] = origin
                    if cookie:
                        response_headers["Access-Control-Allow-Credentials"] = "true"
                    vary = response_headers.get("Vary", "")
                    if "origin" not in {part.strip().lower() for part in vary.split(",")}:
                        response_headers["Vary"] = f"{vary}, Origin" if vary else "Origin"
                    if preflight and message["status"] == 204:
                        response_headers["Access-Control-Allow-Methods"] = ", ".join(CORS_METHODS)
                        response_headers["Access-Control-Allow-Headers"] = ", ".join(
                            CORS_REQUEST_HEADERS
                        )
                        response_headers["Access-Control-Max-Age"] = str(CORS_MAX_AGE_SECONDS)
                    elif not preflight:
                        response_headers["Access-Control-Expose-Headers"] = ", ".join(
                            CORS_EXPOSED_HEADERS
                        )
            await send(message)

        if preflight:
            requested = {
                part.strip().lower()
                for value in headers.getlist("access-control-request-headers")
                for part in value.split(",")
                if part.strip()
            }
            methods = headers.getlist("access-control-request-method")
            if (
                not allowed
                or len(methods) != 1
                or methods[0] not in CORS_METHODS
                or not requested.issubset({name.lower() for name in CORS_REQUEST_HEADERS})
            ):
                await send_problem(scope, receive, cors_send, ORIGIN_NOT_ALLOWED, 403)
                return
            await Response(status_code=204)(scope, receive, cors_send)
            return
        await self.app(scope, receive, cors_send)
