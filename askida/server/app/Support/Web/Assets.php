<?php

namespace App\Support\Web;

use RuntimeException;

/**
 * Versioned URLs of the public web's static files: `/css/site.css?v=<sha1 of the file>`.
 * nginx serves these with a one-year immutable cache, so the version changes whenever the
 * file does. Hashes are kept for the life of the process.
 */
final class Assets
{
    public const STYLESHEET = 'css/site.css';

    public const TEXT_FONT = 'fonts/text-var.woff2';

    /** @var array<string, string> */
    private static array $hashes = [];

    /**
     * @param  string  $path  path under public/, e.g. "css/site.css"
     */
    public static function url(string $path): string
    {
        $path = ltrim($path, '/');

        return '/'.$path.'?v='.self::hash($path);
    }

    public static function hash(string $path): string
    {
        $path = ltrim($path, '/');

        if (! isset(self::$hashes[$path])) {
            $file = public_path($path);
            $hash = is_file($file) ? sha1_file($file) : false;

            if ($hash === false) {
                throw new RuntimeException('Missing public asset: '.$path);
            }

            self::$hashes[$path] = $hash;
        }

        return self::$hashes[$path];
    }

    public static function flush(): void
    {
        self::$hashes = [];
    }
}
