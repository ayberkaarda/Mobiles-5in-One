<?php

namespace App\Domain\Shops\Models;

/**
 * Merchant verification state: Pending -> Verified | Rejected. Only verified shops are
 * visible to donors and recipients.
 */
enum ShopVerificationState: string
{
    case Pending = 'pending';
    case Verified = 'verified';
    case Rejected = 'rejected';
}
