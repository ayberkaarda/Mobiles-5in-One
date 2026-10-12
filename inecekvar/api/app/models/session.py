import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def database_url_from_env() -> str:
    url = os.environ.get("INECEKVAR_DATABASE_URL", "")
    if not url.startswith("postgresql+asyncpg://"):
        raise RuntimeError("INECEKVAR_DATABASE_URL must start with postgresql+asyncpg://")
    return url


def create_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True, hide_parameters=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
