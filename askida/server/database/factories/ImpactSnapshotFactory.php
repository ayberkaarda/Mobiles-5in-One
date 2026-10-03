<?php

namespace Database\Factories;

use App\Domain\Impact\Models\ImpactSnapshot;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ImpactSnapshot>
 */
class ImpactSnapshotFactory extends Factory
{
    protected $model = ImpactSnapshot::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'il' => 'İstanbul',
            'ilce' => 'Kadıköy',
            // One row per day keeps (il, ilce, day) unique across a test run.
            'day' => now()->subDays($n)->toDateString(),
            'donated' => 10 + $n % 7,
            'redeemed' => 5 + $n % 5,
            'shops' => 1 + $n % 3,
        ];
    }
}
