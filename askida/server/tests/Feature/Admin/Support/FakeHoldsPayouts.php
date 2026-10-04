<?php

namespace Tests\Feature\Admin\Support;

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Payments\Models\Payout;
use App\Models\User;

/**
 * Stands in for the payouts domain service in panel tests: records each call and sets
 * the hold flag the way the real service is expected to.
 */
final class FakeHoldsPayouts implements HoldsPayouts
{
    /** @var list<array{string, string, string, string}> */
    public array $calls = [];

    public function hold(Payout $payout, User $actor, string $reason): Payout
    {
        $this->calls[] = ['hold', $payout->id, $actor->id, $reason];
        $payout->forceFill(['hold' => true, 'hold_reason' => $reason])->save();

        return $payout;
    }

    public function release(Payout $payout, User $actor, string $reason): Payout
    {
        $this->calls[] = ['release', $payout->id, $actor->id, $reason];
        $payout->forceFill(['hold' => false, 'hold_reason' => null])->save();

        return $payout;
    }
}
