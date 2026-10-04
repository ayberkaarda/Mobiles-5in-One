<?php

namespace App\Domain\Anon\Auth;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use Illuminate\Routing\Route;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Bearer token rule for anon device tokens (tokenable AnonDevice).
 *
 * Sanctum's own validity flag is false for every device token because the `sanctum`
 * guard's provider is the users table, so expiry is checked here again. A device
 * token is accepted only when:
 * - it has not expired (expires_at and sanctum.expiration);
 * - its device exists and is not banned (read from the database on each request);
 * - it carries exactly the `anon` ability;
 * - the current route explicitly demands the anon ability (`abilities:anon` or
 *   `ability:anon`). Every other route, including the user routes, refuses the token
 *   with the usual 401 `auth.unauthenticated`.
 */
final class AnonTokenRule
{
    /**
     * Route middleware that marks an anon route.
     */
    public const ROUTE_MIDDLEWARE = ['abilities:anon', 'ability:anon'];

    public static function accepts(PersonalAccessToken $token, ?Route $route): bool
    {
        $device = $token->tokenable;

        if (! $device instanceof AnonDevice || $device->isBanned()) {
            return false;
        }

        if (! self::unexpired($token)) {
            return false;
        }

        if ($token->abilities !== [Ability::Anon->value]) {
            return false;
        }

        return $route !== null && array_intersect(self::ROUTE_MIDDLEWARE, $route->gatherMiddleware()) !== [];
    }

    private static function unexpired(PersonalAccessToken $token): bool
    {
        $now = Carbon::now();

        if ($token->expires_at === null || $token->expires_at->lessThanOrEqualTo($now)) {
            return false;
        }

        $lifetime = (int) config('sanctum.expiration');

        return $lifetime <= 0 || ($token->created_at !== null && $token->created_at->greaterThan($now->copy()->subMinutes($lifetime)));
    }
}
