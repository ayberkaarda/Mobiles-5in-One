<?php

namespace Tests\Fakes;

use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Data\DistrictCounters;
use App\Domain\Web\Data\HomeCounters;
use Carbon\CarbonImmutable;

/**
 * CountersReader for page tests: fixed figures (sample by default), every call recorded.
 * Bind it with `$this->app->instance(CountersReader::class, new FakeCountersReader)`.
 */
final class FakeCountersReader implements CountersReader
{
    public const AS_OF = '2026-10-04 09:00:00';

    /** @var list<array{0: string, 1: string|null}> */
    public array $districtCalls = [];

    public int $homeCalls = 0;

    public function __construct(
        public ?HomeCounters $homeCounters = null,
        public ?DistrictCounters $districtCounters = null,
    ) {}

    public static function asOf(): CarbonImmutable
    {
        return CarbonImmutable::parse(self::AS_OF, 'Europe/Istanbul');
    }

    public function home(): HomeCounters
    {
        $this->homeCalls++;

        return $this->homeCounters ?? new HomeCounters(
            availableNow: 14,
            donatedToday: 37,
            redeemedToday: 23,
            shops: 6,
            asOf: self::asOf(),
            isSample: true,
            methodology: 'impact.v1.daily_units',
        );
    }

    public function district(string $il, ?string $ilce): DistrictCounters
    {
        $this->districtCalls[] = [$il, $ilce];

        return $this->districtCounters ?? new DistrictCounters(
            il: $il,
            ilce: $ilce,
            level: $ilce === null ? 'il' : 'ilce',
            availableNow: 5,
            donated: 12,
            redeemed: 9,
            shops: 3,
            day: '2026-10-03',
            asOf: self::asOf(),
            isSample: true,
            methodology: 'impact.v1.daily_units',
        );
    }
}
