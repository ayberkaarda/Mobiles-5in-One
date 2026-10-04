<?php

namespace App\Domain\Admin\Contracts;

use App\Domain\Donations\Models\Donation;
use App\Models\User;

/**
 * A finance-triggered refund of one donation, as the panel needs it. The payments
 * domain implements it through the PaymentGateway contract; the panel never edits
 * `donations.status` itself. Implementations authorize the actor (`refund-payments`)
 * and are idempotent per donation.
 */
interface RefundsDonations
{
    public function refund(Donation $donation, User $actor, string $reason): Donation;
}
