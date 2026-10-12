import asyncio
import os
import sys

from app.models.session import create_engine, create_session_factory, database_url_from_env
from app.seed.sample_city import seed_sample_city


async def main() -> None:
    if os.environ.get("INECEKVAR_ENV", "").lower() == "production":
        raise RuntimeError("Sample seed is disabled in production")
    engine = create_engine(database_url_from_env())
    try:
        factory = create_session_factory(engine)
        async with factory.begin() as session:
            summary = await seed_sample_city(session)
        print(f"Sample seed: created={summary.created} existing={summary.existing}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
