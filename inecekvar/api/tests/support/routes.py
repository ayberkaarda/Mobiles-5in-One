"""Route enumeration for tests.

FastAPI 0.143 mounts an included router as one `_IncludedRouter` entry in `app.routes`; its
effective routes (with the prefix applied) come from `effective_route_contexts()`. This helper
flattens both shapes so route-table tests see every mounted method and path.
"""

from collections.abc import Iterable

from fastapi import FastAPI
from starlette.routing import BaseRoute, Route


def _flatten(routes: Iterable[BaseRoute]) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for route in routes:
        contexts = getattr(route, "effective_route_contexts", None)
        if callable(contexts):
            for context in contexts():
                original = context.original_route
                methods = getattr(original, "methods", None) or set()
                found.update((str(method), str(context.path)) for method in methods)
        elif isinstance(route, Route):
            found.update((method, route.path) for method in route.methods or set())
    return found


def route_signatures(application: FastAPI) -> set[tuple[str, str]]:
    """Every (method, path) the application serves, HEAD included where Starlette adds it."""
    return _flatten(application.routes)


def has_route(application: FastAPI, path: str) -> bool:
    return any(candidate == path for _, candidate in route_signatures(application))
