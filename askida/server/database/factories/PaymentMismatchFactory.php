<?php

namespace Database\Factories;

use App\Domain\Donations\Models\Donation;
use App\Domain\Payments\Models\PaymentMismatch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PaymentMismatch>
 */
class PaymentMismatchFactory extends Factory
{
    protected $model = PaymentMismatch::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'donation_id' => Donation::factory(),
            'kind' => 'amount_mismatch',
            'ours' => ['status' => 'initiated', 'amount_minor' => 10_000],
            'theirs' => ['status' => 'success', 'amount_minor' => 9_000],
            'detected_at' => now(),
            'resolved_at' => null,
            'resolved_by' => null,
            'resolution_note' => null,
        ];
    }
}
