<?php

namespace App\Domain\Anon\Services;

use App\Domain\Anon\Models\AnonDevice;
use Laravel\Sanctum\NewAccessToken;

/**
 * Result of a successful attestation: the device and its new session token.
 */
final readonly class AnonSession
{
    public function __construct(
        public AnonDevice $device,
        public NewAccessToken $token,
    ) {}
}
