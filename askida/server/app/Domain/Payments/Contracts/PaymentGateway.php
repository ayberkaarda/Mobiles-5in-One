<?php

namespace App\Domain\Payments\Contracts;

use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\CheckoutSession;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Data\SubMerchantResult;
use App\Domain\Payments\Data\VerifiedWebhook;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Exceptions\InvalidWebhookSignature;
use App\Domain\Payments\Exceptions\StaleWebhook;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonPeriod;

/**
 * The only door to the payment provider. The platform never holds funds: money moves
 * between the donor, the provider and the shop's sub-merchant account.
 *
 * Amounts are integers in kuruş (TRY minor units) and the currency is always `TRY`.
 *
 * Trust rules for every implementation and every caller:
 * - A status, amount or currency that arrives from a browser, a redirect, a callback
 *   body or a webhook body is never trusted. Money state changes only from the result
 *   of {@see self::retrievePayment()}, a server-to-server call made with our credentials.
 * - Secrets (provider keys, tax numbers, IBANs) are never logged and never appear in
 *   exception messages.
 * - Transport failures (timeouts, 5xx, connection errors) surface as
 *   {@see GatewayUnavailable}; callers decide whether to retry.
 */
interface PaymentGateway
{
    /**
     * Registers the shop as a sub-merchant at the provider.
     *
     * Idempotent per shop: the shop id is the provider-side external id, so repeating the
     * call for the same shop returns the same sub-merchant key instead of creating a second
     * account. Nothing is trusted beyond the key returned by the provider.
     *
     * @throws GatewayUnavailable
     */
    public function createSubMerchant(Shop $shop, SubMerchantData $data): SubMerchantResult;

    /**
     * Opens a checkout for one donation and returns the provider token and the embedded
     * payment form markup.
     *
     * Idempotent per conversation id: the same conversation id must not create a second
     * charge. The amount comes from the server-computed request, never from the client.
     *
     * @throws GatewayUnavailable
     */
    public function initializeCheckout(CheckoutRequest $request): CheckoutSession;

    /**
     * Fetches the authoritative state of a payment by its provider token.
     *
     * Read-only and idempotent, safe to repeat. This is the single source for deciding
     * whether a donation was paid; the status, amount, currency and conversation id in the
     * result are compared with our own record by the settlement service.
     *
     * @throws GatewayUnavailable
     */
    public function retrievePayment(string $providerToken): ProviderPayment;

    /**
     * Verifies a webhook delivery from the RAW request body and headers (before any JSON
     * decoding) and returns the parsed event.
     *
     * The body is untrusted until the signature matches. The returned event only names a
     * payment; its status fields are never used to change money state, the caller re-fetches
     * through {@see self::retrievePayment()}. Deterministic and free of side effects.
     *
     * @param  array<string, array<int, string|null>|string|null>  $headers
     *
     * @throws InvalidWebhookSignature when the signature is missing or does not match
     * @throws StaleWebhook when the signed timestamp is older than the allowed window
     */
    public function verifyWebhook(string $rawBody, array $headers): VerifiedWebhook;

    /**
     * Refunds a captured payment, fully or partly.
     *
     * Idempotent per `RefundRequest::$idempotencyKey`: repeating the call with the same key
     * returns the original result and never refunds twice.
     *
     * @throws GatewayUnavailable
     */
    public function refund(RefundRequest $request): RefundResult;

    /**
     * Lists the provider's settlements to one sub-merchant for a period (read-only).
     *
     * Idempotent and safe to repeat; the caller upserts by settlement id.
     *
     * @return array<int, SettlementRecord>
     *
     * @throws GatewayUnavailable
     */
    public function listSettlements(string $subMerchantKey, CarbonPeriod $period): array;
}
