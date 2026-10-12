import pytest
from pydantic import ValidationError

from app.core.settings import Settings
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
