<?php

namespace App\Domain\Payments\Data;

/**
 * The provider's authoritative view of a payment (result of `retrievePayment`).
 */
final readonly class ProviderPayment
{
    /**
     * @param  array<int, ProviderPaymentItem>  $items  per-item sub-merchant splits
     */
    public function __construct(
        public ProviderPaymentStatus $status,
        public int $paidAmountMinor,
        public string $currency,
        public ?string $providerPaymentId,
        public ?string $conversationId,
        public array $items = [],
    ) {}
}
