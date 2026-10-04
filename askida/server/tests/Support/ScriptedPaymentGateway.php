<?php

namespace Tests\Support;

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\CheckoutSession;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Data\SubMerchantResult;
use App\Domain\Payments\Data\VerifiedWebhook;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Exceptions\InvalidWebhookSignature;
use App\Domain\Payments\Exceptions\StaleWebhook;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use LogicException;

/**
 * A small deterministic gateway for the webhook, reconciliation and refund tests.
 *
 * Webhook scheme (test only): header `X-Test-Timestamp` carries unix seconds and
 * `X-Test-Signature` carries hex HMAC-SHA256 of "<timestamp>.<raw body>" keyed with
 * `services.iyzico.secret_key`, which each test sets to a value made at run time.
 * The body is JSON with `event_id`, `event_type`, `token` and optional `payment_id`.
 */
final class ScriptedPaymentGateway implements PaymentGateway
{
    public const SIGNATURE_HEADER = 'X-Test-Signature';

    public const TIMESTAMP_HEADER = 'X-Test-Timestamp';

    /** @var array<string, ProviderPayment|GatewayUnavailable> */
    public array $payments = [];

    /** @var list<string> */
    public array $retrieved = [];

    /** @var list<RefundRequest> */
    public array $refunds = [];

    /** @var array<string, RefundResult> results by idempotency key */
    private array $refundResults = [];

    public RefundResult|GatewayUnavailable|null $nextRefund = null;

    public function scriptPayment(string $providerToken, ProviderPayment|GatewayUnavailable $payment): void
    {
        $this->payments[$providerToken] = $payment;
    }

    /**
     * Headers of a correctly signed delivery for the given body.
     *
     * @return array<string, string>
     */
    public static function sign(string $rawBody, ?int $timestamp = null, ?string $secret = null): array
    {
        $timestamp ??= CarbonImmutable::now()->getTimestamp();
        $secret ??= (string) config('services.iyzico.secret_key');

        return [
            self::TIMESTAMP_HEADER => (string) $timestamp,
            self::SIGNATURE_HEADER => hash_hmac('sha256', $timestamp.'.'.$rawBody, $secret),
        ];
    }

    public function verifyWebhook(string $rawBody, array $headers): VerifiedWebhook
    {
        $timestamp = self::header($headers, self::TIMESTAMP_HEADER);
        $signature = self::header($headers, self::SIGNATURE_HEADER);
        $secret = (string) config('services.iyzico.secret_key');

        if ($timestamp === null || $signature === null || $secret === '' || ! ctype_digit($timestamp)) {
            throw new InvalidWebhookSignature;
        }

        if (! hash_equals(hash_hmac('sha256', $timestamp.'.'.$rawBody, $secret), $signature)) {
            throw new InvalidWebhookSignature;
        }

        $age = CarbonImmutable::now()->getTimestamp() - (int) $timestamp;

        if ($age > (int) config('payments.webhook_max_age_seconds') || $age < -60) {
            throw new StaleWebhook;
        }

        $body = json_decode($rawBody, true);

        if (! is_array($body) || ! is_string($body['event_id'] ?? null) || ! is_string($body['token'] ?? null)) {
            throw new InvalidWebhookSignature;
        }

        return new VerifiedWebhook(
            $body['event_id'],
            is_string($body['event_type'] ?? null) ? $body['event_type'] : 'payment',
            $body['token'],
            is_string($body['payment_id'] ?? null) ? $body['payment_id'] : null,
            CarbonImmutable::createFromTimestamp((int) $timestamp),
        );
    }

    public function retrievePayment(string $providerToken): ProviderPayment
    {
        $this->retrieved[] = $providerToken;
        $payment = $this->payments[$providerToken] ?? null;

        if ($payment instanceof GatewayUnavailable) {
            throw $payment;
        }

        if ($payment === null) {
            throw new LogicException('No scripted payment for this token.');
        }

        return $payment;
    }

    public function refund(RefundRequest $request): RefundResult
    {
        $this->refunds[] = $request;

        if (isset($this->refundResults[$request->idempotencyKey])) {
            return $this->refundResults[$request->idempotencyKey];
        }

        $next = $this->nextRefund ?? new RefundResult(true, 'sample-refund-'.count($this->refunds), $request->amountMinor);

        if ($next instanceof GatewayUnavailable) {
            throw $next;
        }

        if ($next->succeeded) {
            $this->refundResults[$request->idempotencyKey] = $next;
        }

        return $next;
    }

    public function createSubMerchant(Shop $shop, SubMerchantData $data): SubMerchantResult
    {
        throw new LogicException('Not used by these tests.');
    }

    public function initializeCheckout(CheckoutRequest $request): CheckoutSession
    {
        throw new LogicException('Not used by these tests.');
    }

    public function listSettlements(string $subMerchantKey, CarbonPeriod $period): array
    {
        throw new LogicException('Not used by these tests.');
    }

    /**
     * @param  array<string, array<int, string|null>|string|null>  $headers
     */
    private static function header(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) === strtolower($name)) {
                $value = is_array($value) ? ($value[0] ?? null) : $value;

                return is_string($value) && $value !== '' ? $value : null;
            }
        }

        return null;
    }
}
