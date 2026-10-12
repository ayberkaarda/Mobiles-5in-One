"""Safe problem responses and protection from unhandled application errors."""

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import (
    INTERNAL,
    METHOD_NOT_ALLOWED,
    NOT_FOUND,
    PROBLEM_CONTENT_TYPE,
    VALIDATION_FAILED,
    ProblemError,
    problem_body,
    problem_response,
    request_id_of,
)


async def validation_problem(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        problem_body(VALIDATION_FAILED, 422, request_id_of(request)),
        status_code=422,
        media_type=PROBLEM_CONTENT_TYPE,
    )


async def http_problem(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, HTTPException):
        raise TypeError("HTTPException required")
    code = {404: NOT_FOUND, 405: METHOD_NOT_ALLOWED}.get(exc.status_code, f"http.{exc.status_code}")
    return JSONResponse(
        problem_body(code, exc.status_code, request_id_of(request)),
        status_code=exc.status_code,
        headers=exc.headers,
        media_type=PROBLEM_CONTENT_TYPE,
    )


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ProblemError, problem_response)
    app.add_exception_handler(RequestValidationError, validation_problem)
    app.add_exception_handler(HTTPException, http_problem)


async def send_problem(scope: Scope, receive: Receive, send: Send, code: str, status: int) -> None:
    response = JSONResponse(
        problem_body(code, status, request_id_of(Request(scope))),
        status_code=status,
        media_type=PROBLEM_CONTENT_TYPE,
    )
    await response(scope, receive, send)


async def run_with_error_response(app: ASGIApp, scope: Scope, receive: Receive, send: Send) -> None:
    """Protect both application execution and a middleware's own controls."""
    if scope["type"] != "http":
        await app(scope, receive, send)
        return
    started = False

    async def track_start(message: Message) -> None:
        nonlocal started
        if message["type"] == "http.response.start":
            started = True
        await send(message)

    try:
        await app(scope, receive, track_start)
    except Exception:
        structlog.get_logger().error("request.unhandled_error", exc_info=True)
        if not started:
            await send_problem(scope, receive, send, INTERNAL, 500)


class UnhandledErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await run_with_error_response(self.app, scope, receive, send)
