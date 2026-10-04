<?php

namespace App\Domain\Donations\Models;

use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\DonationFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A prepaid donation of `qty` units of one item. Amounts are kuruş (TRY minor units)
 * and are computed by the server, never taken from the client.
 *
 * @property string $id
 * @property string|null $donor_id
 * @property string $shop_id
 * @property string $item_id
 * @property int $qty
 * @property int $amount_minor
 * @property int $commission_minor
 * @property string $currency
 * @property string $provider
 * @property string|null $provider_payment_id
 * @property string|null $provider_token
 * @property DonationStatus $status
 * @property CarbonImmutable|null $paid_at
 * @property CarbonImmutable|null $hooks_issued_at
 * @property string|null $conversation_id
 * @property CarbonImmutable|null $anonymized_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(DonationFactory::class)]
class Donation extends Model
{
    /** @use HasFactory<DonationFactory> */
    use HasFactory, HasUuids;

    /**
     * Only the donor's choice is mass assignable; donor, amounts, provider data and
     * status are set by server code.
     *
     * @var list<string>
     */
    protected $fillable = [
        'shop_id',
        'item_id',
        'qty',
    ];

    /**
     * @var list<string>
     */
    protected $hidden = [
        'provider_token',
        'conversation_id',
    ];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'currency' => 'TRY',
        'commission_minor' => 0,
        'status' => 'initiated',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'qty' => 'integer',
            'amount_minor' => 'integer',
            'commission_minor' => 'integer',
            'status' => DonationStatus::class,
            'paid_at' => 'immutable_datetime',
            'hooks_issued_at' => 'immutable_datetime',
            'anonymized_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function donor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'donor_id');
    }

    /**
     * @return BelongsTo<Shop, $this>
     */
    public function shop(): BelongsTo
    {
        return $this->belongsTo(Shop::class);
    }

    /**
     * @return BelongsTo<Item, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    /**
     * @return HasMany<Hook, $this>
     */
    public function hooks(): HasMany
    {
        return $this->hasMany(Hook::class);
    }
}
