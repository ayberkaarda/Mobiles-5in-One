"""Enqueue background jobs on the arq Redis queue (spec section 4, ADR-0028, ADR-0050).

The webhook routes store every verified event in PostgreSQL before they enqueue, so the queue is
only a trigger: a lost enqueue is picked up by the pending-event sweep of the worker. The pool
connects on first use without retries, so a missing Redis fails fast instead of delaying the
provider's response.
"""

import asyncio

from arq.connections import ArqRedis, RedisSettings, create_pool


class ArqJobQueue:
    def __init__(self, redis_url: str) -> None:
        settings = RedisSettings.from_dsn(redis_url)
        settings.conn_retries = 0
        settings.conn_timeout = 1
        self._settings = settings
        self._pool: ArqRedis | None = None
        self._lock = asyncio.Lock()

    async def _connection(self) -> ArqRedis:
        async with self._lock:
            if self._pool is None:
                self._pool = await create_pool(self._settings)
            return self._pool

    async def enqueue(self, function: str, *args: str, job_id: str) -> None:
        pool = await self._connection()
        await pool.enqueue_job(function, *args, _job_id=job_id)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.aclose()
            self._pool = None
