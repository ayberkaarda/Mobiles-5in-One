<?php

namespace Database\Factories;

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DevicePushToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DevicePushToken>
 */
class DevicePushTokenFactory extends Factory
{
    protected $model = DevicePushToken::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'user_id' => User::factory(),
            'platform' => DevicePlatform::Android,
            'token' => sprintf('sample-push-registration-%06d', $n),
            'last_used_at' => null,
        ];
    }
}
