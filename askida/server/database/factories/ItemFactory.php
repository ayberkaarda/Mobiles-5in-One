<?php

namespace Database\Factories;

use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\Shop;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Item>
 */
class ItemFactory extends Factory
{
    protected $model = Item::class;

    private static int $sequence = 0;

    /**
     * Name, category and price in kuruş.
     *
     * @var list<array{0: string, 1: ItemCategory, 2: int}>
     */
    private const CATALOG = [
        ['Ekmek', ItemCategory::Ekmek, 1_500],
        ['Mercimek çorbası', ItemCategory::Corba, 6_000],
        ['Günün yemeği', ItemCategory::Yemek, 12_000],
        ['Defter', ItemCategory::Kirtasiye, 4_500],
        ['Bebek bezi', ItemCategory::Bebek, 35_000],
        ['Su', ItemCategory::Diger, 1_000],
    ];

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;
        [$name, $category, $price] = self::CATALOG[$n % count(self::CATALOG)];

        return [
            'shop_id' => Shop::factory(),
            'name' => $name,
            'category' => $category,
            'price_minor' => $price,
            'currency' => 'TRY',
            'daily_cap' => 5 + ($n % 4) * 5,
            'active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['active' => false]);
    }
}
