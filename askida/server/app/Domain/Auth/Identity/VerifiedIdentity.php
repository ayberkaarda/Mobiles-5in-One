<?php

namespace App\Domain\Auth\Identity;

/**
 * Claims of an identity token that passed signature, issuer, audience, expiry and nonce checks.
 */
final readonly class VerifiedIdentity
{
    public function __construct(
        public string $sub,
        public ?string $email,
        public bool $emailVerified,
        public ?string $name = null,
    ) {}
}
