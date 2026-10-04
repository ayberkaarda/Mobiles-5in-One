<?php

namespace App\Domain\Shops\Models;

/**
 * Business types a merchant can register.
 */
enum ShopType: string
{
    case Bakery = 'bakery';
    case Restaurant = 'restaurant';
    case Grocery = 'grocery';
    case Stationery = 'stationery';
    case Cafe = 'cafe';
    case Other = 'other';

    /**
     * Turkish display label.
     */
    public function label(): string
    {
        return match ($this) {
            self::Bakery => 'Fırın',
            self::Restaurant => 'Lokanta',
            self::Grocery => 'Bakkal / market',
            self::Stationery => 'Kırtasiye',
            self::Cafe => 'Kafe',
            self::Other => 'Diğer',
        };
    }
}
