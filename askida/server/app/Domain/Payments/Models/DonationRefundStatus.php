<?php

namespace App\Domain\Payments\Models;

/**
 * State of a donation's refund operation.
 */
enum DonationRefundStatus: string
{
    /** Claimed: exactly one caller is talking to the provider (or crashed while doing so). */
    case Processing = 'processing';

    /** The provider confirmed the exact amount; the donation is refunded. */
    case Succeeded = 'succeeded';

    /** The provider refused: no money moved, a later call may claim it again. */
    case Failed = 'failed';

    /** The provider may have moved money (outage, other amount): finance records the outcome. */
    case Uncertain = 'uncertain';
}
