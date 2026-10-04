<?php

namespace App\Domain\Admin\Http\Middleware;

use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Filament\Pages\TwoFactorSetup;
use App\Models\User;
use Closure;
use Filament\Facades\Filament;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs on every authenticated panel route and on the panel's Livewire updates:
 *
 * - a user without a confirmed TOTP secret reaches only the setup page (and logout);
 * - a user with a confirmed secret must have passed the second factor in this very
 *   session, otherwise the session is ended and the login page shown;
 * - once set up, the setup page is closed.
 */
final class EnsureTwoFactor
{
    public function __construct(private readonly TwoFactorManager $twoFactor) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = Filament::auth()->user();

        if (! $user instanceof User) {
            return $next($request);
        }

        $onSetupPage = $request->is(self::setupPath());
        $onLogout = $request->is(trim(Filament::getCurrentPanel()?->getPath() ?? 'admin', '/').'/logout');

        if (! $this->twoFactor->hasConfirmed($user)) {
            if ($onSetupPage || $onLogout) {
                return $next($request);
            }

            return redirect()->to(TwoFactorSetup::getUrl());
        }

        if (! TwoFactorSession::hasPassed($request->session(), $user)) {
            Filament::auth()->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return redirect()->to(Filament::getLoginUrl() ?? '/admin/login');
        }

        if ($onSetupPage) {
            return redirect()->to(Filament::getUrl() ?? '/admin');
        }

        return $next($request);
    }

    private static function setupPath(): string
    {
        return trim((string) parse_url(TwoFactorSetup::getUrl(), PHP_URL_PATH), '/');
    }
}
