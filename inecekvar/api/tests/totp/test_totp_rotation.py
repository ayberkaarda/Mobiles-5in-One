import base64
import uuid

import httpx
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr

from app.auth.totp import decrypt_secret, encrypt_secret, key_id, stored_secret
from app.auth.totp_rotation import reencrypt_totp_secrets
from app.core.deps import Services
from app.core.errors import ProblemError
from app.models import User
from tests.support.app import FixedClock, make_test_settings
from tests.totp.test_totp_step_up import enrolled_account, verify

pytestmark = [pytest.mark.anyio, pytest.mark.postgis]
KEY_A = b"a" * 32
KEY_B = b"b" * 32
SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


def encoded(key: bytes) -> SecretStr:
    return SecretStr(base64.urlsafe_b64encode(key).decode())


async def test_previous_key_still_decrypts_after_rotation(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(update={"totp_encryption_key": encoded(KEY_A)})
    account = await enrolled_account(client, services, clock)
    services.settings = services.settings.model_copy(
        update={
            "totp_encryption_key": encoded(KEY_B),
            "totp_previous_encryption_key": encoded(KEY_A),
        }
    )
    response = await verify(client, account.headers, account.secret, clock)
    assert response.status_code == 200
    async with services.session_factory() as db:
        user = await db.get(User, account.identity)
        assert user is not None
        assert user.totp_secret_enc is not None
        assert stored_secret(services.settings, user.id, user.totp_secret_enc) == account.secret


async def test_rotation_without_previous_key_fails_closed() -> None:
    identity = uuid.uuid4()
    blob = encrypt_secret(KEY_A, identity, SECRET)
    settings = make_test_settings(totp_encryption_key=encoded(KEY_B))
    with pytest.raises(ProblemError) as caught:
        stored_secret(settings, identity, blob)
    assert caught.value.status == 503
    assert caught.value.code == "auth.totp_unavailable"


async def test_reencrypt_moves_secrets_to_current_key(
    client: httpx.AsyncClient, services: Services, clock: FixedClock
) -> None:
    services.settings = services.settings.model_copy(update={"totp_encryption_key": encoded(KEY_A)})
    account = await enrolled_account(client, services, clock)
    async with services.session_factory() as db:
        user = await db.get(User, account.identity)
        assert user is not None
        enabled_at, counter = user.totp_enabled_at, user.totp_last_counter
    settings = services.settings.model_copy(
        update={
            "totp_encryption_key": encoded(KEY_B),
            "totp_previous_encryption_key": encoded(KEY_A),
        }
    )
    assert await reencrypt_totp_secrets(services.session_factory, settings) == 1
    current_only = settings.model_copy(update={"totp_previous_encryption_key": None})
    async with services.session_factory() as db:
        user = await db.get(User, account.identity)
        assert user is not None
        assert user.totp_secret_enc is not None
        assert user.totp_secret_enc[:9] == b"\x02" + key_id(KEY_B)
        assert stored_secret(current_only, user.id, user.totp_secret_enc) == account.secret
        assert (user.totp_enabled_at, user.totp_last_counter) == (enabled_at, counter)
    assert await reencrypt_totp_secrets(services.session_factory, settings) == 0


async def test_legacy_v1_blob_decrypts() -> None:
    identity = uuid.uuid4()
    nonce = b"n" * 12
    ciphertext = AESGCM(KEY_A).encrypt(
        nonce, SECRET.encode("ascii"), b"inecekvar:totp:v1:" + identity.bytes
    )
    blob = b"\x01" + nonce + ciphertext
    assert decrypt_secret(KEY_A, identity, blob) == SECRET
    settings = make_test_settings(
        totp_encryption_key=encoded(KEY_B), totp_previous_encryption_key=encoded(KEY_A)
    )
    assert stored_secret(settings, identity, blob) == SECRET
