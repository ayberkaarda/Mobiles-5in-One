# Fixture for iv-python-random-token (semgrep --test).
import random
import secrets
import string


def positives(alphabet: str) -> None:
    # ruleid: iv-python-random-token
    reset_token = "".join(random.choice(alphabet) for _ in range(32))
    # ruleid: iv-python-random-token
    otp = random.randint(100000, 999999)
    # ruleid: iv-python-random-token
    signing_key = random.randbytes(32)


def make_session_id() -> str:
    # ruleid: iv-python-random-token
    return str(random.getrandbits(128))


def negatives(items: list[int]) -> None:
    # ok: iv-python-random-token
    reset_token = secrets.token_urlsafe(32)
    # ok: iv-python-random-token
    otp = "".join(secrets.choice(string.digits) for _ in range(6))
    # ok: iv-python-random-token
    jitter = random.uniform(0.0, 0.5)
    # ok: iv-python-random-token
    picked = random.sample(items, 3)
