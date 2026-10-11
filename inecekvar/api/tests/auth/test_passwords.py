from app.auth.passwords import hash_password
from app.core.settings import Settings


def test_argon2_production_parameters(settings: Settings) -> None:
    assert hash_password("a-secure-example-password", settings).startswith(
        "$argon2id$v=19$m=65536,t=3,p=1$"
    )
