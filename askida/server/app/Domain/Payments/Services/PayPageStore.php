<?php

namespace App\Domain\Payments\Services;

use Illuminate\Contracts\Cache\Repository;

/**
 * Keeps the provider's checkout markup between `POST donations` (which opens the
 * checkout) and `GET /pay/<token>` (which shows it), for as long as an initiated
 * donation is payable. The key is a hash of the token, so the token itself is never a
 * cache key.
 */
final class PayPageStore
{
    public const PREFIX = 'pay-page:';

    public function __construct(
        private readonly Repository $cache,
    ) {}

    public function put(string $providerToken, string $html): void
    {
        $this->cache->put(self::key($providerToken), $html, self::ttlSeconds());
    }

    public function get(string $providerToken): ?string
    {
        $html = $this->cache->get(self::key($providerToken));

        return is_string($html) && $html !== '' ? $html : null;
    }

    public function forget(string $providerToken): void
    {
        $this->cache->forget(self::key($providerToken));
    }

    /**
     * Same window in which an initiated donation counts towards the day cap.
     */
    public static function ttlSeconds(): int
    {
        return max(1, (int) config('payments.caps.initiated_window_minutes', 30)) * 60;
    }

    private static function key(string $providerToken): string
    {
        return self::PREFIX.hash('sha256', $providerToken);
    }
}
