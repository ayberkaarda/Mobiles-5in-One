<?php

namespace App\Domain\Payouts\Exceptions;

use LogicException;

/**
 * A manual hold was requested for a payout that is not pending (settled and failed
 * payouts have nothing left to hold).
 */
final class PayoutNotHoldable extends LogicException
{
    public function __construct()
    {
        parent::__construct('Only a pending payout can be held.');
    }
}
