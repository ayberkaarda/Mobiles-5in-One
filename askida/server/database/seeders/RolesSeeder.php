<?php

namespace Database\Seeders;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Auth\Abilities\AdminRole;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Admin panel roles and permissions (authorization matrix section 4). Idempotent and
 * safe in every environment: it creates missing rows and resets each role's permission
 * set to exactly the matrix list, so a permission granted by hand is taken back on the
 * next run. It never assigns a role to a user.
 */
class RolesSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (AdminPermission::cases() as $permission) {
            Permission::findOrCreate($permission->value, AdminRole::GUARD);
        }

        // Callers may mute model events (DatabaseSeeder does), which would leave the
        // package's permission cache without the rows created above.
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (AdminRole::cases() as $role) {
            Role::findOrCreate($role->value, AdminRole::GUARD)->syncPermissions(
                array_map(static fn (AdminPermission $permission): string => $permission->value, $role->permissions()),
            );
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
