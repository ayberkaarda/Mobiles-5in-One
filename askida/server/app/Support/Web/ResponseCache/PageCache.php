<?php

namespace App\Support\Web\ResponseCache;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Storage of cached public pages (config/responsecache.php). A page is keyed by its path
 * only: requests with a query string are never cached (see CacheResponse), so random query
 * strings cannot fill the store. The host is not part of the key because every absolute URL
 * in a page comes from config('web.origin').
 *
 * @phpstan-type Entry array{content: string, status: int, headers: array<string, string>}
 */
final class PageCache
{
    /**
     * Content headers kept with a cached body; everything else (security headers, the CSP
     * nonce, cookies) is produced afresh on each request.
     */
    public const KEPT_HEADERS = ['Content-Type', 'Content-Language', 'Last-Modified', 'X-Robots-Tag', 'Link'];

    public function enabled(): bool
    {
        return (bool) config('responsecache.enabled', true);
    }

    public function keyFor(Request $request): string
    {
        return $this->key($request->getPathInfo());
    }

    public function key(string $path): string
    {
        $prefix = config('responsecache.prefix', 'web-page:v1:');

        return (is_string($prefix) ? $prefix : 'web-page:v1:').sha1('/'.trim($path, '/'));
    }

    /**
     * @return Entry|null
     */
    public function get(string $key): ?array
    {
        $entry = $this->store()->get($key);

        if (! is_array($entry) || ! is_string($entry['content'] ?? null) || ! is_int($entry['status'] ?? null) || ! is_array($entry['headers'] ?? null)) {
            return null;
        }

        /** @var array<string, string> $headers */
        $headers = array_filter($entry['headers'], is_string(...));

        return ['content' => $entry['content'], 'status' => $entry['status'], 'headers' => $headers];
    }

    /**
     * @param  Entry  $entry
     */
    public function put(string $key, array $entry, int $seconds): void
    {
        $this->store()->put($key, $entry, $seconds);
    }

    /**
     * Drops the cached pages of the given paths, e.g. a shop page right after the shop is
     * unlisted.
     */
    public function forget(string ...$paths): void
    {
        foreach ($paths as $path) {
            $this->store()->forget($this->key($path));
        }
    }

    private function store(): Repository
    {
        $store = config('responsecache.store', 'redis');

        return Cache::store(is_string($store) ? $store : null);
    }
}
