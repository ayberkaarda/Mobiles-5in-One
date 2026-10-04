<?php

namespace App\Domain\Payments\Models;

/**
 * Settlement state mirrored from the payment provider. `Held` marks a payout paused by
 * the anomaly guard for review by finance.
 */
enum PayoutStatus: string
{
    case Pending = 'pending';
    case Held = 'held';
    case Settled = 'settled';
    case Failed = 'failed';
}
