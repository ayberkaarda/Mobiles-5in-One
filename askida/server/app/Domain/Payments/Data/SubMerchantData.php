<?php

namespace App\Domain\Payments\Data;

use InvalidArgumentException;
use SensitiveParameter;

/**
 * Merchant details for sub-merchant onboarding. The tax number and IBAN are decrypted
 * only inside the onboarding job and are hidden from dumps and stack traces.
 */
final readonly class SubMerchantData
{
    /**
     * @param  string  $externalId  provider-side external id: the shop id, which makes onboarding idempotent
     * @param  string  $merchantType  provider merchant type, for example PRIVATE_COMPANY or LIMITED_OR_JOINT_STOCK_COMPANY
     */
    public function __construct(
        public string $externalId,
        public string $name,
        public string $address,
        public string $email,
        public string $phone,
        #[SensitiveParameter]
        public string $taxNumber,
        #[SensitiveParameter]
        public string $iban,
        public string $merchantType,
    ) {
        if ($externalId === '' || $name === '' || $taxNumber === '' || $iban === '') {
            throw new InvalidArgumentException('Sub-merchant data is incomplete.');
        }
    }

    /**
     * @return array<string, string>
     */
    public function __debugInfo(): array
    {
        return [
            'externalId' => $this->externalId,
            'name' => $this->name,
            'taxNumber' => '***'.substr($this->taxNumber, -2),
            'iban' => '***'.substr($this->iban, -4),
        ];
    }
}
