"""Provider authentication for the webhook routes (spec section 6.17, ADR-0050).

RevenueCat sends the configured value verbatim in `Authorization`; it is compared in constant
time with `hmac.compare_digest`. Resend signs with Svix: `v1` signatures are base64 HMAC-SHA256
over `svix-id + "." + svix-timestamp + "." + raw body` under the decoded `whsec_` key, the
header may carry several space-separated signatures (key rotation), and the timestamp must lie
within five minutes of the server clock either way. Implemented from the published scheme; the
Svix library is not a dependency.
"""

import base64
import hashlib
import hmac
from datetime import datetime

from pydantic import SecretStr

from app.core.errors import ProblemError

SVIX_TOLERANCE_SECONDS = 5 * 60
MAX_SVIX_ID_LENGTH = 255

WEBHOOK_UNAUTHORIZED = "webhook.unauthorized"
WEBHOOK_SIGNATURE_INVALID = "webhook.signature_invalid"
WEBHOOK_TIMESTAMP_INVALID = "webhook.timestamp_invalid"


def verify_shared_secret(supplied: str | None, secret: SecretStr) -> None:
    if supplied is None or not hmac.compare_digest(
        supplied.encode(), secret.get_secret_value().encode()
    ):
        raise ProblemError(WEBHOOK_UNAUTHORIZED, 401)


def svix_signature(key: bytes, message_id: str, timestamp: str, body: bytes) -> str:
    signed = message_id.encode() + b"." + timestamp.encode() + b"." + body
    return base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()


def verify_svix(
    key: bytes,
    message_id: str | None,
    timestamp: str | None,
    signatures: str | None,
    body: bytes,
    now: datetime,
) -> str:
    """Returns the verified `svix-id`; raises a 401 problem otherwise."""
    if not message_id or not timestamp or not signatures:
        raise ProblemError(WEBHOOK_SIGNATURE_INVALID, 401)
    if len(message_id) > MAX_SVIX_ID_LENGTH or not message_id.isascii():
        raise ProblemError(WEBHOOK_SIGNATURE_INVALID, 401)
    if not (timestamp.isascii() and timestamp.isdigit() and len(timestamp) <= 12):
        raise ProblemError(WEBHOOK_TIMESTAMP_INVALID, 401)
    if abs(now.timestamp() - int(timestamp)) > SVIX_TOLERANCE_SECONDS:
        raise ProblemError(WEBHOOK_TIMESTAMP_INVALID, 401)
    expected = svix_signature(key, message_id, timestamp, body).encode()
    for candidate in signatures.split(" "):
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value.encode(), expected):
            return message_id
    raise ProblemError(WEBHOOK_SIGNATURE_INVALID, 401)
