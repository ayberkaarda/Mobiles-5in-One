<?php

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Pages\Auth\Login;
use App\Filament\Pages\TwoFactorSetup;
use App\Filament\Resources\PayoutResource\Pages\ListPayouts;
use App\Filament\Resources\ShopResource\Pages\ListShops;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Admin\Support\FakeHoldsPayouts;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Phase 3 gate "admin e2e" on the real database: accounts created by the bootstrap
| command, password sign-in, forced TOTP setup with a code computed from the stored
| secret, a moderator approving a pending shop, finance holding a payout, logout.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

/**
 * Runs admin:create and returns the account and the printed one-time password.
 *
 * @return array{User, string}
 */
function e2eCreate(string $email, string $role): array
{
    expect(Artisan::call('admin:create', ['email' => $email, '--role' => $role]))->toBe(0);
    preg_match('/Temporary password \(shown once, not stored in clear\): (\S+)/', Artisan::output(), $match);

    return [User::query()->where('email', $email)->sole(), (string) ($match[1] ?? '')];
}

/**
 * First sign-in of a new account: password, forced setup, confirmation.
 */
function e2eFirstSignIn(User $user, string $password): User
{
    Livewire::test(Login::class)
        ->set('data.email', $user->email)
        ->set('data.password', $password)
        ->call('authenticate')
        ->assertHasNoErrors()
        ->assertRedirect();

    expect(Auth::guard('web')->id())->toBe($user->id);

    // Every panel page sends the new account to the setup page.
    test()->get('/admin')->assertRedirect(TwoFactorSetup::getUrl());
    test()->get('/admin/shops')->assertRedirect(TwoFactorSetup::getUrl());

    $setup = Livewire::test(TwoFactorSetup::class)->assertSee('Elle giriş anahtarı');
    $user->refresh();
    expect($user->two_factor_secret)->not->toBeNull();

    $setup->set('code', AdminTestKit::code($user))->call('confirm')->assertHasNoErrors();
    expect($setup->get('recoveryCodes'))->toHaveCount(10)
        ->and($user->refresh()->two_factor_confirmed_at)->not->toBeNull()
        ->and(session(TwoFactorSession::PASSED))->toBe($user->id);

    return $user;
}

function e2eLogout(User $user): void
{
    AdminTestKit::httpSession($user);
    test()->post('/admin/logout')->assertRedirect();
    expect(Auth::guard('web')->check())->toBeFalse();
    Filament::setCurrentPanel(Filament::getPanel('admin'));
}

it('runs the admin flow end to end', function (): void {
    Event::fake([ShopVerified::class]);
    $holds = new FakeHoldsPayouts;
    app()->instance(HoldsPayouts::class, $holds);

    $pending = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $payout = Payout::factory()->create();

    // Admin bootstraps the panel and signs in for the first time.
    [$admin, $adminPassword] = e2eCreate('admin@example.test', 'admin');
    e2eFirstSignIn($admin, $adminPassword);
    e2eLogout($admin);

    // Second sign-in of the admin: password, then a TOTP code.
    Livewire::test(Login::class)
        ->set('data.email', $admin->email)
        ->set('data.password', $adminPassword)
        ->call('authenticate')
        ->assertSet('awaitingCode', true)
        ->set('data.code', AdminTestKit::freshCode($admin))
        ->call('authenticate')
        ->assertHasNoErrors()
        ->assertRedirect();
    expect(Auth::guard('web')->id())->toBe($admin->id);
    e2eLogout($admin);

    // A moderator approves the pending shop.
    [$moderator, $moderatorPassword] = e2eCreate('moderator@example.test', 'moderator');
    e2eFirstSignIn($moderator, $moderatorPassword);
    Livewire::test(ListShops::class)
        ->assertCanSeeTableRecords([$pending])
        ->callTableAction('approve', $pending)
        ->assertHasNoTableActionErrors();

    expect($pending->refresh()->verification_state)->toBe(ShopVerificationState::Verified);
    Event::assertDispatched(ShopVerified::class, fn (ShopVerified $event): bool => $event->shopId === $pending->id && $event->actorId === $moderator->id);
    expect(Activity::query()->where('event', 'shop.verified')->where('subject_id', $pending->id)->value('causer_id'))->toBe($moderator->id);
    e2eLogout($moderator);

    // Finance holds a payout.
    [$finance, $financePassword] = e2eCreate('finance@example.test', 'finance');
    e2eFirstSignIn($finance, $financePassword);
    Livewire::test(ListPayouts::class)
        ->callTableAction('hold', $payout, data: ['reason' => 'Olağandışı kullanım oranı'])
        ->assertHasNoTableActionErrors();

    expect($payout->refresh()->hold)->toBeTrue()
        ->and($holds->calls)->toBe([['hold', $payout->id, $finance->id, 'Olağandışı kullanım oranı']])
        ->and(Activity::query()->where('event', 'admin.payout_held')->value('causer_id'))->toBe($finance->id);
    e2eLogout($finance);

    // Sign-in events of all three accounts are in the activity log, ids only.
    $events = Activity::query()->where('log_name', 'admin')->get();
    expect($events->where('event', 'admin.login')->pluck('causer_id')->unique()->sort()->values()->all())
        ->toBe(collect([$admin->id, $moderator->id, $finance->id])->sort()->values()->all())
        ->and($events->where('event', 'admin.logout')->count())->toBe(4)
        ->and($events->toJson())->not->toContain('@example.test');
});
