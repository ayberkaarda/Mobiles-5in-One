<?php

namespace App\Domain\Web\Content;

use App\Support\Web\Facts;
use App\Support\Web\Format;
use InvalidArgumentException;

/**
 * Fills `{{token}}` placeholders of the Markdown sources from {@see Facts}, so that no copy
 * can hard-code a number the API enforces (caps, validity, radius, commission).
 */
final class FactTokens
{
    /**
     * @return array<string, string> token name => text
     */
    public static function values(): array
    {
        return [
            'commission' => Facts::commissionLabel(),
            'code_length' => (string) Facts::codeLength(),
            'code_valid_minutes' => (string) Facts::codeValidMinutes(),
            'anon_daily_cap' => (string) Facts::anonDailyCap(),
            'anon_shop_daily_cap' => (string) Facts::anonShopDailyCap(),
            'radius_default_km' => self::km(Facts::radiusDefaultM()),
            'radius_max_km' => self::km(Facts::radiusMaxM()),
            'qty_max' => (string) Facts::qtyMax(),
            'tx_cap' => Format::money(Facts::txCapMinor()),
            'day_cap' => Format::money(Facts::dayCapMinor()),
            'kvkk_version' => Facts::KVKK_TEXT_VERSION,
            'legal_name' => Facts::LEGAL_NAME,
        ];
    }

    /**
     * @throws InvalidArgumentException for a token that is not defined
     */
    public static function replace(string $text): string
    {
        $values = self::values();

        return (string) preg_replace_callback(
            '/\{\{\s*([a-z_]+)\s*\}\}/',
            static fn (array $match): string => $values[$match[1]] ?? throw new InvalidArgumentException('Unknown fact token: '.$match[1]),
            $text,
        );
    }

    private static function km(int $meters): string
    {
        return rtrim(rtrim(number_format($meters / 1000, 1, ',', ''), '0'), ',');
    }
}
