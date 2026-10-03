<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gives every request an id: a well-formed inbound X-Request-Id is kept (so a proxy can
 * correlate), anything else is replaced by a fresh UUIDv7. The id is stored on the request
 * attributes (read by ProblemException and the log context) and echoed in the response.
 */
class RequestId
{
    public const HEADER = 'X-Request-Id';

    public const ATTRIBUTE = 'request_id';

    private const PATTERN = '/^[A-Za-z0-9._-]{8,64}$/';

    public function handle(Request $request, Closure $next): Response
    {
        $inbound = $request->headers->get(self::HEADER);
        $id = is_string($inbound) && preg_match(self::PATTERN, $inbound) === 1
            ? $inbound
            : (string) Str::uuid7();

        $request->attributes->set(self::ATTRIBUTE, $id);
        $request->headers->set(self::HEADER, $id);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set(self::HEADER, $id);

        return $response;
    }
}
