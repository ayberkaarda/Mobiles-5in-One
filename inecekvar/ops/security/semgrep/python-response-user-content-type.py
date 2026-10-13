# Fixture for iv-python-response-user-content-type (semgrep --test).
from typing import Annotated

from fastapi import Query, Request, Response

ALLOWED_TYPES = {"geojson": "application/geo+json", "csv": "text/csv"}


async def positive_query(body: bytes, kind: str = Query(...)) -> Response:
    # ruleid: iv-python-response-user-content-type
    return Response(body, media_type=kind)


async def positive_header(request: Request, body: bytes) -> Response:
    wanted = request.headers.get("accept", "text/plain")
    # ruleid: iv-python-response-user-content-type
    return Response(body, headers={"Content-Type": wanted})


async def positive_annotated(body: bytes, kind: Annotated[str, Query()]) -> Response:
    response = Response(body)
    # ruleid: iv-python-response-user-content-type
    response.headers["content-type"] = kind
    return response


async def negative_fixed(body: bytes) -> Response:
    # ok: iv-python-response-user-content-type
    return Response(body, media_type="application/geo+json")


async def negative_allowlist(body: bytes, kind: str = Query(...)) -> Response:
    media = ALLOWED_TYPES["csv"] if kind == "csv" else ALLOWED_TYPES["geojson"]
    # ok: iv-python-response-user-content-type
    return Response(body, media_type=media)
