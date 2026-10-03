<?php

namespace Database\Factories;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AnonDevice>
 */
class AnonDeviceFactory extends Factory
{
    protected $model = AnonDevice::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'anon_id' => sprintf('sample-anon-%06d', $n),
            'platform' => $n % 2 === 0 ? DevicePlatform::Ios : DevicePlatform::Android,
            'attested_at' => now(),
            'attestation_verdict' => 'valid',
            'banned_at' => null,
            'last_seen_at' => now(),
        ];
    }

    public function banned(): static
    {
        return $this->state(fn () => ['banned_at' => now()]);
    }
}
