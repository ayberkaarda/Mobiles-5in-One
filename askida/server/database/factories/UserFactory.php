<?php

namespace Database\Factories;

use App\Domain\Auth\Enums\UserKind;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * Plain password every factory user with a password shares; tests read it from here.
     */
    public const PASSWORD = 'factory-pass-phrase';

    /**
     * Hash of PASSWORD, computed once per process.
     */
    protected static ?string $passwordHash = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => Str::lower(fake()->unique()->userName()).'@example.test',
            'email_verified_at' => now(),
            'password' => static::$passwordHash ??= Hash::make(self::PASSWORD),
            'kind' => UserKind::Donor,
        ];
    }

    public function donor(): static
    {
        return $this->state(fn (array $attributes) => ['kind' => UserKind::Donor]);
    }

    public function merchant(): static
    {
        return $this->state(fn (array $attributes) => ['kind' => UserKind::Merchant]);
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => ['email_verified_at' => null]);
    }

    public function appleOnly(): static
    {
        return $this->state(fn (array $attributes) => [
            'password' => null,
            'apple_sub' => 'apple-'.Str::lower(Str::random(12)),
        ]);
    }

    public function googleOnly(): static
    {
        return $this->state(fn (array $attributes) => [
            'password' => null,
            'google_sub' => 'google-'.Str::lower(Str::random(12)),
        ]);
    }

    public function deactivated(): static
    {
        return $this->state(fn (array $attributes) => ['deactivated_at' => now()]);
    }
}
