<?php

namespace App\Domain\Web\Directory;

use App\Domain\Shops\Models\ShopType;

/**
 * Shop type as the public directory presents it: the Turkish label, the pictogram and the
 * schema.org LocalBusiness subtype. The `type` column holds ShopType values; rows written
 * before the enum existed (the sample seeder's Turkish nouns such as `firin`) are mapped
 * to the matching type so they never surface as raw strings.
 */
final class ShopKind
{
    private const LEGACY = [
        'firin' => ShopType::Bakery,
        'lokanta' => ShopType::Restaurant,
        'corbaci' => ShopType::Restaurant,
        'kafe' => ShopType::Cafe,
        'bakkal' => ShopType::Grocery,
        'market' => ShopType::Grocery,
        'kirtasiye' => ShopType::Stationery,
    ];

    public static function of(string $type): ShopType
    {
        return ShopType::tryFrom($type) ?? self::LEGACY[$type] ?? ShopType::Other;
    }

    public static function label(string $type): string
    {
        return self::of($type)->label();
    }

    /**
     * schema.org subtype of LocalBusiness for the shop page JSON-LD.
     */
    public static function schemaType(string $type): string
    {
        return match (self::of($type)) {
            ShopType::Bakery => 'Bakery',
            ShopType::Restaurant => 'Restaurant',
            ShopType::Cafe => 'CafeOrCoffeeShop',
            ShopType::Grocery => 'GroceryStore',
            ShopType::Stationery, ShopType::Other => 'Store',
        };
    }
}
