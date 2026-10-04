<?php

namespace Database\Factories;

use App\Domain\Auth\Models\KvkkConsent;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<KvkkConsent>
 */
class KvkkConsentFactory extends Factory
{
    protected $model = KvkkConsent::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'user_id' => User::factory(),
            'text_version' => '2026-10',
            'accepted_at' => now(),
            // Digest of a documentation-range address (RFC 5737); never a real client IP.
            'ip_hash' => hash('sha256', '192.0.2.'.($n % 250)),
        ];
    }
}
