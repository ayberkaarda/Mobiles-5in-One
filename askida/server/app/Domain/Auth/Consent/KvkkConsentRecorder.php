<?php

namespace App\Domain\Auth\Consent;

use App\Domain\Auth\Support\KeyedHash;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Stores the KVKK notice acceptance of a new account. The client IP is kept only as
 * a keyed hash, never in clear.
 */
class KvkkConsentRecorder
{
    public function record(User $user, string $textVersion, string $ip): void
    {
        $now = Carbon::now()->toIso8601String();

        DB::table('kvkk_consents')->insert([
            'id' => (string) Str::uuid7(),
            'user_id' => $user->id,
            'text_version' => $textVersion,
            'accepted_at' => $now,
            'ip_hash' => self::hashIp($ip),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public static function hashIp(string $ip): string
    {
        return KeyedHash::make('kvkk-consent-ip', $ip);
    }
}
