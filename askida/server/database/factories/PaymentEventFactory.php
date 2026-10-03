<?php

namespace Database\Factories;

use App\Domain\Payments\Models\PaymentEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PaymentEvent>
 */
class PaymentEventFactory extends Factory
{
    protected $model = PaymentEvent::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'provider' => 'fake',
            'event_id' => sprintf('sample-event-%06d', $n),
            'payload_hash' => hash('sha256', 'sample-payload-'.$n),
            'received_at' => now(),
            'processed_at' => null,
        ];
    }
}
