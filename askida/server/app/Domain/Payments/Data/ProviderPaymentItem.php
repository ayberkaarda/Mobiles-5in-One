<?php

namespace App\Domain\Payments\Data;

/**
 * One basket line of a provider payment with the share routed to a sub-merchant.
 */
final readonly class ProviderPaymentItem
{
    /**
     * @param  int  $paidAmountMinor  the line total in kuruş
     * @param  int|null  $subMerchantPayoutMinor  the amount for the sub-merchant in kuruş, if the provider reports it
     */
    public function __construct(
        public string $itemId,
        public ?string $subMerchantKey,
        public int $paidAmountMinor,
        public ?int $subMerchantPayoutMinor = null,
    ) {}
}
