<?php

namespace App\Domain\Web\Impact;

use Carbon\CarbonImmutable;

/**
 * The country impact page: totals of the window and one row per province. `sample` is true
 * when the figures come from the sample shops (labelled [ÖRNEK] on the page).
 */
final readonly class ImpactOverview
{
    /**
     * @param  list<ImpactRow>  $rows
     */
    public function __construct(
        public CarbonImmutable $from,
        public CarbonImmutable $to,
        public int $donated,
        public int $redeemed,
        public int $shops,
        public bool $sample,
        public array $rows,
    ) {}

    public function hasData(): bool
    {
        return $this->donated + $this->redeemed + $this->shops > 0;
    }
}
