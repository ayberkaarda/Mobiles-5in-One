<?php

namespace App\Domain\Payments\Data;

/**
 * Provider-side outcome of a payment as reported by `retrievePayment`.
 */
enum ProviderPaymentStatus: string
{
    case Success = 'success';
    case Failure = 'failure';
    case Pending = 'pending';
}
