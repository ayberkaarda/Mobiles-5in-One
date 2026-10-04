<?php

namespace Tests\Feature\Web\Directory\Support;

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/**
 * Fixtures of the public directory tests: listed shops (verified + listed_on_web) with
 * items and AVAILABLE units, and the shops that must never appear.
 */
final class DirectoryWorld
{
    public const HOURS = [
        'mon' => ['open' => '08:00', 'close' => '20:00'],
        'tue' => ['open' => '08:00', 'close' => '20:00'],
        'wed' => ['open' => '08:00', 'close' => '20:00'],
        'thu' => ['open' => '08:00', 'close' => '20:00'],
        'fri' => ['open' => '08:00', 'close' => '20:00'],
        'sat' => ['open' => '09:00', 'close' => '18:00'],
        'sun' => null,
    ];

    /**
     * A verified shop listed on the web (Kadıköy, İstanbul unless overridden).
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function listed(array $attributes = [], ShopVerificationState $state = ShopVerificationState::Verified): Shop
    {
        return ShopTestKit::shop(null, $state, $attributes);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function item(Shop $shop, int $available = 0, array $attributes = []): Item
    {
        $item = ShopTestKit::item($shop, $attributes);

        if ($available > 0) {
            HookWorld::availableHooks($item, $available);
        }

        return $item;
    }

    /**
     * A listed bakery with hours, three items and units hanging on two of them.
     */
    public static function bakery(array $attributes = []): Shop
    {
        $shop = self::listed([
            'name' => 'Çınar Fırını',
            'slug' => 'cinar-firini-kadikoy',
            'address' => 'Moda Caddesi No: 12, Caferağa',
            'phone' => '+902165550102',
            'opening_hours' => self::HOURS,
            ...$attributes,
        ]);

        self::item($shop, 3, ['name' => 'Ekmek', 'price_minor' => 1500]);
        self::item($shop, 2, ['name' => 'Simit', 'price_minor' => 1250]);
        self::item($shop, 0, ['name' => 'Poğaça', 'price_minor' => 2000]);

        return $shop;
    }

    public static function at(float $lat, float $lng): GeoPoint
    {
        return new GeoPoint($lat, $lng);
    }
}
