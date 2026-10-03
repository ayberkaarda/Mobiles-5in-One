<?php

namespace App\Domain\Anon\Models;

use App\Domain\Hooks\Models\Hook;
use Carbon\CarbonImmutable;
use Database\Factories\AnonDeviceFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An attested anonymous recipient device. Holds no personal data.
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
class AnonDevice extends Model
{
    /** @use HasFactory<AnonDeviceFactory> */
    use HasFactory, HasUuids;

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
