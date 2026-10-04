<?php

namespace App\Domain\Accounts\Services;

use App\Domain\Auth\Contracts\IdentityTokenVerifier;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Identity\InvalidIdentityToken;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Support\Facades\Hash;

/**
 * Re-authentication before a destructive account action.
 *
 * - An account with a password proves it with the password.
 * - An Apple or Google account proves it with a fresh ID token of the provider it is
 *   linked to: the token goes through the same verifier as sign-in (signature, issuer,
 *   audience, expiry, client nonce) and its subject must be the account's subject.
 *
 * A missing proof is a 422 `validation.failed`; a wrong one is a 401 problem.
 */
class Reauthenticator
{
    public function __construct(private readonly IdentityTokenVerifier $verifier) {}

    /**
     * @throws ProblemException
     * @throws InvalidIdentityToken
     */
    public function confirm(User $user, ?string $password, ?IdentityProvider $provider, ?string $idToken, ?string $nonce): void
    {
        if ($password !== null && $user->password !== null) {
            if (! Hash::check($password, $user->password)) {
                throw ProblemException::make(ProblemCode::InvalidCredentials, 401);
            }

            return;
        }

        if ($provider !== null && $idToken !== null && $nonce !== null) {
            $subject = $user->getAttribute($provider->subjectColumn());

            if (! is_string($subject) || $subject === '') {
                throw ProblemException::make(ProblemCode::InvalidCredentials, 401);
            }

            $identity = $this->verifier->verify($provider, $idToken, $nonce);

            if (! hash_equals($subject, $identity->sub)) {
                throw ProblemException::make(ProblemCode::InvalidCredentials, 401);
            }

            return;
        }

        $field = $user->password !== null ? 'password' : 'id_token';

        throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: [['field' => $field, 'code' => 'required']]);
    }
}
