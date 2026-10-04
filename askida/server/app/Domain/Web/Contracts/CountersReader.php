<?php

namespace App\Domain\Web\Contracts;

use App\Domain\Web\Data\DistrictCounters;
use App\Domain\Web\Data\HomeCounters;

/**
 * Counters shown on the public pages (home hero, "Bugün askıda" band, district pages).
 * Counts are of items and shops, never of people. Bound in App\Providers\WebServiceProvider.
 */
interface CountersReader
{
    public function home(): HomeCounters;

    /**
     * @param  string  $il  province slug, e.g. "istanbul"
     * @param  string|null  $ilce  district slug, e.g. "sisli"; null for the whole province
     */
    public function district(string $il, ?string $ilce): DistrictCounters;
}
