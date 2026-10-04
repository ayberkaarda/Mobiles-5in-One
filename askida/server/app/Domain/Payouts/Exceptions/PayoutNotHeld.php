<?php

namespace App\Domain\Payouts\Exceptions;

use LogicException;

/**
 * A release was requested for a payout that is not on hold.
 */
final class PayoutNotHeld extends LogicException
{
    public function __construct()
    {
        parent::__construct('The payout is not on hold.');
    }
}
