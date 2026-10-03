<?php

namespace Database\Factories;

use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Auth\Models\DeletionRequestStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeletionRequest>
 */
class DeletionRequestFactory extends Factory
{
    protected $model = DeletionRequest::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'channel' => DeletionChannel::App,
            'status' => DeletionRequestStatus::Pending,
            'requested_at' => now(),
            'grace_until' => now()->addDays(7),
            'completed_at' => null,
            'cancelled_at' => null,
        ];
    }
}
