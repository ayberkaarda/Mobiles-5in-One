<?php

namespace App\Domain\Payments\Data;

use InvalidArgumentException;

/**
 * The provider's key for the created sub-merchant, stored as `shops.sub_merchant_key`.
 */
final readonly class SubMerchantResult
{
    public function __construct(
        public string $subMerchantKey,
    ) {
        if ($subMerchantKey === '') {
            throw new InvalidArgumentException('The sub-merchant key is empty.');
        }
    }
}
