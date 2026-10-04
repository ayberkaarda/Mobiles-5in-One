<?php

namespace App\Domain\Payments\Models;

use App\Domain\Donations\Models\Donation;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\PaymentMismatchFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A disagreement between our donation record and the provider. `ours` and `theirs` are
 * small state snapshots (status, amounts), never personal data. Unresolved rows are unique
 * per (donation, kind).
 *
 * @property string $id
 * @property string $donation_id
 * @property string $kind
 * @property array<string, mixed> $ours
 * @property array<string, mixed> $theirs
 * @property CarbonImmutable $detected_at
 * @property CarbonImmutable|null $resolved_at
 * @property string|null $resolved_by
 * @property string|null $resolution_note
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(PaymentMismatchFactory::class)]
class PaymentMismatch extends Model
{
    /** @use HasFactory<PaymentMismatchFactory> */
    use HasFactory, HasUuids;

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
            'ours' => 'array',
            'theirs' => 'array',
            'detected_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
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
     * @return BelongsTo<User, $this>
     */
    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
