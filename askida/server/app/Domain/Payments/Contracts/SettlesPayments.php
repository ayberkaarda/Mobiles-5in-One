<?php

namespace App\Domain\Payments\Contracts;

use App\Domain\Payments\Data\SettlementOutcome;

/**
 * The single place that turns a provider payment into a donation state change.
 *
 * Implemented once by `PaymentSettlementService`; the pay callback, the webhook job and the
 * reconciliation job all call it and nothing else changes donation status. An implementation
 * must be idempotent and race-safe: any number of calls, concurrent or repeated, for the same
 * provider token produce at most one transition and at most `qty` hooks, and it never trusts
 * a status posted by a client or carried by a webhook body: it always re-reads the payment
 * from the provider through `PaymentGateway::retrievePayment`.
 */
interface SettlesPayments
{
    public function settle(string $providerToken): SettlementOutcome;
}
