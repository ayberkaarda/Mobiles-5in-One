<?php

namespace App\Domain\Admin\Http\Middleware;

use App\Domain\Admin\Support\IpAllowlist;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Applies the optional admin IP allowlist to every panel route, the login page
 * included, and to the panel's Livewire updates. The client address is Request::ip(),
 * which honours X-Forwarded-For only from configured trusted proxies, so a spoofed
 * header from the internet does not pass.
 */
final class RestrictAdminIp
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(IpAllowlist::fromConfig()->allows($request->ip()), 403);

        return $next($request);
    }
}
