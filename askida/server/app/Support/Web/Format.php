<?php

namespace App\Support\Web;

use Carbon\CarbonInterface;

/**
 * Turkish number, money and date formatting for the public pages.
 */
final class Format
{
    /**
     * Minor units (kuruş) as a price: 4500 -> "₺45,00", 124000000 -> "₺1.240.000,00".
     */
    public static function money(int $minor): string
    {
        $sign = $minor < 0 ? '-' : '';

        return $sign.'₺'.number_format(abs($minor) / 100, 2, ',', '.');
    }

    /**
     * A count of items: 1240 -> "1.240".
     */
    public static function count(int $value): string
    {
        return number_format($value, 0, ',', '.');
    }

    /**
     * A calendar date in Turkish: "4 Ekim 2026".
     */
    public static function date(CarbonInterface $date): string
    {
        return $date->locale('tr')->translatedFormat('j F Y');
    }

    /**
     * Date and time in Turkish: "4 Ekim 2026, 09:41".
     */
    public static function dateTime(CarbonInterface $date): string
    {
        return $date->locale('tr')->translatedFormat('j F Y, H:i');
    }

    /**
     * Number of whitespace separated words, the measure of the answer paragraph rule.
     */
    public static function words(string $text): int
    {
        $parts = preg_split('/\s+/u', trim(strip_tags($text)), -1, PREG_SPLIT_NO_EMPTY);

        return $parts === false ? 0 : count($parts);
    }
}
