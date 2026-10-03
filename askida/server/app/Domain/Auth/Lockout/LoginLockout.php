<?php

namespace App\Domain\Auth\Lockout;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * Progressive login lockout per email and IP pair, kept in the cache.
 *
 * Failed logins are counted for auth.lockout.minutes; when the count reaches
 * auth.lockout.attempts, the pair is locked for auth.lockout.minutes from that
 * moment. A successful login clears the counter.
 */
class LoginLockout
{
    public function secondsRemaining(string $email, string $ip): int
    {
        $until = Cache::get($this->lockKey($email, $ip));

        // Numeric values come back as strings from the Redis store.
        if (! is_numeric($until)) {
            return 0;
        }

        return max(0, (int) $until - Carbon::now()->getTimestamp());
    }

    public function recordFailure(string $email, string $ip): void
    {
        $counterKey = $this->counterKey($email, $ip);
        $window = $this->minutes() * 60;

        Cache::add($counterKey, 0, $window);
        $failures = (int) Cache::increment($counterKey);

        if ($failures >= $this->attempts()) {
            Cache::put($this->lockKey($email, $ip), Carbon::now()->getTimestamp() + $window, $window);
            Cache::forget($counterKey);
        }
    }

    public function clear(string $email, string $ip): void
    {
        Cache::forget($this->counterKey($email, $ip));
        Cache::forget($this->lockKey($email, $ip));
    }

    private function counterKey(string $email, string $ip): string
    {
        return 'auth:login-failures:'.$this->pair($email, $ip);
    }

    private function lockKey(string $email, string $ip): string
    {
        return 'auth:login-locked:'.$this->pair($email, $ip);
    }

    private function pair(string $email, string $ip): string
    {
        return hash('sha256', $email.'|'.$ip);
    }

    private function attempts(): int
    {
        return max(1, (int) config('auth.lockout.attempts', 10));
    }

    private function minutes(): int
    {
        return max(1, (int) config('auth.lockout.minutes', 15));
    }
}
