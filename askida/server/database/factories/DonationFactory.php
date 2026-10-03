<?php

namespace Database\Factories;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Items\Models\Item;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Amounts follow the item price (price x qty), as the server computes them.
 *
 * @extends Factory<Donation>
 */
class DonationFactory extends Factory
{
    protected $model = Donation::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'donor_id' => User::factory()->state(['kind' => 'donor']),
            'item_id' => Item::factory(),
            'shop_id' => fn (array $attributes) => self::item($attributes)->shop_id,
            'qty' => 1 + ($n % 3),
            'amount_minor' => fn (array $attributes) => self::item($attributes)->price_minor * (int) $attributes['qty'],
            'commission_minor' => 0,
            'currency' => 'TRY',
            'provider' => 'fake',
            'provider_payment_id' => null,
            'provider_token' => null,
            'status' => DonationStatus::Initiated,
            'paid_at' => null,
            'anonymized_at' => null,
        ];
    }

    public function paid(): static
    {
        return $this->state(fn () => [
            'status' => DonationStatus::Paid,
            'paid_at' => now(),
            'provider_payment_id' => sprintf('sample-payment-%06d', ++self::$sequence),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private static function item(array $attributes): Item
    {
        $itemId = $attributes['item_id'];

        return $itemId instanceof Item ? $itemId : Item::query()->whereKey($itemId)->firstOrFail();
    }
}
