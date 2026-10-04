<?php

namespace App\Support\Web;

use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\ShopType;

/**
 * Path data of the brand pictograms (askida/brand/icons, 24 grid, stroke 1.75, round caps)
 * for inline SVG on the public pages. Pictograms never show people.
 */
final class Pictograms
{
    public const PATHS = [
        'ekmek' => 'M3 15.5C3 10.6 6.6 8 12 8s9 2.6 9 7.5c0 2.6-2.4 3.5-9 3.5s-9-.9-9-3.5Z M8 14l1.6-2.2 M11.2 14l1.6-2.2 M14.4 14l1.6-2.2',
        'corba' => 'M3 11h18c0 4.4-3.6 8-9 8s-9-3.6-9-8Z M9 21h6 M9.5 3c-1.2 1.3 1.2 2.7 0 4.5 M14.5 3c-1.2 1.3 1.2 2.7 0 4.5',
        'yemek' => 'M3 17.5h18 M5 17.5a7 7 0 0 1 14 0 M12 10.5V8.5 M10.5 8.5h3 M5 20.5h14',
        'kirtasiye' => 'M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7Z M7 3v18 M4 7h3 M4 12h3 M4 17h3 M11 8h5 M11 12h5',
        'bebek' => 'M10.75 7.5V5.25a1.25 1.25 0 0 1 2.5 0V7.5 M8.5 7.5h7V10h-7Z M9 10h6v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z M12 13.5h3 M12 16.5h3',
        'diger' => 'M4 8l8-4 8 4v8l-8 4-8-4Z M4 8l8 4 8-4 M12 12v8',
        'tag' => 'M12 3v4 M9 7H15a3 3 0 0 1 3 3V18a3 3 0 0 1 -3 3H9a3 3 0 0 1 -3 -3V10a3 3 0 0 1 3 -3Z M12 12a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3Z',
        'location' => 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z M12 12.2a2.2 2.2 0 1 0 0-4.4a2.2 2.2 0 0 0 0 4.4Z',
        // Lucide "check" (ISC), used for the verified line.
        'check' => 'M20 6 9 17l-5-5',
    ];

    public static function path(string $name): string
    {
        return self::PATHS[$name] ?? self::PATHS['diger'];
    }

    /**
     * Pictogram of a shop's main category, by shop type.
     */
    public static function forShopType(ShopType|string|null $type): string
    {
        $type = is_string($type) ? ShopType::tryFrom($type) : $type;

        return match ($type) {
            ShopType::Bakery => 'ekmek',
            ShopType::Restaurant => 'yemek',
            ShopType::Cafe => 'corba',
            ShopType::Stationery => 'kirtasiye',
            default => 'diger',
        };
    }

    public static function forCategory(ItemCategory|string $category): string
    {
        $value = $category instanceof ItemCategory ? $category->value : $category;

        return array_key_exists($value, self::PATHS) ? $value : 'diger';
    }
}
