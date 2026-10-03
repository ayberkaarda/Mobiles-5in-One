<?php

namespace App\Domain\Hooks\Models;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\HookFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One prepaid unit ("askı"). State changes belong to the reserve, redeem and expiry
 * engines; nothing here is mass assignable.
 *
 * @property string $id
 * @property string $donation_id
 * @property string $shop_id
 * @property string $item_id
 * @property HookStatus $status
 * @property string|null $anon_id
 * @property string|null $code_hash
 * @property CarbonImmutable|null $reserved_at
 * @property CarbonImmutable|null $expires_at
 * @property CarbonImmutable|null $redeemed_at
 * @property string|null $redeemed_by_user_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(HookFactory::class)]
class Hook extends Model
{
    /** @use HasFactory<HookFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * Recipient-linked and secret-derived columns never leave the server in a response.
     *
     * @var list<string>
     */
    protected $hidden = [
        'anon_id',
        'code_hash',
    ];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => 'AVAILABLE',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => HookStatus::class,
            'reserved_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'redeemed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Donation, $this>
     */
    public function donation(): BelongsTo
    {
        return $this->belongsTo(Donation::class);
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
     * @return BelongsTo<AnonDevice, $this>
     */
    public function anonDevice(): BelongsTo
    {
        return $this->belongsTo(AnonDevice::class, 'anon_id', 'anon_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function redeemedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'redeemed_by_user_id');
    }
}
