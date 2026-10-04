<?php

namespace App\Domain\Shops\Models;

use Carbon\CarbonImmutable;
use Database\Factories\ShopDocumentFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A verification document stored on the private disk; `path` is the object key.
 * `uploaded_at` is null while the upload URL is outstanding and set once the stored
 * object passed the server-side checks.
 *
 * @property string $id
 * @property string $shop_id
 * @property ShopDocumentKind $kind
 * @property string $path
 * @property string $mime
 * @property int $size
 * @property CarbonImmutable|null $reviewed_at
 * @property CarbonImmutable|null $uploaded_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(ShopDocumentFactory::class)]
class ShopDocument extends Model
{
    /** @use HasFactory<ShopDocumentFactory> */
    use HasFactory, HasUuids;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'kind',
    ];

    /**
     * The storage key is never part of a serialized response.
     *
     * @var list<string>
     */
    protected $hidden = [
        'path',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => ShopDocumentKind::class,
            'size' => 'integer',
            'reviewed_at' => 'immutable_datetime',
            'uploaded_at' => 'immutable_datetime',
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
