<?php

namespace App\Domain\Admin;

use App\Domain\Auth\Abilities\AdminAccess;
use App\Domain\Auth\Abilities\AdminRole;
use App\Models\User;

/**
 * Who may enter the admin panel at all: an active account holding the admin,
 * moderator or finance role on the panel guard, in a panel session. A request that
 * carries a personal access token (the mobile API) never enters, whatever the roles.
 *
 * What each role may see inside is decided per resource by the admin gates.
 */
final class PanelAccess
{
    public static function allows(User $user): bool
    {
        if ($user->isDeactivated() || AdminAccess::viaApiToken($user)) {
            return false;
        }

        return $user->hasAnyRole(array_map(
            static fn (AdminRole $role): string => $role->value,
            AdminRole::cases(),
        ), AdminRole::GUARD);
    }
}
