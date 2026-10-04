<?php

namespace App\Domain\Hooks\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * A unit was redeemed. Ids only: listeners never receive recipient data, a code or a
 * hash.
 */
final class HookRedeemed implements ShouldDispatchAfterCommit
{
    public function __construct(
        public readonly string $hookId,
        public readonly string $donationId,
        public readonly string $shopId,
        public readonly string $itemId,
    ) {}
}
