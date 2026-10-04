<?php

namespace App\Domain\Anon\Models;

use App\Domain\Hooks\Models\Hook;
use Carbon\CarbonImmutable;
use Database\Factories\AnonDeviceFactory;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Laravel\Sanctum\HasApiTokens;

/**
 * An attested anonymous recipient device. Holds no personal data.
 *
 * It is the tokenable of anon session tokens (ability `anon`). As an authenticated
 * principal it deliberately has no identifier: request logs and other guard consumers
 * never attribute a request to a device.
 *
 * @property string $id
 * @property string $anon_id
 * @property DevicePlatform $platform
 * @property CarbonImmutable|null $attested_at
 * @property string|null $attestation_verdict
 * @property CarbonImmutable|null $banned_at
 * @property CarbonImmutable|null $last_seen_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(AnonDeviceFactory::class)]
class AnonDevice extends Model implements Authenticatable
{
    /** @use HasFactory<AnonDeviceFactory> */
    use HasApiTokens, HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'platform' => DevicePlatform::class,
            'attested_at' => 'immutable_datetime',
            'banned_at' => 'immutable_datetime',
            'last_seen_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    public function isBanned(): bool
    {
        return $this->banned_at !== null;
    }

    public function getAuthIdentifierName(): string
    {
        return 'anon_id';
    }

    /**
     * Never exposes the device: guards and log lines see no identifier.
     */
    public function getAuthIdentifier(): mixed
    {
        return null;
    }

    public function getAuthPasswordName(): string
    {
        return 'password';
    }

    public function getAuthPassword(): string
    {
        return '';
    }

    public function getRememberToken(): string
    {
        return '';
    }

    public function setRememberToken($value): void
    {
        // Anon devices have no remember-me cookie.
    }

    public function getRememberTokenName(): string
    {
        return '';
    }

    /**
     * @return HasMany<AnonDailyCounter, $this>
     */
    public function dailyCounters(): HasMany
    {
        return $this->hasMany(AnonDailyCounter::class, 'anon_id', 'anon_id');
    }

    /**
     * @return HasMany<Hook, $this>
     */
    public function hooks(): HasMany
    {
        return $this->hasMany(Hook::class, 'anon_id', 'anon_id');
    }
}
