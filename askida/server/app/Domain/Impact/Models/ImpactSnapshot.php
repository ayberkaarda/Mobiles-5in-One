<?php

namespace App\Domain\Impact\Models;

use Carbon\CarbonImmutable;
use Database\Factories\ImpactSnapshotFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Public district counters for one day: units donated, units redeemed, active shops.
 *
 * @property string $id
 * @property string $il
 * @property string $ilce
 * @property CarbonImmutable $day
 * @property int $donated
 * @property int $redeemed
 * @property int $shops
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(ImpactSnapshotFactory::class)]
class ImpactSnapshot extends Model
{
    /** @use HasFactory<ImpactSnapshotFactory> */
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
            'day' => 'immutable_date',
            'donated' => 'integer',
            'redeemed' => 'integer',
            'shops' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
