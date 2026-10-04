<?php

namespace App\Domain\Anon\Services;

use App\Domain\Anon\Auth\AnonTokenIssuer;
use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Support\KeyedHash;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POST anon/attest: verifies the attestation token, binds an `anon_id` and issues the
 * device's session token.
 *
 * The device is recognised by a keyed hash of (platform, device nonce): the hash maps
 * to its `anon_id` in the cache together with the verdict for
 * askida.attestation.verdict_cache_days days, so caps and bans stay attached to the
 * same install while its verdict is valid. Neither the nonce nor its hash is written to
 * the database (anon_devices holds only the specification columns). A banned device is
 * refused before the provider is asked, and again inside the write transaction.
 */
class AnonAttestationService
{
    public function __construct(
        private readonly AttestationVerifier $verifier,
        private readonly Cache $cache,
        private readonly AnonTokenIssuer $tokens,
    ) {}

    public function attest(DevicePlatform $platform, string $attestationToken, string $deviceNonce): AnonSession
    {
        $deviceKey = self::deviceKey($platform, $deviceNonce);
        $known = $this->knownAnonId($deviceKey);

        if ($known !== null && AnonDevice::query()->where('anon_id', $known)->whereNotNull('banned_at')->exists()) {
            throw new AnonDeviceBanned('The device is banned.');
        }

        $verdict = $this->verifier->verify($platform, $attestationToken, $deviceNonce);
        $now = Carbon::now();

        $session = DB::transaction(function () use ($known, $platform, $verdict, $now): AnonSession {
            $device = $known === null
                ? null
                : AnonDevice::query()->where('anon_id', $known)->lockForUpdate()->first();

            if ($device?->isBanned()) {
                throw new AnonDeviceBanned('The device is banned.');
            }

            if ($device === null) {
                $device = new AnonDevice;
                $device->forceFill(['anon_id' => (string) Str::uuid7(), 'platform' => $platform]);
            }

            $device->forceFill([
                'attestation_verdict' => $verdict->verdict,
                'attested_at' => $now,
                'last_seen_at' => $now,
            ])->save();

            return new AnonSession($device, $this->tokens->issue($device));
        });

        $ttl = $now->copy()->addDays((int) config('askida.attestation.verdict_cache_days', 30));
        $this->cache->put(self::mappingKey($deviceKey), [
            'anon_id' => $session->device->anon_id,
            'verdict' => $verdict->verdict,
            'attested_at' => $now->toIso8601String(),
        ], $ttl);
        $this->cache->put(self::reverseKey($session->device->anon_id), $deviceKey, $ttl);

        return $session;
    }

    /**
     * Drops the cached device mapping of an anon id (used when the device is deleted).
     */
    public function forget(string $anonId): void
    {
        $deviceKey = $this->cache->pull(self::reverseKey($anonId));

        if (is_string($deviceKey)) {
            $this->cache->forget(self::mappingKey($deviceKey));
        }
    }

    public static function deviceKey(DevicePlatform $platform, string $deviceNonce): string
    {
        return KeyedHash::make('anon-device-key', $platform->value.'|'.$deviceNonce);
    }

    private function knownAnonId(string $deviceKey): ?string
    {
        $entry = $this->cache->get(self::mappingKey($deviceKey));

        return is_array($entry) && is_string($entry['anon_id'] ?? null) ? $entry['anon_id'] : null;
    }

    private static function mappingKey(string $deviceKey): string
    {
        return 'anon:device:'.$deviceKey;
    }

    private static function reverseKey(string $anonId): string
    {
        return 'anon:device-of:'.hash('sha256', $anonId);
    }
}
