<?php

namespace App\Providers\Filament;

use App\Domain\Admin\Console\CreateAdminCommand;
use App\Domain\Admin\Http\Middleware\EnsureTwoFactor;
use App\Domain\Admin\Http\Middleware\RestrictAdminIp;
use App\Domain\Admin\PanelAccess;
use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Admin\Services\TotpService;
use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Filament\Pages\Auth\Login;
use App\Models\User;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Pages;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Filament\Widgets;
use Illuminate\Auth\Events\Logout;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\View\Middleware\ShareErrorsFromSession;

/**
 * The admin panel (spec section 6 item 18): `/admin`, guard `web`, password then TOTP,
 * forced TOTP setup, optional IP allowlist, roles admin/moderator/finance through the
 * admin gates, activity log on sign-in events and on every change, no impersonation.
 */
class AdminPanelProvider extends PanelProvider
{
    public function register(): void
    {
        parent::register();

        $this->app->singleton(TotpService::class, static fn (): TotpService => new TotpService(
            (int) config('admin.two_factor.period', 30),
            (int) config('admin.two_factor.digits', 6),
            (int) config('admin.two_factor.window', 1),
        ));

        $this->app->bind(TwoFactorManager::class, static fn ($app): TwoFactorManager => new TwoFactorManager(
            $app->make(TotpService::class),
            $app->make(Hasher::class),
            (int) config('admin.two_factor.recovery_codes', 10),
        ));
    }

    public function boot(): void
    {
        RateLimiter::for(Login::LIMITER, static fn (Request $request, ?User $user = null): Limit => Limit::perMinute(
            (int) config('admin.two_factor.attempts_per_minute', 5),
        )->by('admin-totp:'.($user?->getKey() ?? 'guest').'|'.$request->ip()));

        Event::listen(Logout::class, static function (Logout $event): void {
            if (! $event->user instanceof User || ! PanelAccess::allows($event->user)) {
                return;
            }

            if (request()->hasSession()) {
                TwoFactorSession::forget(request()->session());
            }

            AdminAudit::log('admin.logout', $event->user, $event->user);
        });

        // The queue dashboard shares the panel's session guard. A password-only session
        // (TOTP not set up or not passed) must not open it.
        Gate::before(static function (mixed $user, string $ability): ?bool {
            if (! in_array($ability, ['viewHorizon', 'view-horizon'], true) || ! $user instanceof User) {
                return null;
            }

            $request = request();

            if (! $request->hasSession() || TwoFactorSession::hasPassed($request->session(), $user)) {
                return null;
            }

            return false;
        });

        if ($this->app->runningInConsole()) {
            $this->commands([CreateAdminCommand::class]);
        }
    }

    public function panel(Panel $panel): Panel
    {
        return $panel
            ->default()
            ->id('admin')
            ->path('admin')
            ->login(Login::class)
            ->colors([
                'primary' => Color::Amber,
            ])
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\\Filament\\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\\Filament\\Pages')
            ->pages([
                Pages\Dashboard::class,
            ])
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\\Filament\\Widgets')
            ->widgets([
                Widgets\AccountWidget::class,
            ])
            ->middleware([
                RestrictAdminIp::class,
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                VerifyCsrfToken::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            ->persistentMiddleware([
                RestrictAdminIp::class,
            ])
            ->authMiddleware([
                Authenticate::class,
                EnsureTwoFactor::class,
            ], isPersistent: true);
    }
}
