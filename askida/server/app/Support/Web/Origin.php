<?php

namespace App\Support\Web;

/**
 * Absolute public URLs. Canonical links, hreflang alternates, Open Graph, JSON-LD and the
 * sitemap are built from config('web.origin') only, never from the request host, so a
 * page cached or rendered behind any proxy always names the public origin.
 */
final class Origin
{
    public static function base(): string
    {
        $origin = config('web.origin');

        return rtrim(is_string($origin) && $origin !== '' ? $origin : 'https://askida.app', '/');
    }

    /**
     * Absolute URL of a site path ("/" for the home page). Query strings are kept.
     */
    public static function url(string $path = '/'): string
    {
        if ($path === '' || $path === '/') {
            return self::base().'/';
        }

        return self::base().'/'.ltrim($path, '/');
    }

    /**
     * Whether a URL is absolute and on the configured origin.
     */
    public static function owns(string $url): bool
    {
        return $url === self::base() || str_starts_with($url, self::base().'/');
    }
}
