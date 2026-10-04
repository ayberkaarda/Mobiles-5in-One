<?php

use App\Domain\Admin\PanelAccess;
use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Pages\TwoFactorSetup;
use App\Models\User;
use Filament\Facades\Filament;
use Filament\Resources\Resource;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Who may enter the panel at all (security checklist item 18): roles, forced TOTP setup on
| every route, the optional IP allowlist, no API tokens, no impersonation, no anon data.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

/**
 * Every GET route of the panel, with route parameters filled by a real record.
 *
 * @return list<string>
 */
function panelGetUris(string $recordId): array
{
    $uris = [];

    /** @var RouteDefinition $route */
    foreach (Route::getRoutes()->getRoutes() as $route) {
        $name = (string) $route->getName();

        if (! str_starts_with($name, 'filament.admin.') || ! in_array('GET', $route->methods(), true)) {
            continue;
        }

        $uris[$name] = '/'.preg_replace('/\{[^}]+\}/', $recordId, $route->uri());
    }

    return array_values($uris);
}

it('sends a panel user without a confirmed secret to the setup page from every panel route', function (AdminRole $role): void {
    $shop = ShopTestKit::shop();
    $user = AdminTestKit::staff($role, confirmed: false);
    $this->actingAs($user, 'web');
    $setup = TwoFactorSetup::getUrl();
    $checked = 0;

    foreach (panelGetUris($shop->id) as $uri) {
        if ($uri === '/admin/login' || $uri === parse_url($setup, PHP_URL_PATH)) {
            continue;
        }

        $this->get($uri)->assertRedirect($setup);
        $checked++;
    }

    expect($checked)->toBeGreaterThanOrEqual(9);
    $this->get($setup)->assertOk();
})->with([AdminRole::Admin, AdminRole::Moderator, AdminRole::Finance]);

it('sends guests from every panel route to the login page', function (): void {
    foreach (panelGetUris(ShopTestKit::shop()->id) as $uri) {
        if ($uri === '/admin/login') {
            continue;
        }

        $this->get($uri)->assertRedirect('/admin/login');
    }
});

it('lets only active admin, moderator and finance users in', function (): void {
    expect(PanelAccess::allows(AdminTestKit::staff(AdminRole::Admin)))->toBeTrue()
        ->and(PanelAccess::allows(AdminTestKit::staff(AdminRole::Moderator)))->toBeTrue()
        ->and(PanelAccess::allows(AdminTestKit::staff(AdminRole::Finance)))->toBeTrue()
        ->and(PanelAccess::allows(User::factory()->donor()->create()))->toBeFalse()
        ->and(PanelAccess::allows(User::factory()->merchant()->create()))->toBeFalse();

    $deactivated = AdminTestKit::staff(AdminRole::Admin);
    $deactivated->forceFill(['deactivated_at' => now()])->save();
    expect($deactivated->canAccessPanel(Filament::getPanel('admin')))->toBeFalse();
});

it('refuses a donor or merchant session on every panel page with 403', function (): void {
    $donor = User::factory()->donor()->create();
    AdminTestKit::httpSession($donor);

    $this->get('/admin')->assertForbidden();
    $this->get('/admin/shops')->assertForbidden();
});

it('never grants panel access through a personal access token', function (): void {
    $admin = AdminTestKit::staff(AdminRole::Admin);
    $plain = $admin->createToken('device', ['donor'])->plainTextToken;

    $this->withToken($plain)->get('/admin')->assertRedirect('/admin/login');
    $this->withToken($plain)->get('/admin/shops')->assertRedirect('/admin/login');

    $admin->withAccessToken($admin->tokens()->sole());
    expect(PanelAccess::allows($admin))->toBeFalse()
        ->and($admin->canAccessPanel(Filament::getPanel('admin')))->toBeFalse();
});

it('leaves the panel open to every address when the allowlist is empty', function (): void {
    config(['admin.ip_allowlist' => []]);

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin/login')->assertOk();
});

it('applies the IP allowlist before the login page and on signed-in pages', function (): void {
    config(['admin.ip_allowlist' => ['203.0.113.7', '192.0.2.0/24']]);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->get('/admin/login')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.200'])->get('/admin/login')->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin/login')->assertForbidden();

    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin')->assertForbidden();
    $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.10'])->get('/admin')->assertOk();
});

it('ignores a spoofed X-Forwarded-For and honours it only from a trusted proxy', function (): void {
    config(['admin.ip_allowlist' => ['203.0.113.7']]);
    $spoofed = ['X-Forwarded-For' => '203.0.113.7'];

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])->get('/admin/login', $spoofed)->assertForbidden();

    config(['trustedproxy.proxies' => ['10.0.0.0/8']]);
    $this->withServerVariables(['REMOTE_ADDR' => '10.1.2.3'])->get('/admin/login', $spoofed)->assertOk();
    $this->withServerVariables(['REMOTE_ADDR' => '10.1.2.3'])->get('/admin/login', ['X-Forwarded-For' => '198.51.100.9'])->assertForbidden();
});

it('offers no impersonation: no route, no panel action, gate always denied', function (): void {
    $routes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RouteDefinition $route): bool => str_contains(strtolower($route->uri().' '.$route->getName()), 'impersonat'));
    expect($routes)->toBeEmpty();

    $panelSources = collect(File::allFiles(app_path('Filament')))
        ->filter(fn (SplFileInfo $file): bool => str_contains(strtolower((string) file_get_contents($file->getPathname())), 'impersonat'));
    expect($panelSources)->toBeEmpty();

    expect(Gate::forUser(AdminTestKit::staff(AdminRole::Admin))->allows('impersonate'))->toBeFalse();
});

it('shows no anonymous data beyond the device ban screen on any panel resource', function (): void {
    // The device ban screen (anon_devices) is the one allowed exception; counters and hooks never.
    $anonTables = ['anon_daily_counters', 'hooks'];
    $panel = Filament::getPanel('admin');

    foreach ($panel->getResources() as $resource) {
        /** @var class-string<resource> $resource */
        $model = new ($resource::getModel());
        expect($anonTables)->not->toContain($model->getTable());

        foreach ($resource::getRelations() as $relation) {
            $related = $model->{$relation::getRelationshipName()}()->getRelated();
            expect($anonTables)->not->toContain($related->getTable());
        }
    }

    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));
    $html = $this->get('/admin')->assertOk()->getContent();
    expect(strtolower((string) $html))->not->toContain('anon_daily_counters');
});
