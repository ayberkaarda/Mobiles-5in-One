import hmac
import unicodedata
from functools import cache, partial

import anyio
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

from app.core.deps import BreachChecker
from app.core.errors import ProblemError
from app.core.settings import Settings

# Argon2 runs in worker threads so it never blocks the event loop; at most this many hashes
# run at once per process, which also bounds the memory used by concurrent requests.
HASH_CONCURRENCY = 4
_hash_slots: anyio.CapacityLimiter | None = None


def _slots() -> anyio.CapacityLimiter:
    global _hash_slots
    if _hash_slots is None:
        _hash_slots = anyio.CapacityLimiter(HASH_CONCURRENCY)
    return _hash_slots


def password_hasher(settings: Settings) -> PasswordHasher:
    return _hasher(
        settings.argon2_time_cost, settings.argon2_memory_cost_kib, settings.argon2_parallelism
    )


@cache
def _hasher(time_cost: int, memory_cost: int, parallelism: int) -> PasswordHasher:
    return PasswordHasher(
        time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism, type=Type.ID
    )


@cache
def _dummy_hash(time_cost: int, memory_cost: int, parallelism: int) -> str:
    return _hasher(time_cost, memory_cost, parallelism).hash("unavailable-account-verification")


async def dummy_hash(settings: Settings) -> str:
    """A hash with the configured cost, verified when no real hash exists (equal timing).

    Built once per parameter set in a worker thread, never on the event loop."""
    return await anyio.to_thread.run_sync(
        partial(
            _dummy_hash,
            settings.argon2_time_cost,
            settings.argon2_memory_cost_kib,
            settings.argon2_parallelism,
        ),
        limiter=_slots(),
    )


def _hash_sync(password: str, settings: Settings) -> str:
    return password_hasher(settings).hash(unicodedata.normalize("NFC", password))


def _verify_sync(password: str, password_hash: str, settings: Settings) -> tuple[bool, bool]:
    hasher = password_hasher(settings)
    try:
        hasher.verify(password_hash, unicodedata.normalize("NFC", password))
    except (VerificationError, InvalidHashError):
        return False, False
    return True, hasher.check_needs_rehash(password_hash)


async def hash_password(password: str, settings: Settings) -> str:
    return await anyio.to_thread.run_sync(partial(_hash_sync, password, settings), limiter=_slots())


async def verify_password(
    password: str, password_hash: str, settings: Settings
) -> tuple[bool, bool]:
    """Returns (matches, needs_rehash)."""
    return await anyio.to_thread.run_sync(
        partial(_verify_sync, password, password_hash, settings), limiter=_slots()
    )


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
