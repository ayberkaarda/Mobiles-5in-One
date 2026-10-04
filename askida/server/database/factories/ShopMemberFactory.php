<?php

namespace Database\Factories;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ShopMember>
 */
class ShopMemberFactory extends Factory
{
    protected $model = ShopMember::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'shop_id' => Shop::factory(),
            'user_id' => User::factory()->state(['kind' => 'merchant']),
            'role' => ShopMemberRole::Staff,
        ];
    }

    public function owner(): static
    {
        return $this->state(fn () => ['role' => ShopMemberRole::Owner]);
    }
}
