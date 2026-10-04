<?php

namespace App\Domain\Anon\Contracts;

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Attestation\AttestationVerdict;
use App\Domain\Anon\Models\DevicePlatform;

/**
 * Verifies a device attestation token with the platform provider (Play Integrity on
 * Android, DeviceCheck on iOS). The token is the only credential of an anonymous
 * device; nothing about the person holding the device is learned or stored.
 */
interface AttestationVerifier
{
    /**
     * @param  string  $deviceNonce  per-install random value the app bound into the attestation request
     *
     * @throws AttestationFailed when the provider rejects the token or the verdict is not good enough
     * @throws AttestationUnavailable when the provider cannot be reached or is not configured
     */
    public function verify(DevicePlatform $platform, string $token, string $deviceNonce): AttestationVerdict;
}
