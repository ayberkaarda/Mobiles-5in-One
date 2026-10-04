<?php

namespace App\Domain\Fraud\Models;

use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\AbuseFlagFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A fraud scan finding for one shop. `detail` holds counters and thresholds only, no
 * personal data.
 *
 * @property string $id
 * @property string $shop_id
 * @property string $kind
 * @property array<string, mixed> $detail
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $reviewed_at
 * @property string|null $reviewer_id
 */
#[UseFactory(AbuseFlagFactory::class)]
class AbuseFlag extends Model
{
    /** @use HasFactory<AbuseFlagFactory> */
    use HasFactory, HasUuids;

    public const UPDATED_AT = null;

    /**
     * Written by server code only.
     *
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'detail' => 'array',
            'created_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Shop, $this>
     */
    public function shop(): BelongsTo
    {
        return $this->belongsTo(Shop::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }
}
