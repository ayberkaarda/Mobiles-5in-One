<?php

namespace App\Domain\Auth\Support;

use RuntimeException;

/**
 * HMAC-SHA256 keyed with a per-purpose key derived from the application key, so a
 * database dump alone is not enough to brute-force short values (IP addresses, codes).
 */
final class KeyedHash
{
    public static function make(string $purpose, string $value): string
    {
        return hash_hmac('sha256', $value, self::key($purpose));
    }

    private static function key(string $purpose): string
    {
        $appKey = config('app.key');

        if (! is_string($appKey) || $appKey === '') {
            throw new RuntimeException('The application key is not set.');
        }

        return hash_hmac('sha256', 'askida:'.$purpose, $appKey, true);
    }
}
