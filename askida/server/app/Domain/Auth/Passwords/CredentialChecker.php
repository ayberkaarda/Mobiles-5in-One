<?php

namespace App\Domain\Auth\Passwords;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Email and password check with a uniform outcome: unknown email, provider-only
 * account (no password), deactivated account and wrong password all return false,
 * and a hash is verified in every case so response time does not reveal which.
 */
class CredentialChecker
{
    private static ?string $decoyHash = null;

    public function check(?User $user, string $password): bool
    {
        if ($user === null || $user->password === null) {
            Hash::check($password, self::decoyHash());

            return false;
        }

        return Hash::check($password, $user->password) && ! $user->isDeactivated();
    }

    private static function decoyHash(): string
    {
        return self::$decoyHash ??= Hash::make(bin2hex(random_bytes(16)));
    }
}
