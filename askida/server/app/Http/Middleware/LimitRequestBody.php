<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security checklist item 6: application-level body size limit, matching the nginx
 * configuration (docker/nginx/default.conf): 1 MB in general, 6 MB for the shop
 * document upload endpoints. nginx rejects larger bodies first; this check keeps the
 * limit when the app runs behind another proxy or in tests. Oversized requests get
 * 413 (problem details `payload_too_large` on the API, the generic page on the web).
 */
class LimitRequestBody
{
    public const DEFAULT_LIMIT = 1024 * 1024;

    public const DOCUMENT_LIMIT = 6 * 1024 * 1024;

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->bodyLength($request) > $this->limitFor($request)) {
            throw new PostTooLargeException('The request body is too large.');
        }

        return $next($request);
    }

    public function limitFor(Request $request): int
    {
        return preg_match('#^api/v1/shops/[^/]+/documents(/|$)#', $request->path()) === 1
            ? self::DOCUMENT_LIMIT
            : self::DEFAULT_LIMIT;
    }

    private function bodyLength(Request $request): int
    {
        $declared = $request->server('CONTENT_LENGTH');

        if (is_numeric($declared)) {
            return (int) $declared;
        }

        return strlen((string) $request->getContent());
    }
}
