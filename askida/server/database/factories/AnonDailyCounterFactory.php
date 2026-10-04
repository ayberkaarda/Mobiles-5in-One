<?php

namespace Database\Factories;

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AnonDailyCounter>
 */
class AnonDailyCounterFactory extends Factory
{
    protected $model = AnonDailyCounter::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'anon_id' => fn () => AnonDevice::factory()->create()->anon_id,
            'day' => now()->toDateString(),
            'count' => 0,
            'per_shop' => [],
        ];
    }
}
