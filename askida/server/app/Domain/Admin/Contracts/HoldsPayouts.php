<?php

namespace App\Domain\Admin\Contracts;

use App\Domain\Payments\Models\Payout;
use App\Models\User;

/**
 * Finance hold and release of a payout (spec section 6 item 22), as the panel needs it.
 * The payouts domain implements it; the panel never writes `payouts.hold` itself.
 * Implementations authorize the actor (`manage-payouts`), record the reason and are
 * idempotent (holding a held payout changes nothing).
 */
interface HoldsPayouts
{
    public function hold(Payout $payout, User $actor, string $reason): Payout;

    public function release(Payout $payout, User $actor, string $reason): Payout;
}
