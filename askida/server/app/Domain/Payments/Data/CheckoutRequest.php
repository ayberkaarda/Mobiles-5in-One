<?php

namespace App\Domain\Payments\Data;

use InvalidArgumentException;

/**
 * Everything the provider needs to open one checkout. All amounts are server computed
 * (`unitPriceMinor * qty`); the buyer is an opaque reference, no personal data is sent.
 */
final readonly class CheckoutRequest
{
    /**
     * @param  string  $conversationId  idempotency key for the provider, stored as donations.conversation_id
     * @param  int  $commissionMinor  the part of the amount the platform books as its commission
     * @param  string  $callbackUrl  absolute url the provider posts back to (/pay/callback)
     * @param  string  $buyerReference  opaque donor reference (user id), never an email or a name
     */
    public function __construct(
        public string $donationId,
        public string $conversationId,
        public string $subMerchantKey,
        public string $itemId,
        public string $itemName,
        public int $qty,
        public int $unitPriceMinor,
        public int $amountMinor,
        public int $commissionMinor,
        public string $currency,
        public string $callbackUrl,
        public string $buyerReference,
        public string $locale = 'tr',
    ) {
        if ($qty < 1 || $unitPriceMinor < 1 || $amountMinor !== $unitPriceMinor * $qty) {
            throw new InvalidArgumentException('The checkout amount does not match price and quantity.');
        }

        if ($commissionMinor < 0 || $commissionMinor > $amountMinor) {
            throw new InvalidArgumentException('The commission is outside the amount.');
        }

        if ($currency !== 'TRY') {
            throw new InvalidArgumentException('Only TRY is supported.');
        }
    }
}
