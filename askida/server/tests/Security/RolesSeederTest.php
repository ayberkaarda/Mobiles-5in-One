<?php

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Auth\Abilities\AdminRole;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\RolesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

uses(RefreshDatabase::class);

/**
 * @return array<string, list<string>>
 */
function rolePermissionMap(): array
{
    $map = [];

    foreach (Role::query()->with('permissions')->orderBy('name')->get() as $role) {
        $names = $role->permissions->pluck('name')->sort()->values()->all();
        $map[(string) $role->name] = $names;
    }

    return $map;
}

it('creates the three admin roles with exactly the matrix permissions', function (): void {
    $this->seed(RolesSeeder::class);

    $expected = [];

    foreach (AdminRole::cases() as $role) {
        $names = array_map(static fn (AdminPermission $permission): string => $permission->value, $role->permissions());
        sort($names);
        $expected[$role->value] = $names;
    }

    ksort($expected);

    expect(rolePermissionMap())->toBe($expected)
        ->and(Permission::query()->count())->toBe(count(AdminPermission::cases()))
        ->and(Role::query()->pluck('guard_name')->unique()->all())->toBe([AdminRole::GUARD]);
});

it('is idempotent and takes back a permission granted by hand', function (): void {
    $this->seed(RolesSeeder::class);
    $before = rolePermissionMap();

    Role::findByName(AdminRole::Moderator->value, AdminRole::GUARD)->givePermissionTo(AdminPermission::ManageRoles->value);

    $this->seed(RolesSeeder::class);

    expect(rolePermissionMap())->toBe($before)
        ->and(Role::query()->count())->toBe(3);
});

it('is called by the database seeder', function (): void {
    $this->seed(DatabaseSeeder::class);

    expect(Role::query()->count())->toBe(3);
});
