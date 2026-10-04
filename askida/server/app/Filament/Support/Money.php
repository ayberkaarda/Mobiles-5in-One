<?php

namespace App\Filament\Support;

/**
 * Kuruş amounts as Turkish lira text for panel tables.
 */
final class Money
{
    public static function format(int $minor): string
    {
        return number_format($minor / 100, 2, ',', '.').' ₺';
    }
}
