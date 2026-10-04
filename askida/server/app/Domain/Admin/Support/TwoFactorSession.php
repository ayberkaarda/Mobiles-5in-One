<?php

namespace App\Domain\Admin\Support;

use App\Models\User;
use Illuminate\Contracts\Session\Session;

/**
 * Session markers of the two-step panel login. Both live only in the server-side
 * session (never in Livewire component state, which the browser could alter) and die
 * with it: logout invalidates the session.
 *
 * - `passed`: the id of the user who completed the second factor in this session;
 * - `pending`: the id of the user whose password was accepted and who still owes a
 *   TOTP code, with an expiry.
 */
final class TwoFactorSession
{
    public const PASSED = 'admin.two_factor_passed';

    public const PENDING = 'admin.login.pending';

    public static function hasPassed(Session $session, User $user): bool
    {
        return $session->get(self::PASSED) === $user->getKey();
    }

    public static function markPassed(Session $session, User $user): void
    {
        $session->forget(self::PENDING);
        $session->put(self::PASSED, $user->getKey());
    }

    public static function forget(Session $session): void
    {
        $session->forget([self::PASSED, self::PENDING]);
    }

    public static function startChallenge(Session $session, User $user, int $ttlSeconds): void
    {
        $session->put(self::PENDING, ['user' => $user->getKey(), 'expires_at' => time() + $ttlSeconds]);
    }

    /**
     * The user who owes a TOTP code, or null when there is none or it expired.
     */
    public static function pendingUserId(Session $session): ?string
    {
        $pending = $session->get(self::PENDING);

        if (! is_array($pending) || ! is_string($pending['user'] ?? null) || ! is_int($pending['expires_at'] ?? null)) {
            return null;
        }

        if ($pending['expires_at'] < time()) {
            $session->forget(self::PENDING);

            return null;
        }

        return $pending['user'];
    }
}
