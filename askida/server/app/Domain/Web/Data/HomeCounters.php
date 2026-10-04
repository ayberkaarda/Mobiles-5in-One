<?php

namespace App\Domain\Web\Data;

use Carbon\CarbonImmutable;

/**
 * Site-wide counters of the home page.
 *
 * - availableNow: AVAILABLE hook units of verified, non-sample shops right now;
 * - donatedToday / redeemedToday / shops: the latest impact snapshot day (ImpactReader::latest(null, null));
 * - asOf: when these numbers were read (shown as the date next to them);
 * - isSample: true when sample shops are allowed and real rows are zero, so the page labels
 *   the figures [ÖRNEK];
 * - methodology: the methodology id of the figures (ImpactSnapshotService::METHODOLOGY);
 *   pages print their own methodology sentence for it.
 */
final readonly class HomeCounters
{
    public function __construct(
        public int $availableNow,
        public int $donatedToday,
        public int $redeemedToday,
        public int $shops,
        public CarbonImmutable $asOf,
        public bool $isSample,
        public string $methodology = '',
    ) {}
}
