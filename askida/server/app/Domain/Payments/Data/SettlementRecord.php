<?php

namespace App\Domain\Payments\Data;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * One provider settlement to a sub-merchant. Mirrors `payouts` rows; the platform never
 * holds these funds.
 */
final readonly class SettlementRecord
{
    /**
     * @param  string  $status  provider-side state: pending, paid or failed
     */
    public function __construct(
        public string $settlementId,
        public string $subMerchantKey,
        public int $amountMinor,
        public string $currency,
        public string $status,
        public CarbonImmutable $settlementDate,
    ) {
        if ($settlementId === '') {
            throw new InvalidArgumentException('The settlement id is empty.');
        }

        if ($amountMinor < 0) {
            throw new InvalidArgumentException('The settlement amount cannot be negative.');
        }

        if ($currency !== 'TRY') {
            throw new InvalidArgumentException('Only TRY is supported.');
        }
    }
}
