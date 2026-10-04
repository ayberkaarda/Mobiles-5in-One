<?php

namespace App\Domain\Auth\Contracts;

use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Identity\InvalidIdentityToken;
use App\Domain\Auth\Identity\JwksIdentityTokenVerifier;
use App\Domain\Auth\Identity\VerifiedIdentity;
use Illuminate\Container\Attributes\Bind;

/**
 * Verifies an ID token issued by Sign in with Apple or Google Sign-In.
 */
#[Bind(JwksIdentityTokenVerifier::class)]
interface IdentityTokenVerifier
{
    /**
     * @param  string  $nonce  the raw nonce the client created for this sign-in
     *
     * @throws InvalidIdentityToken when the token is not acceptable
     */
    public function verify(IdentityProvider $provider, string $idToken, string $nonce): VerifiedIdentity;
}
