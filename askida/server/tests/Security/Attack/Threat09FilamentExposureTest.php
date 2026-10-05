<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Resources\PayoutResource;
use App\Filament\Resources\UserResource;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Admin\Support\AdminTestKit;

/*
| Threat 4.9, admin panel exposure. A stolen password alone opens nothing (TOTP is required
| on every panel route, and a session that skipped it is ended); the IP allowlist holds
| against a spoofed forwarded address; a moderator never reaches finance or staff screens;
| no impersonation route exists; the queue dashboard and other tool consoles are closed to
| everyone without a full panel session; a personal access token never opens the panel.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

it('ends a password-only session of a TOTP user on every panel page', function (string $uri): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    AdminTestKit::httpSession($admin, passed: false);

    $this->get($uri)->assertRedirect('/admin/login');

    expect(Auth::guard('web')->check())->toBeFalse();
})->with(['/admin', '/admin/shops', '/admin/payouts', '/admin/staff', '/admin/activity-log']);

it('negative control: the same admin with the second factor passed opens the panel', function (): void {
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));

    $this->get('/admin')->assertOk();
});

it('keeps the allowlist closed to an outside address, a spoofed forwarded address included', function (): void {
    config(['admin.ip_allowlist' => ['203.0.113.7']]);
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin')->assertForbidden();
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin', ['X-Forwarded-For' => '203.0.113.7'])->assertForbidden();
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin/login', ['X-Real-IP' => '203.0.113.7', 'Forwarded' => 'for=203.0.113.7'])->assertForbidden();

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->get('/admin')->assertOk();
});

it('keeps a moderator out of finance and staff screens', function (string $uri): void {
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Moderator));

    $this->get($uri)->assertForbidden();
})->with(['payouts' => '/admin/payouts', 'staff' => '/admin/staff', 'activity log' => '/admin/activity-log']);

it('negative control: finance opens the payout screen', function (): void {
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Finance));

    $this->get('/admin/payouts')->assertOk();
    expect(parse_url(PayoutResource::getUrl(panel: 'admin'), PHP_URL_PATH))->toBe('/admin/payouts')
        ->and(parse_url(UserResource::getUrl(panel: 'admin'), PHP_URL_PATH))->toBe('/admin/staff');
});

it('has no impersonation route and answers guessed impersonation paths with 404', function (string $path): void {
    $routes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RouteDefinition $route): bool => str_contains(strtolower($route->uri().' '.$route->getName()), 'impersonat'));

    expect($routes)->toBeEmpty();

    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));
    $this->get($path)->assertNotFound();
})->with(['/admin/impersonate/1', '/impersonate/take/1', '/admin/users/1/impersonate']);

it('closes the queue dashboard and tool consoles to guests and to non-panel accounts', function (string $path): void {
    $guest = $this->get($path);
    expect($guest->status())->toBeIn([403, 404]);

    $this->actingAs(User::factory()->donor()->create(), 'web');
    expect($this->get($path)->status())->toBeIn([403, 404]);
})->with(['/horizon', '/horizon/api/stats', '/horizon/api/jobs/pending', '/telescope', '/pulse', '/_debugbar/open', '/log-viewer']);

it('never opens the panel for an admin\'s personal access token', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $plain = $admin->createToken('stolen', ['*'])->plainTextToken;

    $this->withToken($plain)->get('/admin')->assertRedirect('/admin/login');
    $this->withToken($plain)->getJson('/api/v1/me')->assertStatus(401)->assertJsonPath('code', 'auth.unauthenticated');
});
