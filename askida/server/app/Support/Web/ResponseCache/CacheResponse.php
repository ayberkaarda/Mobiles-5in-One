<?php

namespace App\Support\Web\ResponseCache;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Route middleware `cacheResponse:<seconds>` for the public pages. Serves a stored body for
 * anonymous GET and HEAD requests without a query string and stores successful (200)
 * responses that set no cookie of their own and are not marked `no-store` by the action.
 * Registered by App\Providers\WebServiceProvider.
 */
final class CacheResponse
{
    public const ALIAS = 'cacheResponse';

    public function __construct(private readonly PageCache $pages) {}

    public function handle(Request $request, Closure $next, ?string $seconds = null): Response
    {
        if (! $this->cacheable($request)) {
            /** @var Response $response */
            $response = $next($request);

            return $response;
        }

        $key = $this->pages->keyFor($request);
        $entry = $this->pages->get($key);

        if ($entry !== null) {
            return $this->mark(new Response($entry['content'], $entry['status'], $entry['headers']), 'hit');
        }

        /** @var Response $response */
        $response = $next($request);

        if ($request->isMethod('GET') && $this->storable($response)) {
            $this->pages->put($key, [
                'content' => (string) $response->getContent(),
                'status' => $response->getStatusCode(),
                'headers' => $this->keptHeaders($response),
            ], $this->lifetime($seconds));
        }

        return $this->mark($response, 'miss');
    }

    private function cacheable(Request $request): bool
    {
        return $this->pages->enabled()
            && ($request->isMethod('GET') || $request->isMethod('HEAD'))
            && $request->getQueryString() === null
            && $request->user() === null;
    }

    /**
     * An action opts a response out with `Cache-Control: no-store`.
     */
    private function storable(Response $response): bool
    {
        return $response->getStatusCode() === 200
            && ! $response instanceof StreamedResponse
            && ! $response instanceof BinaryFileResponse
            && $response->headers->getCookies() === []
            && ! $response->headers->hasCacheControlDirective('no-store')
            && $response->getContent() !== false;
    }

    /**
     * @return array<string, string>
     */
    private function keptHeaders(Response $response): array
    {
        $headers = [];

        foreach (PageCache::KEPT_HEADERS as $name) {
            $value = $response->headers->get($name);

            if (is_string($value) && $value !== '') {
                $headers[$name] = $value;
            }
        }

        return $headers;
    }

    private function lifetime(?string $seconds): int
    {
        if ($seconds !== null && ctype_digit($seconds) && (int) $seconds > 0) {
            return (int) $seconds;
        }

        $default = config('responsecache.default_seconds', 300);

        return is_numeric($default) ? max(1, (int) $default) : 300;
    }

    private function mark(Response $response, string $outcome): Response
    {
        $header = config('responsecache.header', 'X-Page-Cache');

        if (is_string($header) && $header !== '') {
            $response->headers->set($header, $outcome);
        }

        return $response;
    }
}
