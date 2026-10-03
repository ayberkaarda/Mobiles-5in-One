<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Auth\Factory as AuthFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security checklist item 14: one access line per request with the method, the route
 * pattern (never the URL, so no query string and no path values), the status, the
 * duration, the request id and the user id when a guard already resolved one.
 *
 * Request and response bodies and headers are never logged, on any path. This matters
 * most for api/v1/auth/*, pay/* and api/v1/webhooks/*, which carry credentials, payment
 * data and provider signatures.
 */
class LogRequest
{
    public function __construct(private readonly AuthFactory $auth) {}

    public function handle(Request $request, Closure $next): Response
    {
        $started = hrtime(true);

        /** @var Response $response */
        $response = $next($request);

        $route = $request->route();

        Log::info('http.request', [
            'method' => $request->getMethod(),
            'route' => is_object($route) ? $route->uri() : 'unmatched',
            'status' => $response->getStatusCode(),
            'duration_ms' => (int) round((hrtime(true) - $started) / 1_000_000),
            'request_id' => $request->attributes->get(RequestId::ATTRIBUTE),
            'user_id' => $this->userId(),
        ]);

        return $response;
    }

    /**
     * Only guards that already authenticated someone during this request are asked, so
     * logging never triggers an extra token or session lookup.
     */
    private function userId(): int|string|null
    {
        foreach (array_keys((array) config('auth.guards')) as $name) {
            try {
                $guard = $this->auth->guard((string) $name);
            } catch (InvalidArgumentException) {
                continue;
            }

            if ($guard->hasUser()) {
                $id = $guard->id();

                return is_int($id) || is_string($id) ? $id : null;
            }
        }

        return null;
    }
}
