<?php

namespace App\Domain\Hooks\Services;

use Carbon\CarbonImmutable;

/**
 * Caps and redemption lists use calendar days of Europe/Istanbul, whatever the
 * application or database time zone is.
 */
final class HookDay
{
    public const TIMEZONE = 'Europe/Istanbul';

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable} start (inclusive) and end (exclusive)
     */
    public static function bounds(CarbonImmutable $instant): array
    {
        $start = $instant->setTimezone(self::TIMEZONE)->startOfDay();

        return [$start, $start->addDay()];
    }

    public static function date(CarbonImmutable $instant): string
    {
        return $instant->setTimezone(self::TIMEZONE)->toDateString();
    }

    public static function parse(string $date): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d', $date, self::TIMEZONE) ?: CarbonImmutable::now(self::TIMEZONE)->startOfDay();
    }
}
