"""Problem details (RFC 9457) contract, spec section 6.13.

Every error response body has exactly the members `type`, `title`, `status`, `code` and
`request_id`, plus `detail` only when the raising code passes a fixed, non-sensitive text.
Tracebacks, exception messages, SQL and input echoes never reach a body. The exception
handlers that render these bodies live in `app.core.handlers` (package 1C).
"""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Final

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

PROBLEM_CONTENT_TYPE: Final = "application/problem+json"
PROBLEM_TYPE_BASE: Final = "https://api.inecekvar.app/problems/"

# Stable machine codes shared across packages; the clients map `code` to Turkish copy.
AUTH_REQUIRED: Final = "auth.required"
AUTH_INVALID_CREDENTIALS: Final = "auth.invalid_credentials"
AUTH_TOKEN_INVALID: Final = "auth.token_invalid"  # noqa: S105 (error code, not a secret)
AUTH_FORBIDDEN: Final = "auth.forbidden"
STEP_UP_REQUIRED: Final = "auth.step_up_required"
TOTP_ENROLMENT_REQUIRED: Final = "auth.totp_enrolment_required"
TOTP_INVALID_CODE: Final = "auth.totp_invalid_code"
REAUTH_REQUIRED: Final = "auth.reauth_required"
TOTP_ALREADY_ENABLED: Final = "auth.totp_already_enabled"
TOTP_NOT_PENDING: Final = "auth.totp_not_pending"
TOTP_UNAVAILABLE: Final = "auth.totp_unavailable"
CSRF_INVALID: Final = "csrf.invalid"
ORIGIN_NOT_ALLOWED: Final = "origin.not_allowed"
HTTPS_REQUIRED: Final = "transport.https_required"
RATE_LIMITED: Final = "rate_limited"
VALIDATION_FAILED: Final = "validation.failed"
BODY_TOO_LARGE: Final = "request.body_too_large"
UNSUPPORTED_MEDIA_TYPE: Final = "request.unsupported_media_type"
LENGTH_REQUIRED: Final = "request.length_required"
NOT_FOUND: Final = "not_found"
METHOD_NOT_ALLOWED: Final = "method_not_allowed"
CONFLICT: Final = "conflict"
INTERNAL: Final = "internal"


class ProblemBody(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: str
    title: str
    status: int
    code: str
    request_id: str
    detail: str | None = None


class ProblemError(Exception):
    """Raise anywhere in a request to answer with a problem body.

    `code` is a stable dotted identifier, `detail` a fixed sentence that is safe to show
    (never user input, identifiers or exception text) and `headers` extra response headers
    such as `Retry-After`.
    """

    def __init__(
        self,
        code: str,
        status: int,
        detail: str | None = None,
        *,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        if not 400 <= status <= 599:
            raise ValueError("a problem status must be 4xx or 5xx")
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail
        self.headers: dict[str, str] = dict(headers or {})


def problem_title(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def problem_body(
    code: str,
    status: int,
    request_id: str,
    detail: str | None = None,
) -> dict[str, object]:
    """The JSON object for a problem response; `detail` is omitted when it is None."""
    body = ProblemBody(
        type=PROBLEM_TYPE_BASE + code,
        title=problem_title(status),
        status=status,
        code=code,
        request_id=request_id,
        detail=detail,
    )
    return body.model_dump(exclude_none=True)


def request_id_of(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) and value else "unknown"


async def problem_response(request: Request, exc: Exception) -> JSONResponse:
    """Exception handler for `ProblemError`, registered by `create_app`."""
    if not isinstance(exc, ProblemError):
        raise TypeError("problem_response handles ProblemError only")
    return JSONResponse(
        problem_body(exc.code, exc.status, request_id_of(request), exc.detail),
        status_code=exc.status,
        headers=exc.headers,
        media_type=PROBLEM_CONTENT_TYPE,
    )
