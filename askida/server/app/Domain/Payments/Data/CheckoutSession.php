<?php

namespace App\Domain\Payments\Data;

use InvalidArgumentException;

/**
 * A checkout opened at the provider. The token is stored as `donations.provider_token`
 * and reaches the client only inside the `/pay/<token>` url.
 */
final readonly class CheckoutSession
{
    /**
     * @param  string  $paymentPageHtml  markup of the embedded payment form rendered on the pay page
     * @param  string|null  $providerPaymentId  known only if the provider returns it at initialisation
     */
    public function __construct(
        public string $providerToken,
        public string $paymentPageHtml,
        public ?string $providerPaymentId = null,
    ) {
        if ($providerToken === '') {
            throw new InvalidArgumentException('The provider token is empty.');
        }
    }
}
