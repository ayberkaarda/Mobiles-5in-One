<?php

namespace App\Domain\Anon\Attestation;

use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\DevicePlatform;

/**
 * The `real` driver: Play Integrity for Android devices, DeviceCheck for iOS devices.
 */
final class PlatformAttestationVerifier implements AttestationVerifier
{
    public function __construct(
        private readonly PlayIntegrityVerifier $android,
        private readonly DeviceCheckVerifier $ios,
    ) {}

    public function verify(DevicePlatform $platform, string $token, string $deviceNonce): AttestationVerdict
    {
        return match ($platform) {
            DevicePlatform::Android => $this->android->verify($platform, $token, $deviceNonce),
            DevicePlatform::Ios => $this->ios->verify($platform, $token, $deviceNonce),
        };
    }
}
