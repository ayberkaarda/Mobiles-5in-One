<?php

namespace App\Domain\Auth\Tokens;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\NewAccessToken;

/**
 * Issues the Sanctum personal access token of one device.
 *
 * The token name is the device name; issuing a token for a device name the user
 * already has revokes the previous token of that device. The single ability is the
 * account kind (`donor` or `merchant`) and the token expires after sanctum.expiration
 * minutes.
 */
class DeviceTokenIssuer
{
    public function issue(User $user, string $deviceName, string $platform): NewAccessToken
    {
        return DB::transaction(function () use ($user, $deviceName, $platform): NewAccessToken {
            $user->tokens()->where('name', $deviceName)->delete();

            $now = Carbon::now();
            $expiresAt = $now->copy()->addMinutes((int) config('sanctum.expiration', 43200));

            $token = $user->createToken($deviceName, [$user->kind->ability()], $expiresAt);

            // Sanctum's model writes timestamps without an offset; rewrite the ones the
            // expiry check reads with an explicit offset so the stored instants are exact.
            DB::table('personal_access_tokens')->where('id', $token->accessToken->getKey())->update([
                'platform' => $platform,
                'created_at' => $now->toIso8601String(),
                'updated_at' => $now->toIso8601String(),
                'expires_at' => $expiresAt->toIso8601String(),
            ]);

            $token->accessToken->refresh();

            return $token;
        });
    }

    public function revokeAll(User $user): void
    {
        $user->tokens()->delete();
    }
}
