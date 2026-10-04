<?php

namespace App\Domain\Web\Impact;

use Carbon\CarbonImmutable;

/**
 * One province page. When `listed` is false the province has fewer than three verified shops,
 * so no figures are published for it (the small-cell rule) and the page says so.
 */
final readonly class ProvinceImpact
{
    /**
     * @param  list<ImpactRow>  $rows
     */
    public function __construct(
        public string $name,
        public string $slug,
        public CarbonImmutable $from,
        public CarbonImmutable $to,
        public bool $listed,
        public int $donated,
        public int $redeemed,
        public int $shops,
        public bool $sample,
        public array $rows,
    ) {}
}
