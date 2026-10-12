import hashlib
import hmac
import secrets
import uuid
from datetime import datetime

import pyotp
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.errors import TOTP_UNAVAILABLE, ProblemError
from app.core.settings import Settings

STEP_INTERVAL = 30
VALID_WINDOW = 1
_AAD_PREFIX = b"inecekvar:totp:v1:"
_AAD_V2_PREFIX = b"inecekvar:totp:v2:"


def key_id(key: bytes) -> bytes:
    return hashlib.sha256(b"inecekvar:totp-key-id:" + key).digest()[:8]


def new_secret() -> str:
    return pyotp.random_base32(length=32)


def encrypt_secret(key: bytes, user_id: uuid.UUID, secret: str) -> bytes:
    if len(key) != 32:
        raise ValueError("TOTP encryption key must be 32 bytes")
    nonce = secrets.token_bytes(12)
    identity = key_id(key)
    aad = _AAD_V2_PREFIX + identity + user_id.bytes
    ciphertext = AESGCM(key).encrypt(nonce, secret.encode("ascii"), aad)
    return b"\x02" + identity + nonce + ciphertext


def decrypt_secret(
    key: bytes, user_id: uuid.UUID, blob: bytes, previous_key: bytes | None = None
) -> str:
    keys = (key,) if previous_key is None else (key, previous_key)
    if any(len(candidate) != 32 for candidate in keys):
        raise ValueError("TOTP encryption key must be 32 bytes")
    if blob[:1] == b"\x02" and len(blob) >= 37:
        identity = blob[1:9]
        for candidate in keys:
            if hmac.compare_digest(key_id(candidate), identity):
                aad = _AAD_V2_PREFIX + identity + user_id.bytes
                return AESGCM(candidate).decrypt(blob[9:21], blob[21:], aad).decode("ascii")
        raise ValueError("unknown TOTP key")
    if blob[:1] == b"\x01" and len(blob) >= 29:
        for candidate in keys:
            try:
                return (
                    AESGCM(candidate)
                    .decrypt(blob[1:13], blob[13:], _AAD_PREFIX + user_id.bytes)
                    .decode("ascii")
                )
            except InvalidTag:
                continue
        raise InvalidTag
    raise ValueError("invalid TOTP secret format")


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret, interval=STEP_INTERVAL).provisioning_uri(
        name=email, issuer_name="İnecek Var"
    )


def matching_counter(secret: str, code: str, now: datetime, last_counter: int | None) -> int | None:
    if len(code) != 6 or any(character not in "0123456789" for character in code):
        return None
    current = int(now.timestamp()) // STEP_INTERVAL
    totp = pyotp.TOTP(secret, interval=STEP_INTERVAL)
    for delta in range(-VALID_WINDOW, VALID_WINDOW + 1):
        counter = current + delta
        if counter >= 0 and hmac.compare_digest(totp.generate_otp(counter), code):
            return counter if last_counter is None or counter > last_counter else None
    return None


def encryption_key(settings: Settings) -> bytes:
    try:
        return settings.totp_key()
    except RuntimeError:
        raise ProblemError(TOTP_UNAVAILABLE, 503) from None


def stored_secret(settings: Settings, user_id: uuid.UUID, blob: bytes) -> str:
    key = encryption_key(settings)
    try:
        return decrypt_secret(key, user_id, blob, settings.totp_previous_key())
    except (InvalidTag, ValueError):
        raise ProblemError(TOTP_UNAVAILABLE, 503) from None
