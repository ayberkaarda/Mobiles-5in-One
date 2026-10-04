<?php

namespace App\Domain\Anon\Attestation;

use App\Domain\Anon\Models\DevicePlatform;

/**
 * A positive attestation result. `verdict` is a short label stored in
 * `anon_devices.attestation_verdict` (at most 32 characters, no device data).
 */
final readonly class AttestationVerdict
{
    public const VALID = 'valid';

    public function __construct(
        public DevicePlatform $platform,
        public string $verdict = self::VALID,
    ) {}
}
