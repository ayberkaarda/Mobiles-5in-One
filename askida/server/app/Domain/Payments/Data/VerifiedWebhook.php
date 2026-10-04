<?php

namespace App\Domain\Payments\Data;

use Carbon\CarbonImmutable;

/**
 * A webhook whose signature and timestamp were verified. It only identifies the payment;
 * the body's status is never used, the payment is re-fetched with `retrievePayment`.
 */
final readonly class VerifiedWebhook
{
    /**
     * @param  string  $eventId  unique per delivery at the provider; the idempotency key of payment_events
     */
    public function __construct(
        public string $eventId,
        public string $eventType,
        public string $providerToken,
        public ?string $providerPaymentId,
        public CarbonImmutable $occurredAt,
    ) {}
}
