<?php

namespace App\Domain\Accounts\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Grace-period rule of account deletion: a successful sign-in within the grace period
 * cancels the pending deletion request and reactivates the account. The sign-in
 * controllers call this before their own deactivation check; accounts that are
 * deactivated without a running deletion request stay refused.
 */
class SignInReactivation
{
    public function __construct(private readonly AccountDeletionService $deletions) {}

    /**
     * Email and password sign-in: reactivates only when the password is correct.
     */
    public function forPassword(?User $user, string $password): void
    {
        if ($user === null || ! $user->isDeactivated() || $user->password === null) {
            return;
        }

        if (! Hash::check($password, $user->password)) {
            return;
        }

        $this->deletions->cancelPending($user);
    }

    /**
     * Apple or Google sign-in: the identity token has already been verified for this user.
     */
    public function forVerifiedIdentity(User $user): void
    {
        if ($user->isDeactivated()) {
            $this->deletions->cancelPending($user);
        }
    }
}
