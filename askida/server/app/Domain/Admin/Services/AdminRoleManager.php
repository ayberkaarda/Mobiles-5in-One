<?php

namespace App\Domain\Admin\Services;

use App\Domain\Admin\Exceptions\LastAdminProtected;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Auth\Abilities\AdminRole;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Spatie\Permission\PermissionRegistrar;

/**
 * Role assignment and TOTP reset for panel users (matrix: "Manage admin users and
 * roles", admin only).
 *
 * Last-admin rule: no change may leave the system without an active admin whose TOTP
 * secret is confirmed, otherwise nobody could manage roles any more. Changes are
 * serialised with a transaction-scoped advisory lock so two admins revoking each
 * other at the same moment cannot both succeed.
 */
final class AdminRoleManager
{
    public function __construct(private readonly TwoFactorManager $twoFactor) {}

    public function assign(User $target, AdminRole $role, User $actor): bool
    {
        $this->authorize($actor);

        return DB::transaction(function () use ($target, $role, $actor): bool {
            $this->serialise();

            if ($target->hasRole($role->value, AdminRole::GUARD)) {
                return false;
            }

            $target->assignRole($role->value);
            $this->forgetPermissionCache();

            AdminAudit::log('admin.role_assigned', $actor, $target, ['role' => $role->value]);

            return true;
        });
    }

    public function revoke(User $target, AdminRole $role, User $actor): bool
    {
        $this->authorize($actor);

        return DB::transaction(function () use ($target, $role, $actor): bool {
            $this->serialise();

            if (! $target->hasRole($role->value, AdminRole::GUARD)) {
                return false;
            }

            if ($role === AdminRole::Admin && $this->otherConfirmedAdmins($target) === 0) {
                throw new LastAdminProtected;
            }

            $target->removeRole($role->value);
            $this->forgetPermissionCache();

            AdminAudit::log('admin.role_revoked', $actor, $target, ['role' => $role->value]);

            return true;
        });
    }

    /**
     * Clears the target's TOTP secret and recovery codes; the target must set up a new
     * secret before reaching any panel page again.
     */
    public function resetTwoFactor(User $target, User $actor): void
    {
        $this->authorize($actor);

        DB::transaction(function () use ($target, $actor): void {
            $this->serialise();

            if ($target->hasRole(AdminRole::Admin->value, AdminRole::GUARD)
                && $this->twoFactor->hasConfirmed($target)
                && $this->otherConfirmedAdmins($target) === 0) {
                throw new LastAdminProtected;
            }

            $this->twoFactor->reset($target);

            AdminAudit::log('admin.two_factor_reset', $actor, $target);
        });
    }

    private function otherConfirmedAdmins(User $target): int
    {
        return User::query()
            ->role(AdminRole::Admin->value, AdminRole::GUARD)
            ->whereKeyNot($target->getKey())
            ->whereNull('deactivated_at')
            ->whereNotNull('two_factor_confirmed_at')
            ->whereNotNull('two_factor_secret')
            ->count();
    }

    private function authorize(User $actor): void
    {
        Gate::forUser($actor)->authorize(AdminPermission::ManageRoles->gate());
    }

    private function serialise(): void
    {
        DB::statement("SELECT pg_advisory_xact_lock(hashtext('askida.admin_roles'))");
    }

    private function forgetPermissionCache(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
