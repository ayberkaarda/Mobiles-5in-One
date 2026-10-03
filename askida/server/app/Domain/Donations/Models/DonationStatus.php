<?php

namespace App\Domain\Donations\Models;

enum DonationStatus: string
{
    case Initiated = 'initiated';
    case Paid = 'paid';
    case Failed = 'failed';
    case Refunded = 'refunded';
}
