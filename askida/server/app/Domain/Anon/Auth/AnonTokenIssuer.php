<?php

namespace App\Domain\Anon\Auth;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\NewAccessToken;

/**
 * Issues the session token of an attested anon device: one active token per device
 * (issuing revokes the previous ones), the single ability `anon`, and an expiry of
 * askida.attestation.token_days days.
 */
class AnonTokenIssuer
{
    public const TOKEN_NAME = 'anon-device';

    public function issue(AnonDevice $device): NewAccessToken
    {
        return DB::transaction(function () use ($device): NewAccessToken {
            $device->tokens()->delete();

            $expiresAt = Carbon::now()->addDays((int) config('askida.attestation.token_days', 30));
            $token = $device->createToken(self::TOKEN_NAME, [Ability::Anon->value], $expiresAt);
            $token->accessToken->forceFill(['platform' => $device->platform->value])->save();

            return $token;
        });
    }

    public function revokeAll(AnonDevice $device): void
    {
        $device->tokens()->delete();
    }
}
