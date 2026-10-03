<?php

namespace App\Domain\Payments\Models;

use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Database\Factories\PayoutFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A provider settlement to a shop (kuruş). The platform never holds the funds.
 *
 * @property string $id
 * @property string $shop_id
 * @property string|null $provider_settlement_id
 * @property int $amount_minor
 * @property string $currency
 * @property PayoutStatus $status
 * @property CarbonImmutable $period
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(PayoutFactory::class)]
class Payout extends Model
{
    /** @use HasFactory<PayoutFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'currency' => 'TRY',
        'status' => 'pending',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount_minor' => 'integer',
            'status' => PayoutStatus::class,
            'period' => 'immutable_date',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Shop, $this>
     */
    public function shop(): BelongsTo
    {
        return $this->belongsTo(Shop::class);
    }
}
