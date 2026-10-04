<?php

namespace Database\Factories;

use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Shops\Models\Shop;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AbuseFlag>
 */
class AbuseFlagFactory extends Factory
{
    protected $model = AbuseFlag::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'shop_id' => Shop::factory(),
            'kind' => 'redeem_rate',
            'detail' => ['redeems_last_hour' => 42, 'threshold' => 30],
            'reviewed_at' => null,
            'reviewer_id' => null,
        ];
    }
}
