<?php

namespace App\Domain\Web\Directory;

/**
 * Weekly opening hours of a shop as stored in `shops.opening_hours`:
 * `{mon..sun: {open: "08:00", close: "20:00"} | null}` (null = closed that day). A closing
 * time earlier than the opening time means the shop closes after midnight.
 *
 * @phpstan-type Day array{open: string, close: string}|null
 * @phpstan-type Week array<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', Day>
 */
final class OpeningHours
{
    public const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    public const TIME_PATTERN = '/^(?:[01]\d|2[0-3]):[0-5]\d$/';

    private const LABELS = [
        'mon' => 'Pazartesi',
        'tue' => 'Salı',
        'wed' => 'Çarşamba',
        'thu' => 'Perşembe',
        'fri' => 'Cuma',
        'sat' => 'Cumartesi',
        'sun' => 'Pazar',
    ];

    private const SCHEMA_DAYS = [
        'mon' => 'Monday',
        'tue' => 'Tuesday',
        'wed' => 'Wednesday',
        'thu' => 'Thursday',
        'fri' => 'Friday',
        'sat' => 'Saturday',
        'sun' => 'Sunday',
    ];

    /**
     * The validated request value as stored: every day present, in week order; days not
     * sent are closed. Null clears the hours.
     *
     * @param  array<string, mixed>|null  $value
     * @return Week|null
     */
    public static function normalize(?array $value): ?array
    {
        if ($value === null) {
            return null;
        }

        $week = [];

        foreach (self::DAYS as $day) {
            $hours = $value[$day] ?? null;
            $week[$day] = self::day($hours);
        }

        return $week;
    }

    /**
     * Rows for the shop page: [day label, "08:00–20:00" | "Kapalı"]. Empty without hours.
     *
     * @param  array<string, mixed>|null  $stored
     * @return list<array{0: string, 1: string}>
     */
    public static function rows(?array $stored): array
    {
        $week = self::normalize($stored);

        if ($week === null) {
            return [];
        }

        $rows = [];

        foreach ($week as $day => $hours) {
            $rows[] = [self::LABELS[$day], $hours === null ? 'Kapalı' : $hours['open'].'–'.$hours['close']];
        }

        return $rows;
    }

    /**
     * schema.org OpeningHoursSpecification entries, open days only.
     *
     * @param  array<string, mixed>|null  $stored
     * @return list<array<string, string>>
     */
    public static function toSchemaOrg(?array $stored): array
    {
        $week = self::normalize($stored);
        $entries = [];

        foreach ($week ?? [] as $day => $hours) {
            if ($hours === null) {
                continue;
            }

            $entries[] = [
                '@type' => 'OpeningHoursSpecification',
                'dayOfWeek' => 'https://schema.org/'.self::SCHEMA_DAYS[$day],
                'opens' => $hours['open'],
                'closes' => $hours['close'],
            ];
        }

        return $entries;
    }

    /**
     * @return array{open: string, close: string}|null
     */
    private static function day(mixed $hours): ?array
    {
        if (! is_array($hours)) {
            return null;
        }

        $open = $hours['open'] ?? null;
        $close = $hours['close'] ?? null;

        if (! is_string($open) || ! is_string($close)
            || preg_match(self::TIME_PATTERN, $open) !== 1
            || preg_match(self::TIME_PATTERN, $close) !== 1) {
            return null;
        }

        return ['open' => $open, 'close' => $close];
    }
}
