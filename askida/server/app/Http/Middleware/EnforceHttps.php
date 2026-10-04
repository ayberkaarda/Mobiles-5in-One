<?php

namespace App\Http\Middleware;

use App\Support\Problem\Handler;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security checklist item 10: outside local development and tests, plain HTTP is not
 * served. Web GET/HEAD requests are redirected to HTTPS, other web requests are refused,
 * API requests are rejected with a problem body (a redirect would let a client resend
 * credentials in clear text). Whether a request is secure is decided after the trusted
 * proxy rules, so a spoofed X-Forwarded-Proto from an untrusted peer does not count.
 *
 * The reverse proxy (Caddy or nginx) must also redirect port 80 to HTTPS; this
 * middleware is the application-level backstop. The health route stays reachable for
 * the container health check, which runs over plain HTTP inside the container.
 */
class EnforceHttps
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isSecure() || app()->environment('local', 'testing') || $request->is('up')) {
            return $next($request);
        }

        if (Handler::isApi($request)) {
            throw ProblemException::make(ProblemCode::HttpsRequired, 403);
        }

        if ($request->isMethod('GET') || $request->isMethod('HEAD')) {
            return new RedirectResponse('https://'.$this->canonicalHost($request).$request->getRequestUri(), 301);
        }

        abort(403);
    }

    /**
     * The redirect goes to the configured application host, never to the Host header,
     * so a forged Host cannot turn the redirect into an open redirect.
     */
    private function canonicalHost(Request $request): string
    {
        $host = parse_url((string) config('app.url'), PHP_URL_HOST);

        return is_string($host) && $host !== '' ? $host : $request->getHost();
    }
}
