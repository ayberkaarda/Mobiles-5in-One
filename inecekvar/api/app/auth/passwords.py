import hmac
import unicodedata

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

from app.core.deps import BreachChecker
from app.core.errors import ProblemError
from app.core.settings import Settings

DUMMY_HASH = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1).hash(
    "unavailable-account-verification"
)


def password_hasher(settings: Settings) -> PasswordHasher:
    return PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_cost_kib,
        parallelism=settings.argon2_parallelism,
        type=Type.ID,
    )


def hash_password(password: str, settings: Settings) -> str:
    return password_hasher(settings).hash(unicodedata.normalize("NFC", password))


def verify_password(password: str, password_hash: str, settings: Settings) -> tuple[bool, bool]:
    hasher = password_hasher(settings)
    try:
        hasher.verify(password_hash, unicodedata.normalize("NFC", password))
    except (VerificationError, InvalidHashError):
        return False, False
    return True, hasher.check_needs_rehash(password_hash)


async def check_password_policy(
    password: str, email: str, breach_checker: BreachChecker, settings: Settings
) -> None:
    normalized = unicodedata.normalize("NFC", password)
    folded = normalized.casefold().encode()
    address = email.casefold()
    if (
        len(normalized) < settings.password_min_length
        or len(normalized) > settings.password_max_length
        or hmac.compare_digest(folded, address.encode())
        or hmac.compare_digest(folded, address.partition("@")[0].encode())
        or await breach_checker.is_breached(normalized)
    ):
        raise ProblemError("auth.weak_password", 422)
