<?php

namespace App\Domain\Payments\Data;

/**
 * Outcome of a refund call. A repeated request with the same key returns the original result.
 */
final readonly class RefundResult
{
    public function __construct(
        public bool $succeeded,
        public ?string $providerRefundId,
        public int $refundedAmountMinor,
    ) {}
}
