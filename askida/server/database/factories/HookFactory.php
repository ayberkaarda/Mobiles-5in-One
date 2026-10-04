<?php

namespace Database\Factories;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Hook>
 */
class HookFactory extends Factory
{
    protected $model = Hook::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'donation_id' => Donation::factory()->paid(),
            'shop_id' => fn (array $attributes) => self::donation($attributes)->shop_id,
            'item_id' => fn (array $attributes) => self::donation($attributes)->item_id,
            'status' => HookStatus::Available,
        ];
    }

    public function reserved(): static
    {
        return $this->state(fn () => [
            'status' => HookStatus::Reserved,
            'anon_id' => fn () => AnonDevice::factory()->create()->anon_id,
            'code_hash' => self::sampleCodeHash(),
            'reserved_at' => now(),
            'expires_at' => now()->addMinutes(10),
        ]);
    }

    public function redeemed(): static
    {
        return $this->state(fn () => [
            'status' => HookStatus::Redeemed,
            'anon_id' => null,
            'code_hash' => self::sampleCodeHash(),
            'reserved_at' => now()->subMinutes(3),
            'expires_at' => now()->addMinutes(7),
            'redeemed_at' => now(),
        ]);
    }

    /**
     * A digest-shaped value derived at run time; no real code or pepper is involved.
     */
    public static function sampleCodeHash(): string
    {
        return hash('sha256', 'sample-code-'.(++self::$sequence));
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private static function donation(array $attributes): Donation
    {
        $donationId = $attributes['donation_id'];

        return $donationId instanceof Donation ? $donationId : Donation::query()->whereKey($donationId)->firstOrFail();
    }
}
