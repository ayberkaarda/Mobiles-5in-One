<?php

namespace App\Domain\Payments\Data;

use InvalidArgumentException;

/**
 * Refund of one donation, idempotent per `idempotencyKey` (use the donation id).
 */
final readonly class RefundRequest
{
    public function __construct(
        public string $donationId,
        public string $providerPaymentId,
        public int $amountMinor,
        public string $currency,
        public string $idempotencyKey,
        public string $reason,
    ) {
        if ($amountMinor < 1) {
            throw new InvalidArgumentException('The refund amount must be positive.');
        }

        if ($currency !== 'TRY') {
            throw new InvalidArgumentException('Only TRY is supported.');
        }

        if ($idempotencyKey === '') {
            throw new InvalidArgumentException('The idempotency key is empty.');
        }
    }
}
