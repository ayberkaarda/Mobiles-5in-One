<?php

namespace App\Domain\Shops\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A shop moved to `rejected`. Carries ids only; listeners load what they need.
 */
final class ShopRejected implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $shopId,
        public readonly string $actorId,
    ) {}
}
