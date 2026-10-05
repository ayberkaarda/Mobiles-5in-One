<?php

namespace App\Domain\Web\Data;

use Carbon\CarbonImmutable;

/**
 * Counters of one province or district page.
 *
 * - il / ilce: the slugs asked for;
 * - level: the level the impact figures were answered at (`ilce`, `il` or `tr`): a cell
 *   below the small-cell threshold rolls up (ImpactReader), and the page says so;
 * - availableNow: AVAILABLE hook units of the listed shops of the asked area right now;
 * - donated / redeemed / shops: the latest impact snapshot day at `level`;
 * - day: that snapshot day (Y-m-d) or null when there is no snapshot yet;
 * - asOf, isSample, methodology: as in HomeCounters.
 */
final readonly class DistrictCounters
{
    public function __construct(
        public string $il,
        public ?string $ilce,
        public string $level,
        public int $availableNow,
        public int $donated,
        public int $redeemed,
        public int $shops,
        public ?string $day,
        public CarbonImmutable $asOf,
        public bool $isSample,
        public string $methodology = '',
    ) {}
}
