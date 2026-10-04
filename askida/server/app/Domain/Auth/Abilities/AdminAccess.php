<?php

namespace App\Domain\Auth\Abilities;

use App\Models\User;
use Laravel\Sanctum\Contracts\HasAbilities;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Admin panel access check behind every admin gate.
 *
 * Granted only when all hold:
 * - the user is not deactivated;
 * - the request is not authenticated by a personal access token (admin roles never
 *   travel on the mobile API, so an admin's donor or merchant token carries no admin
 *   power);
 * - the user holds the permission through one of its roles on the panel guard.
 *
 * Nothing here can reveal recipient identity: no such data and no such permission exist.
 */
final class AdminAccess
{
    public static function allows(mixed $user, AdminPermission $permission): bool
    {
        if (! $user instanceof User || $user->isDeactivated()) {
            return false;
        }

        if (self::viaApiToken($user)) {
            return false;
        }

        return $user->checkPermissionTo($permission->value, AdminRole::GUARD);
    }

    /**
     * True when the user was authenticated by a personal access token (the mobile API),
     * false for a panel session, where no token is attached.
     */
    public static function viaApiToken(User $user): bool
    {
        /** @var HasAbilities|null $token */
        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken;
    }
}
