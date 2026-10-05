<?php

namespace App\Domain\Payments\Services;

/**
 * Result of one `RefundService::refundDonation` call.
 */
enum RefundOutcome: string
{
    /** The provider confirmed the refund and the donation moved to refunded in this call. */
    case Refunded = 'refunded';

    /** The donation was already refunded; nothing happened. */
    case AlreadyRefunded = 'already_refunded';

    /** The donation is not paid (initiated or failed): there is nothing to give back. */
    case NotRefundable = 'not_refundable';

    /** Every unit was redeemed: the money reached the shop for delivered goods. */
    case NothingToRefund = 'nothing_to_refund';

    /** The provider refused the refund: status unchanged, mismatch recorded. */
    case Failed = 'failed';

    /**
     * Another call holds the refund claim, or the provider outcome of an earlier attempt is
     * unknown (outage, other amount): no provider call was made; finance records the outcome.
     */
    case Unresolved = 'unresolved';
}
