<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Session\SessionManager;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security checklist items 12 and 18: the Filament admin panel gets its own session cookie
 * with SameSite=strict, separate from the public web cookie (lax).
 *
 * Laravel has one session configuration per request, not one per guard, and Filament
 * starts the session with the framework StartSession middleware. Switching the cookie
 * name and SameSite value before StartSession runs gives the panel a strict cookie
 * without touching the public web. Livewire update requests (livewire/*) come from the
 * panel pages and must read the same cookie; the public web does not use Livewire.
 */
class AdminSessionCookie
{
    public function __construct(private readonly SessionManager $sessions) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->is('admin', 'admin/*', 'livewire/*')) {
            config([
                'session.cookie' => config('session.admin_cookie'),
                'session.same_site' => config('session.admin_same_site'),
            ]);

            // A store built earlier in the same process would still carry the public name.
            $this->sessions->forgetDrivers();
        }

        return $next($request);
    }
}
