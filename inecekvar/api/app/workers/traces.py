import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import Clock
from app.models import Trace


async def purge_expired_traces(
    session_factory: async_sessionmaker[AsyncSession],
    clock: Clock,
) -> int:
    count = 0
    now = clock.now()
    async with session_factory() as db:
        while True:
            identities = list(
                await db.scalars(
                    select(Trace.id)
                    .where(Trace.delete_after <= now)
                    .order_by(Trace.id)
                    .limit(500)
                    .with_for_update(skip_locked=True)
                )
            )
            if not identities:
                break
            removed = await db.scalars(
                delete(Trace).where(Trace.id.in_(identities)).returning(Trace.id)
            )
            count += len(list(removed))
            await db.commit()
    structlog.get_logger().info("trace_purge", count=count)
    return count
