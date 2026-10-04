<?php

namespace App\Domain\Shops\Models;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Models\Payout;
use App\Models\User;
use App\Support\Web\TurkishSlug;
use Carbon\CarbonImmutable;
use Database\Factories\ShopFactory;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string|null $owner_id
 * @property string $name
 * @property string $slug
 * @property string $type
 * @property string $address
 * @property string $il
 * @property string $ilce
 * @property string $il_slug
 * @property string $ilce_slug
 * @property array<string, array{open: string, close: string}|null>|null $opening_hours
 * @property GeoPoint $location
 * @property string $phone
 * @property string|null $tax_number_enc
 * @property string|null $iban_enc
 * @property string|null $sub_merchant_key
 * @property ShopVerificationState $verification_state
 * @property CarbonImmutable|null $verified_at
 * @property bool $listed_on_web
 * @property bool $is_sample
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[UseFactory(ShopFactory::class)]
class Shop extends Model
{
    /** @use HasFactory<ShopFactory> */
    use HasFactory, HasUuids;

    /**
     * Client-editable fields only. Verification, listing, sample flag, owner and the
     * provider sub-merchant key are set by server code.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'type',
        'address',
        'il',
        'ilce',
        'location',
        'phone',
        'tax_number_enc',
        'iban_enc',
        'opening_hours',
    ];

    /**
     * @var list<string>
     */
    protected $hidden = [
        'tax_number_enc',
        'iban_enc',
        'sub_merchant_key',
    ];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'verification_state' => 'pending',
        'listed_on_web' => false,
        'is_sample' => false,
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'location' => GeoPointCast::class,
            'tax_number_enc' => 'encrypted',
            'iban_enc' => 'encrypted',
            'verification_state' => ShopVerificationState::class,
            'verified_at' => 'immutable_datetime',
            'listed_on_web' => 'boolean',
            'is_sample' => 'boolean',
            'opening_hours' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * Keeps the URL slugs of the province and district (`/dukkanlar/{il}/{ilce}`) in sync
     * with the names on every save.
     */
    protected static function booted(): void
    {
        static::saving(static function (Shop $shop): void {
            $shop->setAttribute('il_slug', mb_substr(TurkishSlug::make((string) $shop->getAttribute('il')), 0, 64));
            $shop->setAttribute('ilce_slug', mb_substr(TurkishSlug::make((string) $shop->getAttribute('ilce')), 0, 64));
        });
    }

    /**
     * Shops whose location lies within the given distance (metres) of a point.
     * Coordinates and distance are bound parameters.
     *
     * @param  Builder<Shop>  $query
     */
    public function scopeWithinMeters(Builder $query, GeoPoint $point, int $meters): void
    {
        $query->whereRaw(
            'ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)',
            [$point->longitude, $point->latitude, $meters],
        );
    }

    /**
     * Adds a `distance_m` column (metres from the given point) and orders by it.
     *
     * @param  Builder<Shop>  $query
     */
    public function scopeOrderByDistance(Builder $query, GeoPoint $point): void
    {
        if ($query->getQuery()->columns === null) {
            $query->select($query->getModel()->getTable().'.*');
        }

        $query
            ->selectRaw(
                'ST_Distance(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS distance_m',
                [$point->longitude, $point->latitude],
            )
            ->orderBy('distance_m');
    }

    /**
     * @param  Builder<Shop>  $query
     */
    public function scopeVerified(Builder $query): void
    {
        $query->where('verification_state', ShopVerificationState::Verified->value);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return HasMany<ShopMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(ShopMember::class);
    }

    /**
     * @return HasMany<ShopDocument, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(ShopDocument::class);
    }

    /**
     * @return HasMany<Item, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(Item::class);
    }

    /**
     * @return HasMany<Donation, $this>
     */
    public function donations(): HasMany
    {
        return $this->hasMany(Donation::class);
    }

    /**
     * @return HasMany<Hook, $this>
     */
    public function hooks(): HasMany
    {
        return $this->hasMany(Hook::class);
    }

    /**
     * @return HasMany<Payout, $this>
     */
    public function payouts(): HasMany
    {
        return $this->hasMany(Payout::class);
    }
}
