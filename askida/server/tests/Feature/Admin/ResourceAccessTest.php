<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Resources\AbuseFlagResource;
use App\Filament\Resources\ActivityLogResource;
use App\Filament\Resources\DonationResource;
use App\Filament\Resources\PaymentMismatchResource;
use App\Filament\Resources\PayoutResource;
use App\Filament\Resources\ShopResource;
use App\Filament\Resources\UserResource;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Role by resource (authorization matrix section 4). Moderators never see finance
| resources and finance never sees the verification queue; only admins manage staff and
| read the activity log. No resource can create, edit or delete records directly.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

/**
 * Resource => roles that may list and view it.
 *
 * @return array<class-string, list<AdminRole>>
 */
function panelResourceRoles(): array
{
    return [
        ShopResource::class => [AdminRole::Moderator, AdminRole::Admin],
        AbuseFlagResource::class => [AdminRole::Moderator, AdminRole::Finance, AdminRole::Admin],
        DonationResource::class => [AdminRole::Finance, AdminRole::Admin],
        PayoutResource::class => [AdminRole::Finance, AdminRole::Admin],
        PaymentMismatchResource::class => [AdminRole::Finance, AdminRole::Admin],
        UserResource::class => [AdminRole::Admin],
        ActivityLogResource::class => [AdminRole::Admin],
    ];
}

/**
 * @return array<string, array{class-string, AdminRole, bool}>
 */
function panelResourceCells(): array
{
    $cells = [];

    foreach (panelResourceRoles() as $resource => $roles) {
        foreach (AdminRole::cases() as $role) {
            $cells[class_basename($resource).' as '.$role->value] = [$resource, $role, in_array($role, $roles, true)];
        }
    }

    return $cells;
}

it('covers every resource the panel registers', function (): void {
    expect(array_values(Filament::getPanel('admin')->getResources()))->toEqualCanonicalizing(array_keys(panelResourceRoles()));
});

it('applies the role cell to list, view and every write permission', function (string $resource, AdminRole $role, bool $allowed): void {
    AdminTestKit::signIn(AdminTestKit::staff($role));
    $record = new ($resource::getModel());

    expect($resource::canViewAny())->toBe($allowed)
        ->and($resource::canView($record))->toBe($allowed)
        ->and($resource::canAccess())->toBe($allowed)
        ->and($resource::canCreate())->toBeFalse()
        ->and($resource::canEdit($record))->toBeFalse()
        ->and($resource::canDelete($record))->toBeFalse()
        ->and($resource::canDeleteAny())->toBeFalse()
        ->and($resource::canForceDelete($record))->toBeFalse()
        ->and($resource::canRestore($record))->toBeFalse()
        ->and($resource::canReplicate($record))->toBeFalse();
})->with(panelResourceCells());

it('serves or refuses every page of the resource by role over HTTP', function (string $resource, AdminRole $role, bool $allowed): void {
    $shop = ShopTestKit::shop();
    AdminTestKit::httpSession(AdminTestKit::staff($role));

    foreach ($resource::getPages() as $name => $page) {
        $url = $name === 'index' ? $resource::getUrl('index') : $resource::getUrl($name, ['record' => $shop]);
        $response = $this->get($url);

        $allowed ? $response->assertOk() : $response->assertForbidden();
    }
})->with(panelResourceCells());

it('shows a role only the navigation of its resources', function (AdminRole $role): void {
    AdminTestKit::httpSession(AdminTestKit::staff($role));
    $html = (string) $this->get('/admin')->assertOk()->getContent();

    foreach (panelResourceRoles() as $resource => $roles) {
        $link = 'href="'.$resource::getUrl('index').'"';
        in_array($role, $roles, true)
            ? expect($html)->toContain($link)
            : expect($html)->not->toContain($link);
    }
})->with([AdminRole::Moderator, AdminRole::Finance, AdminRole::Admin]);
