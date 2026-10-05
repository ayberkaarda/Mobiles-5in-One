<?php

namespace App\Domain\Payments\Models;

use App\Domain\Donations\Models\Donation;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The refund operation of one donation (at most one row per donation). Written by
 * RefundService only, always under the donation row lock.
 *
 * @property string $id
 * @property string $donation_id
 * @property DonationRefundStatus $status
 * @property int $units
 * @property int $amount_minor
 * @property int $commission_minor
 * @property int $attempts
 * @property string|null $provider_refund_id
 * @property CarbonImmutable $claimed_at
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class DonationRefund extends Model
{
    use HasUuids;

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
            'status' => DonationRefundStatus::class,
            'units' => 'integer',
            'amount_minor' => 'integer',
            'commission_minor' => 'integer',
            'attempts' => 'integer',
            'claimed_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
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
}
