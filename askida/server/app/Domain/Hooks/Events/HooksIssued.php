<?php

namespace App\Domain\Hooks\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * New AVAILABLE units were created for a paid donation. Carries no donor identity.
 */
final class HooksIssued implements ShouldDispatchAfterCommit
{
    public function __construct(
        public readonly string $donationId,
        public readonly string $shopId,
        public readonly string $itemId,
        public readonly int $count,
    ) {}
}
