<?php

namespace App\Filament\Support;

use App\Domain\Shops\Models\Shop;

/**
 * Tax number and IBAN as the panel shows them: the last four characters only. The
 * decrypted value stays inside this method; only the masked string reaches a column,
 * an entry or the Livewire state.
 */
final class ShopFinancialMask
{
    public const PREFIX = '•••• ';

    public static function taxNumber(Shop $shop): string
    {
        return self::lastFour($shop->tax_number_enc);
    }

    public static function iban(Shop $shop): string
    {
        return self::lastFour($shop->iban_enc);
    }

    private static function lastFour(?string $value): string
    {
        $value = $value === null ? '' : preg_replace('/\s+/', '', $value) ?? '';

        if (strlen($value) < 8) {
            return '—';
        }

        return self::PREFIX.substr($value, -4);
    }
}
