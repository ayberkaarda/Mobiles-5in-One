<?php

namespace App\Domain\Cost;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

/**
 * Daily send budget per channel (security item 22). Sends are counted in Redis day keys
 * (`cost:sent:{channel}:{day}`, INCR, 2 day TTL); the day follows askida.cost.timezone.
 *
 * Critical kinds are always allowed. A non-critical kind is allowed until the channel's
 * cap is reached or the guard job has paused the channel for the day. Counters carry no
 * recipient, address or message content.
 */
final class SendBudget
{
    public const TTL_SECONDS = 172800;

    public function allows(SendKind $kind): bool
    {
        if ($kind->isCritical()) {
            return true;
        }

        $channel = $kind->channel();

        if ($this->isPaused($channel)) {
            return false;
        }

        return $this->sent($channel) < $channel->cap();
    }

    /** Counts one delivery and returns today's total for the channel. */
    public function record(SendKind $kind): int
    {
        $key = $this->sentKey($kind->channel());
        $connection = Redis::connection();
        $total = (int) $connection->incr($key);

        if ($total === 1) {
            $connection->expire($key, self::TTL_SECONDS);
        }

        return $total;
    }

    public function sent(Channel $channel): int
    {
        return (int) Redis::connection()->get($this->sentKey($channel));
    }

    public function isPaused(Channel $channel): bool
    {
        return (bool) Redis::connection()->exists($this->pausedKey($channel));
    }

    public function pause(Channel $channel): void
    {
        Redis::connection()->setex($this->pausedKey($channel), self::TTL_SECONDS, '1');
    }

    /** True only for the first caller of the day and channel: one alert mail each. */
    public function claimAlert(Channel $channel): bool
    {
        return Cache::store('redis')->add($this->alertKey($channel), '1', self::TTL_SECONDS);
    }

    public function releaseAlert(Channel $channel): void
    {
        Cache::store('redis')->forget($this->alertKey($channel));
    }

    public function day(): string
    {
        return CarbonImmutable::now((string) config('askida.cost.timezone', 'Europe/Istanbul'))->format('Y-m-d');
    }

    private function sentKey(Channel $channel): string
    {
        return 'cost:sent:'.$channel->value.':'.$this->day();
    }

    private function pausedKey(Channel $channel): string
    {
        return 'cost:paused:'.$channel->value.':'.$this->day();
    }

    private function alertKey(Channel $channel): string
    {
        return 'cost:alerted:'.$channel->value.':'.$this->day();
    }
}
