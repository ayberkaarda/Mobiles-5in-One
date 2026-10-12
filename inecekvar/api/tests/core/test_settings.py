import secrets

import pytest
from pydantic import SecretStr, ValidationError

from app.core.settings import Settings
from app.main import with_local_defaults
from tests.support.app import make_test_settings


def test_environment_must_be_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INECEKVAR_ENV", raising=False)
    with pytest.raises(ValidationError):
        Settings()


def test_production_requires_smtp_tls() -> None:
    with pytest.raises(ValidationError, match="smtp_use_tls"):
        make_test_settings(env="production", smtp_use_tls=False)
    assert make_test_settings(env="production", smtp_use_tls=True).smtp_use_tls


def test_production_requires_secrets() -> None:
    with pytest.raises(ValidationError, match="csrf_secret"):
        make_test_settings(env="production", smtp_use_tls=True, csrf_secret=None)


@pytest.mark.parametrize(
    "value", ["", "invalid", secrets.token_urlsafe(16), secrets.token_urlsafe(33), "+" * 43]
)
def test_totp_key_rejects_invalid_encoding_or_length(value: str) -> None:
    with pytest.raises(ValidationError, match="TOTP encryption key"):
        make_test_settings(totp_encryption_key=SecretStr(value))


@pytest.mark.parametrize("padded", [False, True])
def test_totp_key_decodes_with_optional_padding(padded: bool) -> None:
    raw = secrets.token_urlsafe(32)
    settings = make_test_settings(totp_encryption_key=SecretStr(raw + ("=" if padded else "")))
    assert len(settings.totp_key()) == 32


def test_production_requires_totp_key() -> None:
    with pytest.raises(ValidationError, match="totp_encryption_key"):
        make_test_settings(env="production", smtp_use_tls=True, totp_encryption_key=None)


def test_missing_totp_key_raises_runtime_error() -> None:
    settings = make_test_settings(totp_encryption_key=None)
    with pytest.raises(RuntimeError, match="TOTP encryption key"):
        settings.totp_key()


def test_local_totp_default_is_shared_within_the_process() -> None:
    first = with_local_defaults(Settings(env="local", totp_encryption_key=None))
    second = with_local_defaults(Settings(env="local", totp_encryption_key=None))
    assert len(first.totp_key()) == 32
    assert first.totp_key() == second.totp_key()
