<?php

namespace App\Domain\Web\Directory;

use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\ShopDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Read side of the public web directory. A shop is public only when it is verified AND
 * listed on the web by its owner (sample shops only where samples are allowed); every
 * other shop is invisible here, so its pages answer 404. Only public columns are read:
 * never the owner, documents, tax number, IBAN or any data about people.
 */
final class DirectoryQuery
{
    /** Route pattern of shop, province and district slugs. */
    public const SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

    /** Shop cards per district page; keeps the page inside its HTML budget. */
    public const PER_PAGE = 30;

    /** Columns a public page may show. */
    private const COLUMNS = [
        'shops.id', 'shops.slug', 'shops.name', 'shops.type', 'shops.address', 'shops.il', 'shops.ilce',
        'shops.il_slug', 'shops.ilce_slug', 'shops.location', 'shops.phone', 'shops.opening_hours',
        'shops.is_sample', 'shops.updated_at',
    ];

    public function __construct(private readonly ShopDirectory $directory) {}

    /**
     * Whether a shop meets the listing rule (ignoring the sample policy, which is
     * configuration rather than shop state).
     */
    public static function isListed(Shop $shop): bool
    {
        return $shop->verification_state === ShopVerificationState::Verified && $shop->listed_on_web;
    }

    /**
     * @return Builder<Shop>
     */
    public function publicShops(): Builder
    {
        $query = Shop::query()
            ->select(self::COLUMNS)
            ->where('shops.verification_state', ShopVerificationState::Verified->value)
            ->where('shops.listed_on_web', true);

        $this->directory->applySamplePolicy($query);

        return $query;
    }

    public function shop(string $slug): ?Shop
    {
        /** @var Shop|null $shop */
        $shop = $this->publicShops()->where('shops.slug', $slug)->first();

        return $shop;
    }

    /**
     * Active items of a public shop with their AVAILABLE unit counts.
     *
     * @return Collection<int, Item>
     */
    public function items(Shop $shop): Collection
    {
        return $this->directory->itemsWithAvailability($shop);
    }

    /**
     * Districts of a province that have public shops: name, slug, shop count and the
     * AVAILABLE units of their active items. Null when the province has none.
     *
     * @return array{il: string, districts: list<array{name: string, slug: string, shops: int, available: int}>}|null
     */
    public function province(string $ilSlug): ?array
    {
        /** @var Collection<int, Shop> $shops */
        $shops = $this->withAvailable($this->publicShops()->where('shops.il_slug', $ilSlug))
            ->orderBy('shops.ilce_slug')
            ->orderBy('shops.id')
            ->get();

        if ($shops->isEmpty()) {
            return null;
        }

        $districts = [];

        foreach ($shops as $shop) {
            $slug = $shop->ilce_slug;
            $districts[$slug] ??= ['name' => $shop->ilce, 'slug' => $slug, 'shops' => 0, 'available' => 0];
            $districts[$slug]['shops']++;
            $districts[$slug]['available'] += (int) $shop->getAttribute('available_count');
        }

        return ['il' => $shops->firstOrFail()->il, 'districts' => array_values($districts)];
    }

    /**
     * Public shops of one district, by name, with their AVAILABLE units. Null when the
     * district has none.
     *
     * @return array{il: string, ilce: string, available: int, shops: LengthAwarePaginator<int, Shop>}|null
     */
    public function district(string $ilSlug, string $ilceSlug, int $page): ?array
    {
        $base = $this->publicShops()
            ->where('shops.il_slug', $ilSlug)
            ->where('shops.ilce_slug', $ilceSlug);

        $total = (clone $base)->count();

        if ($total === 0) {
            return null;
        }

        /** @var LengthAwarePaginator<int, Shop> $shops */
        $shops = $this->withAvailable(clone $base)
            ->orderBy('shops.name')
            ->orderBy('shops.id')
            ->paginate(self::PER_PAGE, ['*'], 'sayfa', $page);

        $available = Hook::query()
            ->where('status', HookStatus::Available->value)
            ->whereHas('item', static fn (Builder $item) => $item->where('active', true))
            ->whereIn('shop_id', (clone $base)->select('shops.id'))
            ->count();

        /** @var Shop $first */
        $first = $shops->getCollection()->first() ?? (clone $base)->firstOrFail();

        return ['il' => $first->il, 'ilce' => $first->ilce, 'available' => $available, 'shops' => $shops];
    }

    /**
     * Sitemap rows: every public shop and every district with public shops, with the
     * time of their latest change.
     *
     * @return array{shops: list<array{slug: string, updated_at: CarbonImmutable|null}>, districts: list<array{il_slug: string, ilce_slug: string, updated_at: CarbonImmutable|null}>, provinces: list<array{il_slug: string, updated_at: CarbonImmutable|null}>}
     */
    public function sitemap(): array
    {
        $shops = [];
        $districts = [];
        $provinces = [];

        /** @var Shop $shop */
        foreach ($this->publicShops()->orderBy('shops.slug')->cursor() as $shop) {
            $updated = $shop->updated_at;
            $shops[] = ['slug' => $shop->slug, 'updated_at' => $updated];

            $district = $shop->il_slug.'/'.$shop->ilce_slug;
            $districts[$district] = [
                'il_slug' => $shop->il_slug,
                'ilce_slug' => $shop->ilce_slug,
                'updated_at' => self::latest($districts[$district]['updated_at'] ?? null, $updated),
            ];
            $provinces[$shop->il_slug] = [
                'il_slug' => $shop->il_slug,
                'updated_at' => self::latest($provinces[$shop->il_slug]['updated_at'] ?? null, $updated),
            ];
        }

        ksort($districts);
        ksort($provinces);

        return ['shops' => $shops, 'districts' => array_values($districts), 'provinces' => array_values($provinces)];
    }

    /**
     * @param  Builder<Shop>  $query
     * @return Builder<Shop>
     */
    private function withAvailable(Builder $query): Builder
    {
        return $query->withCount(['hooks as available_count' => static function (Builder $hooks): void {
            $hooks->where('status', HookStatus::Available->value)
                ->whereHas('item', static fn (Builder $item) => $item->where('active', true));
        }]);
    }

    private static function latest(?CarbonImmutable $a, ?CarbonImmutable $b): ?CarbonImmutable
    {
        if ($a === null) {
            return $b;
        }

        if ($b === null) {
            return $a;
        }

        return $a->greaterThan($b) ? $a : $b;
    }
}
