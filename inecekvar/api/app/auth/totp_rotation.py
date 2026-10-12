import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.totp import encrypt_secret, encryption_key, key_id, stored_secret
from app.core.settings import Settings, load_settings
from app.models.accounts import User
from app.models.session import create_engine, create_session_factory, database_url_from_env

BATCH_SIZE = 100


async def reencrypt_totp_secrets(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings
) -> int:
    key = encryption_key(settings)
    prefix = b"\x02" + key_id(key)
    count = 0
    cursor: uuid.UUID | None = None
    while True:
        async with session_factory.begin() as db:
            query = select(User).where(User.totp_secret_enc.is_not(None))
            if cursor is not None:
                query = query.where(User.id > cursor)
            users = list(
                await db.scalars(
                    query.order_by(User.id)
                    .limit(BATCH_SIZE)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            if not users:
                return count
            for user in users:
                blob = user.totp_secret_enc
                if blob is not None and not blob.startswith(prefix):
                    secret = stored_secret(settings, user.id, blob)
                    user.totp_secret_enc = encrypt_secret(key, user.id, secret)
                    count += 1
            cursor = users[-1].id


async def main() -> None:
    settings = load_settings()
    engine = create_engine(database_url_from_env())
    try:
        count = await reencrypt_totp_secrets(create_session_factory(engine), settings)
        print(f"TOTP secrets updated: {count}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
