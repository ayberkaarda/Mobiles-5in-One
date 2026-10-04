<?php

namespace Tests\Feature\Admin\Support;

use App\Domain\Admin\Services\TotpService;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Domain\Auth\Abilities\AdminRole;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Filament\Facades\Filament;

/**
 * Panel users and TOTP codes for the admin tests. Secrets are created at run time by
 * the service itself; no secret or code is written into a test file.
 */
final class AdminTestKit
{
    public static function boot(): void
    {
        (new RolesSeeder)->run();
        Filament::setCurrentPanel(Filament::getPanel('admin'));
    }

    /**
     * A panel user of the role; with a confirmed TOTP secret unless $confirmed is false.
     */
    public static function staff(AdminRole $role, bool $confirmed = true): User
    {
        $user = User::factory()->create();
        $user->assignRole($role->value);

        if ($confirmed) {
            $user->forceFill([
                'two_factor_secret' => app(TotpService::class)->generateSecret(),
                'two_factor_confirmed_at' => now(),
                'two_factor_recovery_codes' => [],
            ])->save();
        }

        return $user;
    }

    /**
     * Signs the user in with the second factor passed, as after a complete login.
     */
    public static function signIn(User $user): User
    {
        test()->actingAs($user, 'web');
        session()->put(TwoFactorSession::PASSED, $user->getKey());

        return $user;
    }

    /**
     * HTTP requests to /admin switch to the admin session cookie and rebuild the session
     * store, so data put into the test's in-memory session does not reach them. This
     * stores the user's panel session in the file handler and sends its cookie, exactly
     * as a browser that completed the login would.
     *
     * @param  array<string, mixed>  $extra
     */
    public static function httpSession(User $user, bool $passed = true, array $extra = []): void
    {
        config(['session.driver' => 'file']);
        $manager = app('session');
        $manager->forgetDrivers();
        $store = $manager->driver();
        $store->setId(null);
        $store->start();
        $store->put($extra);

        if ($passed) {
            $store->put(TwoFactorSession::PASSED, $user->getKey());
        }

        $store->save();

        test()->actingAs($user, 'web');
        test()->withCookie((string) config('session.admin_cookie'), $store->getId());
    }

    public static function code(User $user, int $offsetSteps = 0): string
    {
        $user->refresh();

        return app(TotpService::class)->codeAt((string) $user->two_factor_secret, time() + 30 * $offsetSteps);
    }

    /**
     * A current code whose step is newer than the last accepted one (waits for the next
     * step only when the current one was already used).
     */
    public static function freshCode(User $user): string
    {
        $user->refresh();
        $totp = app(TotpService::class);
        $current = $totp->stepAt(time());

        if ($user->two_factor_last_used_step !== null && $user->two_factor_last_used_step >= $current) {
            return self::code($user, 1);
        }

        return self::code($user);
    }
}
