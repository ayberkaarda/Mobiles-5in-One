<?php

use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Pages\Auth\Login;
use App\Filament\Pages\TwoFactorSetup;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Livewire\Features\SupportTesting\Testable;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;

/*
| Security checklist item 18: password then TOTP, recovery codes, replay protection,
| failed-code limit and audit, forced setup.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

function passwordStep(User $user, ?string $password = null): Testable
{
    return Livewire::test(Login::class)
        ->set('data.email', $user->email)
        ->set('data.password', $password ?? UserFactory::PASSWORD)
        ->call('authenticate');
}

it('does not sign a user with a confirmed secret in after the password alone', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);

    passwordStep($admin)->assertHasNoErrors()->assertSet('awaitingCode', true)->assertNoRedirect();

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(session(TwoFactorSession::PENDING)['user'] ?? null)->toBe($admin->id)
        ->and(session(TwoFactorSession::PASSED))->toBeNull();
});

it('signs in after the password and a current TOTP code, and logs the login', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);

    passwordStep($admin)
        ->set('data.code', AdminTestKit::code($admin))
        ->call('authenticate')
        ->assertHasNoErrors()
        ->assertRedirect();

    expect(Auth::guard('web')->id())->toBe($admin->id)
        ->and(session(TwoFactorSession::PASSED))->toBe($admin->id)
        ->and(session(TwoFactorSession::PENDING))->toBeNull();

    $entry = Activity::query()->where('event', 'admin.login')->sole();
    expect($entry->causer_id)->toBe($admin->id)
        ->and($entry->properties->all())->toBe(['method' => 'totp']);
});

it('refuses a wrong code, logs it with the user id only and limits attempts', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Moderator);
    $component = passwordStep($admin);
    $wrong = str_pad((string) ((((int) AdminTestKit::code($admin)) + 1) % 1000000), 6, '0', STR_PAD_LEFT);

    for ($i = 0; $i < 5; $i++) {
        $component->set('data.code', $wrong)->call('authenticate')->assertHasErrors(['data.code']);
    }

    $failures = Activity::query()->where('event', 'admin.totp_failed')->get();
    expect($failures)->toHaveCount(5)
        ->and($failures->pluck('causer_id')->unique()->all())->toBe([$admin->id])
        ->and($failures->every(fn (Activity $a): bool => $a->properties->isEmpty()))->toBeTrue();

    // Sixth try with the right code is still refused: the limiter is per user and address.
    $component->set('data.code', AdminTestKit::code($admin))->call('authenticate')->assertHasErrors(['data.code']);
    expect(Auth::guard('web')->check())->toBeFalse();
});

it('refuses a replayed TOTP code', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Finance);
    $code = AdminTestKit::code($admin);
    $manager = app(TwoFactorManager::class);

    expect($manager->verifyLogin($admin, $code))->toBe(TwoFactorManager::METHOD_TOTP)
        ->and($manager->verifyLogin($admin, $code))->toBeNull();
});

it('confirms setup once, stores ten hashed recovery codes and accepts each only once', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $manager = app(TwoFactorManager::class);
    $secret = $manager->pendingSecret($admin);

    expect($manager->confirm($admin, '000000'.'0'))->toBeNull();

    $codes = $manager->confirm($admin, AdminTestKit::code($admin));
    expect($codes)->toHaveCount(10)
        ->and(array_unique($codes))->toHaveCount(10);

    $raw = DB::table('users')->where('id', $admin->id)->first();
    expect($raw->two_factor_secret)->not->toContain($secret)
        ->and((string) $raw->two_factor_recovery_codes)->not->toContain($codes[0])
        ->and(Hash::check($codes[0], json_decode((string) $raw->two_factor_recovery_codes, true)[0]))->toBeTrue();

    expect($manager->verifyLogin($admin, $codes[3]))->toBe(TwoFactorManager::METHOD_RECOVERY_CODE)
        ->and($manager->verifyLogin($admin, $codes[3]))->toBeNull()
        ->and($manager->remainingRecoveryCodes($admin->refresh()))->toBe(9)
        ->and($manager->verifyFreshCode($admin, $codes[4]))->toBeFalse();
});

it('refuses donor and merchant accounts with a correct password', function (string $kind): void {
    $user = User::factory()->state(['kind' => $kind])->create();

    passwordStep($user)->assertHasErrors(['data.email'])->assertSet('awaitingCode', false);

    expect(Auth::guard('web')->check())->toBeFalse();
})->with(['donor', 'merchant']);

it('refuses a wrong password for a panel user', function (): void {
    passwordStep(AdminTestKit::staff(AdminRole::Admin), 'not-the-password-'.bin2hex(random_bytes(3)))
        ->assertHasErrors(['data.email']);

    expect(Auth::guard('web')->check())->toBeFalse();
});

it('gains nothing when the client flips the code step on without a password', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);

    Livewire::test(Login::class)
        ->set('awaitingCode', true)
        ->set('data.code', AdminTestKit::code($admin))
        ->call('authenticate')
        ->assertHasErrors(['data.email']);

    expect(Auth::guard('web')->check())->toBeFalse();
});

it('signs a user without a secret in after the password and sends them to setup', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);

    passwordStep($admin)->assertHasNoErrors()->assertRedirect();

    expect(Auth::guard('web')->id())->toBe($admin->id);
    $this->get('/admin')->assertRedirect(TwoFactorSetup::getUrl());
});

it('confirms the setup page with a code from the secret and opens the panel', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $this->actingAs($admin, 'web');

    $page = Livewire::test(TwoFactorSetup::class)->assertSee('Elle giriş anahtarı');
    $page->set('code', AdminTestKit::code($admin))->call('confirm')->assertHasNoErrors();

    expect($page->get('recoveryCodes'))->toHaveCount(10)
        ->and($admin->refresh()->two_factor_confirmed_at)->not->toBeNull()
        ->and(session(TwoFactorSession::PASSED))->toBe($admin->id);

    // A later browser request of this session.
    AdminTestKit::httpSession($admin->refresh());
    $this->get('/admin')->assertOk();
    $this->get(TwoFactorSetup::getUrl())->assertRedirect('/admin');
});

it('refuses a wrong setup code and logs it', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $this->actingAs($admin, 'web');
    app(TwoFactorManager::class)->pendingSecret($admin);
    $wrong = str_pad((string) ((((int) AdminTestKit::code($admin)) + 7) % 1000000), 6, '0', STR_PAD_LEFT);

    Livewire::test(TwoFactorSetup::class)->set('code', $wrong)->call('confirm')->assertHasErrors(['code']);

    expect($admin->refresh()->two_factor_confirmed_at)->toBeNull()
        ->and(Activity::query()->where('event', 'admin.totp_failed')->value('causer_id'))->toBe($admin->id);
});

it('ends a session that has a confirmed secret but never passed the code', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $this->actingAs($admin, 'web');

    $this->get('/admin')->assertRedirect('/admin/login');
    expect(Auth::guard('web')->check())->toBeFalse();
});

it('clears the second-factor marker on logout and logs the logout', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    AdminTestKit::httpSession($admin);
    $this->get('/admin')->assertOk();

    $this->post('/admin/logout')->assertRedirect();

    expect(Auth::guard('web')->check())->toBeFalse()
        ->and(app('session')->driver()->get(TwoFactorSession::PASSED))->toBeNull()
        ->and(Activity::query()->where('event', 'admin.logout')->value('causer_id'))->toBe($admin->id);
});

it('keeps the queue dashboard closed to a password-only session', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $this->actingAs($admin, 'web');
    $this->get('/admin');

    expect(Gate::forUser($admin)->allows('viewHorizon'))->toBeFalse();

    session()->put(TwoFactorSession::PASSED, $admin->id);
    expect(Gate::forUser($admin)->allows('viewHorizon'))->toBeTrue();
});
