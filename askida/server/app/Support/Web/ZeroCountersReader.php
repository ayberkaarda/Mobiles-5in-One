<?php

namespace App\Support\Web;

use App\Domain\Impact\Services\ImpactSnapshotService;
use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Data\DistrictCounters;
use App\Domain\Web\Data\HomeCounters;
use Carbon\CarbonImmutable;

/**
 * Default CountersReader until the impact area binds its database reader: every count is
 * zero (an honest "nothing yet"), never an invented figure.
 */
final class ZeroCountersReader implements CountersReader
{
    public function home(): HomeCounters
    {
        return new HomeCounters(0, 0, 0, 0, CarbonImmutable::now(), false, ImpactSnapshotService::METHODOLOGY);
    }

    public function district(string $il, ?string $ilce): DistrictCounters
    {
        return new DistrictCounters($il, $ilce, 'tr', 0, 0, 0, 0, null, CarbonImmutable::now(), false, ImpactSnapshotService::METHODOLOGY);
    }
}
