<?php

namespace Database\Factories;

use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Payout>
 */
class PayoutFactory extends Factory
{
    protected $model = Payout::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'shop_id' => Shop::factory(),
            'provider_settlement_id' => sprintf('sample-settlement-%06d', $n),
            'amount_minor' => 10_000 * (1 + $n % 5),
            'currency' => 'TRY',
            'status' => PayoutStatus::Pending,
            'period' => now()->subDays($n % 28)->toDateString(),
        ];
    }
}
