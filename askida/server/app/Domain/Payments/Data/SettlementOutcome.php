<?php

namespace App\Domain\Payments\Data;

/**
 * Result of one `SettlesPayments::settle` call.
 */
enum SettlementOutcome: string
{
    /** The donation moved to paid in this call and its hooks were issued. */
    case Paid = 'paid';

    /** The donation was already paid; nothing changed. */
    case AlreadyPaid = 'already_paid';

    /** The provider reports a failed payment; the donation moved to failed. */
    case Failed = 'failed';

    /** The provider has no final answer yet; nothing changed. */
    case Pending = 'pending';

    /** Amount, currency or conversation id disagree: status unchanged, mismatch recorded. */
    case Mismatch = 'mismatch';

    /** No donation carries this provider token. */
    case UnknownToken = 'unknown_token';
}
