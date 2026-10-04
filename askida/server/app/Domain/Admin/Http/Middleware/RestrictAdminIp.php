<?php

namespace App\Domain\Admin\Http\Middleware;

use App\Domain\Admin\Support\IpAllowlist;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Applies the optional admin IP allowlist to every panel route, the login page
 * included, and to the panel's Livewire updates. The client address is Request::ip(),
 * which honours X-Forwarded-For only from configured trusted proxies, so a spoofed
 * header from the internet does not pass. The list fails closed outside local and testing
 * (see IpAllowlist).
 */
final class RestrictAdminIp
{
    public function handle(Request $request, Closure $next): Response
    {
        $allowlist = IpAllowlist::fromConfig();

        if ($allowlist->isMisconfigured()) {
            Log::critical('ADMIN_IP_ALLOWLIST is empty or malformed; the admin panel is closed to every address. List the allowed addresses, or set it to * to allow any address on purpose.');
        }

        abort_unless($allowlist->allows($request->ip()), 403);

        return $next($request);
    }
}
