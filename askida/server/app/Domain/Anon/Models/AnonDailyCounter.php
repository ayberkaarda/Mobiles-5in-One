<?php

namespace App\Domain\Anon\Models;

use Carbon\CarbonImmutable;
use Database\Factories\AnonDailyCounterFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Aggregate reserve count of one anonymous device on one day; `per_shop` maps shop ids
 * to unit counts.
 *
 * @property string $id
 * @property string $anon_id
 * @property CarbonImmutable $day
 * @property int $count
 * @property array<string, int> $per_shop
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(AnonDailyCounterFactory::class)]
class AnonDailyCounter extends Model
{
    /** @use HasFactory<AnonDailyCounterFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'count' => 0,
        'per_shop' => '{}',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'day' => 'immutable_date',
            'count' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * Stored as a JSON object (shop id => units), also when empty.
     *
     * @return Attribute<array<string, int>, array<string, int>>
     */
    protected function perShop(): Attribute
    {
        return Attribute::make(
            get: function (mixed $value): array {
                $decoded = is_string($value) ? json_decode($value, true, 4, JSON_THROW_ON_ERROR) : [];

                return is_array($decoded) ? array_map('intval', $decoded) : [];
            },
            set: fn (array $value): string => json_encode((object) $value, JSON_THROW_ON_ERROR),
        );
    }

    /**
     * @return BelongsTo<AnonDevice, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(AnonDevice::class, 'anon_id', 'anon_id');
    }
}
