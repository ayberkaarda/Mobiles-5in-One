<?php

namespace App\Domain\Auth\Abilities;

use App\Models\User;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Extra checks on every bearer token, run by Sanctum after its own expiry checks.
 *
 * - A deactivated user's tokens are refused, read from the database on each request
 *   (the tokenable is loaded fresh), never from token claims.
 * - A user token must carry exactly the ability of `users.kind`. A token with another
 *   ability (for example `anon`), several abilities or the `*` wildcard is refused, so
 *   an anon ability can never reach user routes through a user token, and a kind change
 *   invalidates older tokens.
 * - Any other tokenable type is refused until its own rule exists (anon device tokens
 *   arrive with device attestation).
 */
final class AccessTokenRule
{
    public static function accepts(PersonalAccessToken $token, bool $isValid): bool
    {
        if (! $isValid) {
            return false;
        }

        $tokenable = $token->tokenable;

        if (! $tokenable instanceof User) {
            return false;
        }

        if ($tokenable->isDeactivated()) {
            return false;
        }

        $abilities = $token->abilities;

        return is_array($abilities) && $abilities === [$tokenable->kind->ability()];
    }
}
