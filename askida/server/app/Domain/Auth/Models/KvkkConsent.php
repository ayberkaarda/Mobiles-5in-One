<?php

namespace App\Domain\Auth\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\KvkkConsentFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Acceptance of a KVKK notice version. `ip_hash` is an HMAC of the client IP with a
 * server pepper; the raw IP is never stored.
 *
 * @property string $id
 * @property string $user_id
 * @property string $text_version
 * @property CarbonImmutable $accepted_at
 * @property string $ip_hash
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(KvkkConsentFactory::class)]
class KvkkConsent extends Model
{
    /** @use HasFactory<KvkkConsentFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'text_version',
    ];

    /**
     * @var list<string>
     */
    protected $hidden = [
        'ip_hash',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'accepted_at' => 'immutable_datetime',
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
