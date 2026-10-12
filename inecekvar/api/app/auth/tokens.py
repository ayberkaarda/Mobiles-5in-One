import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

import jwt

from app.core.errors import AUTH_REQUIRED, ProblemError
from app.core.ids import uuid7
from app.core.settings import Settings


def opaque_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def access_token(
    settings: Settings, user_id: uuid.UUID, family_id: uuid.UUID, now: datetime
) -> str:
    issued = int(now.timestamp())
    return jwt.encode(
        {
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "sub": str(user_id),
            "sid": str(family_id),
            "iat": issued,
            "nbf": issued,
            "exp": issued + settings.access_token_ttl_seconds,
            "jti": str(uuid7()),
            "typ": "access",
        },
        settings.jwt_private_key(),
        algorithm="ES256",
    )


@dataclass(frozen=True, slots=True)
class AccessIdentity:
    user_id: uuid.UUID
    family_id: uuid.UUID


def decode_access_token(token: str, settings: Settings, now: datetime) -> AccessIdentity:
    try:
        claims: dict[str, object] = jwt.decode(
            token,
            settings.jwt_public_key(),
            algorithms=["ES256"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            leeway=0,
            options={
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "require": ["exp", "iat", "nbf", "iss", "aud", "sub", "sid", "jti", "typ"],
            },
        )
        instant = now.timestamp()
        for name in ("exp", "iat", "nbf"):
            value = claims[name]
            if type(value) is not int:
                raise ValueError("invalid claim")
        expiry, issued, start = claims["exp"], claims["iat"], claims["nbf"]
        if not isinstance(expiry, int) or not isinstance(issued, int) or not isinstance(start, int):
            raise ValueError("invalid claim")
        if expiry <= instant or start > instant or issued > instant or claims["typ"] != "access":
            raise ValueError("invalid claim")
        identifiers: list[uuid.UUID] = []
        for name in ("sub", "sid", "jti"):
            value = claims[name]
            if not isinstance(value, str):
                raise ValueError("invalid claim")
            identifiers.append(uuid.UUID(value))
        return AccessIdentity(identifiers[0], identifiers[1])
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, OverflowError):
        raise ProblemError(AUTH_REQUIRED, 401) from None
