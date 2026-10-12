import pytest

from app.auth.step_up import SessionStepUpSource
from app.core.deps import Services
from app.core.settings import Settings
from tests.core.test_logging import log_stream
from tests.domain.conftest import (
    client,
    clock,
    contributor,
    migrated_url,
    moderator,
    sample,
    services,
    session_factory,
    user,
)
from tests.support.app import make_test_settings

__all__ = [
    "client",
    "clock",
    "contributor",
    "log_stream",
    "migrated_url",
    "moderator",
    "sample",
    "services",
    "session_factory",
    "user",
]


@pytest.fixture(autouse=True)
def session_step_up_source(services: Services) -> None:
    services.step_up = SessionStepUpSource()


@pytest.fixture
def settings() -> Settings:
    return make_test_settings()
