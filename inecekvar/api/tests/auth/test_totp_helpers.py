import secrets
import uuid
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from cryptography.exceptions import InvalidTag

from app.auth.totp import (
    STEP_INTERVAL,
    VALID_WINDOW,
    decrypt_secret,
    encrypt_secret,
    matching_counter,
    new_secret,
)

NOW = datetime(2026, 10, 12, 9, tzinfo=UTC)


def test_secret_encryption_is_randomized_authenticated_and_versioned() -> None:
    key = secrets.token_bytes(32)
    identity = uuid.uuid4()
    secret = new_secret()
    first = encrypt_secret(key, identity, secret)
    second = encrypt_secret(key, identity, secret)
    assert len(secret) == 32
    assert first[:1] == b"\x01"
    assert first != second
    assert secret.encode() not in first
    assert decrypt_secret(key, identity, first) == secret
    with pytest.raises(InvalidTag):
        decrypt_secret(key, uuid.uuid4(), first)
    with pytest.raises(InvalidTag):
        decrypt_secret(secrets.token_bytes(32), identity, first)
    with pytest.raises(InvalidTag):
        decrypt_secret(key, identity, first[:-1] + bytes([first[-1] ^ 1]))
    with pytest.raises(ValueError, match="format"):
        decrypt_secret(key, identity, b"\x02" + first[1:])
    with pytest.raises(ValueError, match="format"):
        decrypt_secret(key, identity, b"\x01")


@pytest.mark.parametrize("offset", [-2, -1, 0, 1, 2])
def test_counter_window_and_replay(offset: int) -> None:
    secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    code = pyotp.TOTP(secret).at(NOW + timedelta(seconds=offset * STEP_INTERVAL))
    counter = int(NOW.timestamp()) // STEP_INTERVAL + offset
    if abs(offset) <= VALID_WINDOW:
        assert matching_counter(secret, code, NOW, None) == counter
        assert matching_counter(secret, code, NOW, counter - 1) == counter
        assert matching_counter(secret, code, NOW, counter) is None
        assert matching_counter(secret, code, NOW, counter + 1) is None
    else:
        assert matching_counter(secret, code, NOW, None) is None


@pytest.mark.parametrize(
    "code", ["", "12345", "1234567", "\uff11\uff12\uff13\uff14\uff15\uff16", "12345a", "123456\n"]
)
def test_counter_requires_exactly_six_ascii_digits(code: str) -> None:
    assert matching_counter(new_secret(), code, NOW, None) is None
