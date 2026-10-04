<?php

namespace App\Domain\Payments\Gateways;

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
use App\Domain\Payments\Gateways\Iyzico\IyzicoApiError;
use App\Domain\Payments\Gateways\Iyzico\IyzicoRequestMapper;
use App\Domain\Payments\Gateways\Iyzico\IyzicoResponseMapper;
use App\Domain\Payments\Gateways\Iyzico\IyzicoSigner;
use App\Domain\Payments\Gateways\Iyzico\IyzicoWebhookVerifier;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use JsonException;
use UnexpectedValueException;

/**
 * The provider's HTTP API (Checkout Form flow for a marketplace with sub-merchants).
 *
 * Endpoints and request/response fields follow the provider's public documentation and
 * are NOT verified against the provider (no sandbox account; every call is proven only
 * against local fixtures): the paths in the PATH_* constants, the `IYZWSv2` signing
 * (IyzicoSigner), the field names (IyzicoRequestMapper, IyzicoResponseMapper), the
 * `status: success|failure` envelope with `errorCode`, the webhook signature, the refund
 * v2 endpoint keyed by payment id, the sub-merchant detail lookup by external id and the
 * completed payout report as the settlement source.
 *
 * Transport rules:
 * - base url and keys only from config/services.php (`services.iyzico.*`); a missing key
 *   fails closed with GatewayUnavailable before any request;
 * - connect timeout 5 s, total timeout 15 s;
 * - retries (2 extra attempts, short pause) only for read-only, idempotent calls (payment
 *   detail, sub-merchant detail, payout report), on connection errors and 5xx. These reads
 *   are POST requests at this provider; initialize, refund and sub-merchant creation are
 *   never retried here;
 * - logs carry the operation name, the HTTP status and the provider error code only:
 *   never keys, signatures, request or response bodies, tokens or personal data.
 */
final class IyzicoGateway implements PaymentGateway
{
    public const PATH_CHECKOUT_INITIALIZE = '/payment/iyzipos/checkoutform/initialize/auth/ecom';

    public const PATH_CHECKOUT_DETAIL = '/payment/iyzipos/checkoutform/auth/ecom/detail';

    public const PATH_REFUND = '/v2/payment/refund';

    public const PATH_SUB_MERCHANT_CREATE = '/onboarding/submerchant';

    public const PATH_SUB_MERCHANT_DETAIL = '/onboarding/submerchant/detail';

    public const PATH_PAYOUTS_COMPLETED = '/reporting/settlement/payoutcompleted';

    public const CONNECT_TIMEOUT_SECONDS = 5;

    public const TIMEOUT_SECONDS = 15;

    public const READ_ATTEMPTS = 3;

    public const RETRY_PAUSE_MS = 200;

    /** Longest settlement window read in one call (one request per day). */
    public const MAX_SETTLEMENT_DAYS = 62;

    public function __construct(
        private readonly IyzicoRequestMapper $requests = new IyzicoRequestMapper,
        private readonly IyzicoResponseMapper $responses = new IyzicoResponseMapper,
    ) {}

    public function createSubMerchant(Shop $shop, SubMerchantData $data): SubMerchantResult
    {
        try {
            return $this->responses->subMerchant($this->call('sub_merchant.create', self::PATH_SUB_MERCHANT_CREATE, $this->requests->subMerchant($data), false));
        } catch (IyzicoApiError) {
            // Idempotency: the shop id is the external id; when the provider refuses a second
            // creation, the existing sub-merchant is looked up by that id.
            try {
                return $this->responses->subMerchant($this->call('sub_merchant.detail', self::PATH_SUB_MERCHANT_DETAIL, $this->requests->subMerchantDetail($data->externalId), true));
            } catch (IyzicoApiError) {
                throw new GatewayUnavailable('The payment provider refused the sub-merchant.');
            }
        } catch (UnexpectedValueException) {
            throw new GatewayUnavailable('The payment provider returned an unexpected response.');
        }
    }

    public function initializeCheckout(CheckoutRequest $request): CheckoutSession
    {
        try {
            return $this->responses->checkoutSession($this->call('checkout.initialize', self::PATH_CHECKOUT_INITIALIZE, $this->requests->checkout($request), false));
        } catch (IyzicoApiError) {
            throw new GatewayUnavailable('The payment provider refused the checkout.');
        } catch (UnexpectedValueException|InvalidArgumentException) {
            throw new GatewayUnavailable('The payment provider returned an unexpected response.');
        }
    }

    /**
     * A detail answer with `status: failure` but a `paymentStatus` (a declined or abandoned
     * payment) is a real failure; `status: failure` without `paymentStatus` is a request
     * error (unknown token, bad credentials) and raises GatewayUnavailable, so a
     * configuration fault never marks a donation failed.
     */
    public function retrievePayment(string $providerToken): ProviderPayment
    {
        try {
            $body = $this->call('checkout.detail', self::PATH_CHECKOUT_DETAIL, $this->requests->retrieve($providerToken), true, allowFailureWith: 'paymentStatus');

            return $this->responses->payment($body);
        } catch (IyzicoApiError) {
            throw new GatewayUnavailable('The payment provider refused the payment lookup.');
        } catch (UnexpectedValueException) {
            throw new GatewayUnavailable('The payment provider returned an unexpected response.');
        }
    }

    public function verifyWebhook(string $rawBody, array $headers): VerifiedWebhook
    {
        $secret = config('services.iyzico.secret_key');

        return (new IyzicoWebhookVerifier(
            is_string($secret) ? $secret : '',
            (int) config('payments.webhook_max_age_seconds', 300),
        ))->verify($rawBody, $headers, CarbonImmutable::now());
    }

    /**
     * A provider refusal is a result (`succeeded = false`), not an exception; transport
     * failures raise GatewayUnavailable.
     */
    public function refund(RefundRequest $request): RefundResult
    {
        try {
            return $this->responses->refund($this->call('refund', self::PATH_REFUND, $this->requests->refund($request), false));
        } catch (IyzicoApiError) {
            return new RefundResult(false, null, 0);
        } catch (UnexpectedValueException) {
            throw new GatewayUnavailable('The payment provider returned an unexpected response.');
        }
    }

    public function listSettlements(string $subMerchantKey, CarbonPeriod $period): array
    {
        $records = [];
        $days = 0;

        foreach ($period as $date) {
            if (++$days > self::MAX_SETTLEMENT_DAYS) {
                throw new InvalidArgumentException('The settlement period is too long.');
            }

            $day = CarbonImmutable::instance($date)->startOfDay();

            try {
                $body = $this->call('settlements.payouts_completed', self::PATH_PAYOUTS_COMPLETED, $this->requests->payoutsOfDay($day), true);
                $record = $this->responses->dailySettlement($body, $subMerchantKey, $day);
            } catch (IyzicoApiError) {
                throw new GatewayUnavailable('The payment provider refused the settlement report.');
            } catch (UnexpectedValueException) {
                throw new GatewayUnavailable('The payment provider returned an unexpected response.');
            }

            if ($record !== null) {
                $records[] = $record;
            }
        }

        return $records;
    }

    /**
     * Sends one signed request and returns the decoded success body.
     *
     * @param  array<string, mixed>  $payload
     * @param  string|null  $allowFailureWith  a field whose presence makes a `status: failure` body a valid answer
     * @return array<string, mixed>
     *
     * @throws GatewayUnavailable on transport errors, 4xx/5xx and non-JSON answers
     * @throws IyzicoApiError on `status: failure`
     */
    private function call(string $operation, string $path, array $payload, bool $idempotentRead, ?string $allowFailureWith = null): array
    {
        $baseUrl = config('services.iyzico.base_url');
        $apiKey = config('services.iyzico.api_key');
        $secretKey = config('services.iyzico.secret_key');

        if (! is_string($baseUrl) || ! str_starts_with($baseUrl, 'https://') || ! is_string($apiKey) || $apiKey === '' || ! is_string($secretKey) || $secretKey === '') {
            throw new GatewayUnavailable('The payment provider is not configured.');
        }

        try {
            $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            throw new GatewayUnavailable('The payment request could not be encoded.');
        }

        $headers = (new IyzicoSigner($apiKey, $secretKey))->requestHeaders($path, $body, self::randomKey());

        $request = Http::baseUrl(rtrim($baseUrl, '/'))
            ->withHeaders($headers)
            ->acceptJson()
            ->withBody($body, 'application/json')
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->timeout(self::TIMEOUT_SECONDS);

        if ($idempotentRead) {
            $request = $request->retry(
                self::READ_ATTEMPTS,
                self::RETRY_PAUSE_MS,
                static fn (mixed $exception): bool => $exception instanceof ConnectionException
                    || ($exception instanceof RequestException && $exception->response->serverError()),
                throw: false,
            );
        }

        try {
            $response = $request->post($path);
        } catch (ConnectionException) {
            self::logFailure($operation, null, null);

            throw new GatewayUnavailable;
        }

        if (! $response->successful()) {
            self::logFailure($operation, $response->status(), null);

            throw new GatewayUnavailable;
        }

        $decoded = $response->json();

        if (! is_array($decoded)) {
            self::logFailure($operation, $response->status(), null);

            throw new GatewayUnavailable('The payment provider returned an unexpected response.');
        }

        /** @var array<string, mixed> $decoded */
        if (($decoded['status'] ?? null) !== 'success') {
            $errorCode = is_scalar($decoded['errorCode'] ?? null) ? (string) $decoded['errorCode'] : 'unknown';

            if ($allowFailureWith !== null && isset($decoded[$allowFailureWith])) {
                return $decoded;
            }

            self::logFailure($operation, $response->status(), $errorCode);

            throw new IyzicoApiError($errorCode);
        }

        return $decoded;
    }

    private static function randomKey(): string
    {
        return (string) (int) (microtime(true) * 1000).bin2hex(random_bytes(6));
    }

    private static function logFailure(string $operation, ?int $httpStatus, ?string $providerError): void
    {
        Log::warning('payments.provider_call_failed', [
            'provider' => 'iyzico',
            'operation' => $operation,
            'http_status' => $httpStatus,
            'provider_error' => $providerError,
        ]);
    }
}
