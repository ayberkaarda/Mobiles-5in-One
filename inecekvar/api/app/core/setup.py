"""Install the baseline in outside-to-inside runtime order.

RequestIdMiddleware -> AccessLogMiddleware -> SecurityHeadersMiddleware -> HttpsOnlyMiddleware
-> CorsMiddleware -> ClientIpMiddleware -> BodyLimitMiddleware -> UnhandledErrorMiddleware
-> application.
FastAPI prepends middleware, so registration proceeds in reverse order.
Logging configuration belongs to the process entry point.
"""

from fastapi import FastAPI

from app.core.body_limit import BodyLimitMiddleware
from app.core.client_ip import ClientIpMiddleware
from app.core.cors import CorsMiddleware
from app.core.handlers import UnhandledErrorMiddleware, install_exception_handlers
from app.core.headers import SecurityHeadersMiddleware
from app.core.https import HttpsOnlyMiddleware
from app.core.logging import AccessLogMiddleware
from app.core.request_id import RequestIdMiddleware
from app.core.settings import Settings


def install_core(app: FastAPI, settings: Settings) -> None:
    install_exception_handlers(app)
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(BodyLimitMiddleware, settings=settings)
    app.add_middleware(ClientIpMiddleware, settings=settings)
    app.add_middleware(CorsMiddleware, settings=settings)
    app.add_middleware(HttpsOnlyMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AccessLogMiddleware, settings=settings)
    app.add_middleware(RequestIdMiddleware)
