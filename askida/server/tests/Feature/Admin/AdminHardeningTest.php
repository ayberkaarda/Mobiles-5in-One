<?php

use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\IpAllowlist;
use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Pages\Auth\Login;
use App\Filament\Pages\TwoFactorSetup;
use Database\Factories\UserFactory;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Livewire\Livewire;
use Tests\Feature\Admin\Support\AdminTestKit;

/*
| The IP allowlist fails closed outside local and testing; TOTP guesses are capped per
| account whatever the source address.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

function adminAsEnvironment(string $name): void
{
    app()->detectEnvironment(fn (): string => $name);
}

it('denies every address in production when the allowlist is empty, missing or wrongly typed', function (mixed $value): void {
    adminAsEnvironment('production');
    config(['admin.ip_allowlist' => $value]);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->get('https://localhost/admin/login')->assertForbidden();
    expect(IpAllowlist::fromConfig()->isMisconfigured())->toBeTrue();
})->with([
    'empty list' => [[]],
    'unset' => [null],
    'a string' => ['203.0.113.7'],
    'an integer' => [7],
    'malformed entry' => [['203.0.113.7', 'not-an-address']],
    'bad prefix' => [['203.0.113.0/99']],
    'non-string entry' => [['203.0.113.7', 12]],
]);

it('logs a clear message when it closes the panel for a misconfigured list', function (): void {
    adminAsEnvironment('production');
    config(['admin.ip_allowlist' => []]);
    $messages = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$messages): void {
        $messages[] = $event->level.': '.$event->message;
    });

    $this->get('https://localhost/admin/login')->assertForbidden();

    expect(implode("\n", $messages))->toContain('critical: ADMIN_IP_ALLOWLIST is empty or malformed');
});

it('still applies a valid list in production and honours the explicit wildcard', function (): void {
    adminAsEnvironment('production');

    config(['admin.ip_allowlist' => ['203.0.113.7', '192.0.2.0/24', '2001:db8::/32']]);
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->get('https://localhost/admin/login')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.50'])->get('https://localhost/admin/login')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '2001:db8::5'])->get('https://localhost/admin/login')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('https://localhost/admin/login')->assertForbidden();

    config(['admin.ip_allowlist' => ['*']]);
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('https://localhost/admin/login')->assertOk();
});

it('keeps an empty list open in local and testing', function (string $environment): void {
    adminAsEnvironment($environment);
    config(['admin.ip_allowlist' => []]);

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin/login')->assertOk();
    expect(IpAllowlist::fromConfig()->isMisconfigured())->toBeFalse();
})->with(['local', 'testing']);

it('locks the TOTP step of an account after the account cap, whatever the source address', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $cap = (int) config('admin.two_factor.account_attempts');
    // Every attempt arrives from a "new address": the per-address limit never trips.
    RateLimiter::for(Login::LIMITER, static fn (): Limit => Limit::perMinute(5)->by('addr-'.bin2hex(random_bytes(4))));

    $component = Livewire::test(Login::class)
        ->set('data.email', $admin->email)
        ->set('data.password', UserFactory::PASSWORD)
        ->call('authenticate');
    $wrong = str_pad((string) ((((int) AdminTestKit::code($admin)) + 1) % 1000000), 6, '0', STR_PAD_LEFT);

    for ($i = 0; $i < $cap; $i++) {
        $component->set('data.code', $wrong)->call('authenticate')->assertHasErrors(['data.code']);
    }

    // The right code is refused now, with the lock message, and nothing signs in.
    $component->set('data.code', AdminTestKit::code($admin))->call('authenticate')
        ->assertHasErrors(['data.code']);
    expect(Auth::guard('web')->check())->toBeFalse();
    $errors = $component->errors()->get('data.code');
    expect($errors[0])->toContain('Bu hesap için çok fazla hatalı kod');

    // After the cool-down the account can sign in again.
    $this->travel((int) config('admin.two_factor.account_lockout_seconds') + 1)->seconds();
    $component->set('data.code', AdminTestKit::code($admin))->call('authenticate')->assertHasNoErrors();
    expect(Auth::guard('web')->id())->toBe($admin->id);
});

it('keeps the per-address limit in addition to the account cap', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $component = Livewire::test(Login::class)
        ->set('data.email', $admin->email)
        ->set('data.password', UserFactory::PASSWORD)
        ->call('authenticate');
    $wrong = str_pad((string) ((((int) AdminTestKit::code($admin)) + 1) % 1000000), 6, '0', STR_PAD_LEFT);

    for ($i = 0; $i < 5; $i++) {
        $component->set('data.code', $wrong)->call('authenticate');
    }

    $component->set('data.code', AdminTestKit::code($admin))->call('authenticate')->assertHasErrors(['data.code']);
    expect($component->errors()->get('data.code')[0])->toContain('Çok fazla hatalı deneme');
});

it('applies the account cap to the setup page as well', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin, confirmed: false);
    $this->actingAs($admin, 'web');
    $throttle = Login::throttleFor($admin);

    for ($i = 0; $i < (int) config('admin.two_factor.account_attempts'); $i++) {
        $throttle->failed();
    }

    RateLimiter::clear('admin-totp:'.$admin->getKey().'|'.request()->ip());
    app(TwoFactorManager::class)->pendingSecret($admin);

    Livewire::test(TwoFactorSetup::class)->set('code', AdminTestKit::code($admin))->call('confirm')->assertHasErrors(['code']);

    expect($admin->refresh()->two_factor_confirmed_at)->toBeNull();
});
