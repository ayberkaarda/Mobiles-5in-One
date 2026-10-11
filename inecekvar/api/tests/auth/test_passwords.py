import pytest

from app.auth.passwords import dummy_hash, hash_password, verify_password
from app.core.settings import Settings
from tests.support.app import make_test_settings

pytestmark = pytest.mark.anyio


async def test_argon2_production_parameters(settings: Settings) -> None:
    assert (await hash_password("a-secure-example-password", settings)).startswith(
        "$argon2id$v=19$m=65536,t=3,p=1$"
    )


async def test_dummy_hash_uses_configured_cost() -> None:
    cheap = make_test_settings(argon2_time_cost=1, argon2_memory_cost_kib=8192)
    assert (await dummy_hash(cheap)).startswith("$argon2id$v=19$m=8192,t=1,p=1$")
    assert await verify_password("anything", await dummy_hash(cheap), cheap) == (False, False)
