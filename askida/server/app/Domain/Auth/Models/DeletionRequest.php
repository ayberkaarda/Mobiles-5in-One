<?php

namespace App\Domain\Auth\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\DeletionRequestFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An account deletion request. Holds no personal data; `user_id` becomes NULL once the
 * user row is hard deleted.
 *
 * @property string $id
 * @property string|null $user_id
 * @property DeletionChannel $channel
 * @property DeletionRequestStatus $status
 * @property CarbonImmutable $requested_at
 * @property CarbonImmutable $grace_until
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(DeletionRequestFactory::class)]
class DeletionRequest extends Model
{
    /** @use HasFactory<DeletionRequestFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => 'pending',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'channel' => DeletionChannel::class,
            'status' => DeletionRequestStatus::class,
            'requested_at' => 'immutable_datetime',
            'grace_until' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
