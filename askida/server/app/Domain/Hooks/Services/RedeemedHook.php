<?php

namespace App\Domain\Hooks\Services;

use Carbon\CarbonImmutable;

/**
 * What the merchant learns about a redemption: the item and the time. Nothing about
 * the recipient.
 */
final readonly class RedeemedHook
{
    public function __construct(
        public string $hookId,
        public string $itemName,
        public CarbonImmutable $redeemedAt,
    ) {}
}
