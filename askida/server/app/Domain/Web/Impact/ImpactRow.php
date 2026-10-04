<?php

namespace App\Domain\Web\Impact;

/**
 * One table row of an impact page: a province or district (or a pooled row, `slug` null).
 */
final readonly class ImpactRow
{
    public function __construct(
        public string $name,
        public ?string $slug,
        public int $donated,
        public int $redeemed,
        public int $shops,
    ) {}
}
