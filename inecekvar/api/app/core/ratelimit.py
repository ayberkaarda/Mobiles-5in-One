"""Atomic sliding windows with private Redis keys."""

import hashlib
import hmac
import secrets
from collections.abc import Mapping
from typing import cast

from redis.asyncio import Redis

from app.core.deps import Clock, RateLimitDecision
from app.core.settings import RateLimitRule

_SCRIPT = """
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return {0, 0, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, limit - count - 1, 0}
"""


class RedisSlidingWindowLimiter:
    def __init__(
        self,
        redis: Redis,
        rules: Mapping[str, RateLimitRule],
        key_secret: bytes,
        clock: Clock,
    ) -> None:
        self.redis = redis
        self.rules = dict(rules)
        self.key_secret = key_secret
        self.clock = clock
        self.script = redis.register_script(_SCRIPT)

    async def hit(self, rule: str, subject: str) -> RateLimitDecision:
        policy = self.rules[rule]
        digest = hmac.new(self.key_secret, subject.encode(), hashlib.sha256).hexdigest()
        now = int(self.clock.now().timestamp() * 1000)
        result = cast(
            list[int],
            await self.script(
                keys=[f"rl:{rule}:{digest}"],
                args=[
                    now,
                    policy.window_seconds * 1000,
                    policy.limit,
                    f"{now}:{secrets.token_hex(16)}",
                ],
            ),
        )
        return RateLimitDecision(bool(result[0]), int(result[1]), int(result[2]))
