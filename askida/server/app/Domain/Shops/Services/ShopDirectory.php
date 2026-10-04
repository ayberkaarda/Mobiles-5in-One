<?php

namespace App\Domain\Shops\Services;

use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Read side of the shop catalog for donors and recipients: verified shops only, counts
 * of AVAILABLE units only (never hook ids or reservation data). Every spatial value is
 * a bound parameter.
 */
final class ShopDirectory
{
    /**
     * Verified shops within $radius metres of $point, nearest first, with a keyset cursor
     * over (distance, id).
     *
     * @return array{shops: Collection<int, Shop>, next_cursor: string|null}
     */
    public function near(GeoPoint $point, int $radius, bool $onlyAvailable, int $limit, ?string $cursor): array
    {
        $query = Shop::query()
            ->verified()
            ->withinMeters($point, $radius)
            ->orderByDistance($point)
            ->orderBy('shops.id')
            ->withCount(['hooks as available_count' => fn (Builder $hooks) => $this->availableUnits($hooks)]);

        $this->applySamplePolicy($query);

        if ($onlyAvailable) {
            $query->whereHas('hooks', fn (Builder $hooks) => $this->availableUnits($hooks));
        }

        if ($cursor !== null) {
            [$distance, $id] = self::decodeCursor($cursor);

            $query->whereRaw(
                '(ST_Distance(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography), shops.id) > (?, ?::uuid)',
                [$point->longitude, $point->latitude, $distance, $id],
            );
        }

        /** @var Collection<int, Shop> $shops */
        $shops = $query->limit($limit + 1)->get();
        $next = null;

        if ($shops->count() > $limit) {
            $shops = $shops->take($limit)->values();
            $last = $shops->last();

            if ($last instanceof Shop) {
                $next = self::encodeCursor((float) $last->getAttribute('distance_m'), $last->id);
            }
        }

        return ['shops' => $shops, 'next_cursor' => $next];
    }

    /**
     * Active items of a shop with their AVAILABLE unit counts.
     *
     * @return Collection<int, Item>
     */
    public function itemsWithAvailability(Shop $shop): Collection
    {
        /** @var HasMany<Item, Shop> $items */
        $items = $shop->items();

        return $items
            ->where('active', true)
            ->withCount(['hooks as available_count' => fn (Builder $hooks) => $hooks->where('status', HookStatus::Available->value)])
            ->orderBy('name')
            ->orderBy('id')
            ->get();
    }

    /**
     * Whether `is_sample` rows may be listed: only outside production and only when
     * ALLOW_SAMPLE_SHOPS is on.
     */
    public function samplesAllowed(): bool
    {
        return ! app()->environment('production') && (bool) config('askida.allow_sample_shops', false);
    }

    /**
     * @param  Builder<Shop>  $query
     */
    public function applySamplePolicy(Builder $query): void
    {
        if (! $this->samplesAllowed()) {
            $query->where('shops.is_sample', false);
        }
    }

    /**
     * AVAILABLE units of active items.
     *
     * @param  Builder<Hook>  $hooks
     */
    private function availableUnits(Builder $hooks): void
    {
        $hooks->where('status', HookStatus::Available->value)
            ->whereHas('item', fn (Builder $item) => $item->where('active', true));
    }

    private static function encodeCursor(float $distance, string $id): string
    {
        return rtrim(strtr(base64_encode((string) json_encode([$distance, $id])), '+/', '-_'), '=');
    }

    /**
     * @return array{0: float, 1: string}
     */
    private static function decodeCursor(string $cursor): array
    {
        $json = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = is_string($json) ? json_decode($json, true) : null;

        if (! is_array($value)
            || count($value) !== 2
            || ! is_int($value[0]) && ! is_float($value[0])
            || ! is_string($value[1])
            || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $value[1]) !== 1) {
            throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: [['field' => 'cursor', 'code' => 'invalid']]);
        }

        return [(float) $value[0], $value[1]];
    }
}
