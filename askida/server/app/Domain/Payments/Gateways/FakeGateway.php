<?php

namespace App\Domain\Payments\Gateways;

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\CheckoutSession;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\ProviderPaymentItem;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Data\SubMerchantResult;
use App\Domain\Payments\Data\VerifiedWebhook;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Gateways\Iyzico\IyzicoWebhookVerifier;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Contracts\Cache\Repository;

/**
 * Deterministic stand-in for the provider, for tests and local development only
 * (PaymentsServiceProvider refuses it in production-like environments).
 *
 * Behaviour:
 * - the provider token is derived from the conversation id, so the same conversation
 *   always gets the same token (idempotent like the real initialize call);
 * - the checkout markup is a local form that posts ONLY the token to `/pay/callback`;
 * - `retrievePayment` of a checkout it opened answers `success` with the exact amount,
 *   currency and conversation id unless a test scripted something else; an unknown token
 *   answers `failure` with nothing paid;
 * - webhooks are verified with the same scheme as the real gateway (secret from
 *   `services.iyzico.secret_key`), so webhook tests sign at run time;
 * - sub-merchant keys are derived from the external id (idempotent), refunds are
 *   remembered per idempotency key, settlements are whatever a test scripted (none by default).
 *
 * State lives in the default cache store, so it survives between the requests of one
 * local session and between the calls of one test; nothing is persisted elsewhere.
 */
final class FakeGateway implements PaymentGateway
{
    public const PREFIX = 'fake-gateway:';

    public const TTL_SECONDS = 86_400;

    public function __construct(
        private readonly Repository $cache,
    ) {}

    // Scripting (tests and local demos)

    /**
     * Fixes what `retrievePayment` answers for a token. A null field falls back to the
     * checkout's own value (amount and conversation id only for `success`).
     */
    public function scriptPayment(
        string $providerToken,
        ProviderPaymentStatus $status,
        ?int $paidAmountMinor = null,
        ?string $currency = null,
        ?string $conversationId = null,
        bool $withoutPaymentId = false,
    ): void {
        $this->cache->put($this->key('script', $providerToken), [
            'no_payment_id' => $withoutPaymentId,
            'status' => $status->value,
            'paid' => $paidAmountMinor,
            'currency' => $currency,
            'conversation' => $conversationId,
        ], self::TTL_SECONDS);
    }

    /**
     * Makes `retrievePayment` (for one token) or `initializeCheckout` (token null) throw
     * GatewayUnavailable until cleared.
     */
    public function scriptUnavailable(?string $providerToken = null, bool $unavailable = true): void
    {
        $key = $this->key('unavailable', $providerToken ?? 'checkout');

        $unavailable ? $this->cache->put($key, true, self::TTL_SECONDS) : $this->cache->forget($key);
    }

    /**
     * Makes refunds of one provider payment succeed or be refused.
     */
    public function scriptRefund(string $providerPaymentId, bool $succeeds): void
    {
        $this->cache->put($this->key('refund-outcome', $providerPaymentId), $succeeds, self::TTL_SECONDS);
    }

    /**
     * @param  list<SettlementRecord>  $records
     */
    public function scriptSettlements(string $subMerchantKey, array $records): void
    {
        $this->cache->put($this->key('settlements', $subMerchantKey), array_map(static fn (SettlementRecord $record): array => [
            'id' => $record->settlementId,
            'amount' => $record->amountMinor,
            'status' => $record->status,
            'date' => $record->settlementDate->toIso8601String(),
        ], $records), self::TTL_SECONDS);
    }

    /**
     * What the last checkout for this token was opened with (for assertions).
     *
     * @return array{amount: int, commission: int, currency: string, conversation: string, sub_merchant: string, item: string, qty: int, unit: int, buyer: string}|null
     */
    public function checkoutFor(string $providerToken): ?array
    {
        /** @var array{amount: int, commission: int, currency: string, conversation: string, sub_merchant: string, item: string, qty: int, unit: int, buyer: string}|null $checkout */
        $checkout = $this->cache->get($this->key('checkout', $providerToken));

        return $checkout;
    }

    public static function tokenFor(string $conversationId): string
    {
        return 'fake-'.substr(hash('sha256', 'checkout|'.$conversationId), 0, 40);
    }

    // PaymentGateway

    public function createSubMerchant(Shop $shop, SubMerchantData $data): SubMerchantResult
    {
        return new SubMerchantResult('fake-sm-'.substr(hash('sha256', 'sub-merchant|'.$data->externalId), 0, 24));
    }

    public function initializeCheckout(CheckoutRequest $request): CheckoutSession
    {
        if ($this->cache->has($this->key('unavailable', 'checkout'))) {
            throw new GatewayUnavailable;
        }

        $token = self::tokenFor($request->conversationId);

        $this->cache->put($this->key('checkout', $token), [
            'amount' => $request->amountMinor,
            'commission' => $request->commissionMinor,
            'currency' => $request->currency,
            'conversation' => $request->conversationId,
            'sub_merchant' => $request->subMerchantKey,
            'item' => $request->itemId,
            'qty' => $request->qty,
            'unit' => $request->unitPriceMinor,
            'buyer' => $request->buyerReference,
        ], self::TTL_SECONDS);

        return new CheckoutSession($token, self::checkoutForm($request->callbackUrl, $token));
    }

    public function retrievePayment(string $providerToken): ProviderPayment
    {
        if ($this->cache->has($this->key('unavailable', $providerToken))) {
            throw new GatewayUnavailable;
        }

        $checkout = $this->checkoutFor($providerToken);
        /** @var array{status: string, paid: int|null, currency: string|null, conversation: string|null, no_payment_id?: bool}|null $script */
        $script = $this->cache->get($this->key('script', $providerToken));

        if ($checkout === null && $script === null) {
            return new ProviderPayment(ProviderPaymentStatus::Failure, 0, 'TRY', null, null);
        }

        $status = ProviderPaymentStatus::from($script['status'] ?? ProviderPaymentStatus::Success->value);
        $success = $status === ProviderPaymentStatus::Success;
        $paid = $script['paid'] ?? ($success ? ($checkout['amount'] ?? 0) : 0);
        $paymentId = $success && ! ($script['no_payment_id'] ?? false) ? 'fake-pay-'.substr(hash('sha256', 'payment|'.$providerToken), 0, 20) : null;
        $items = [];

        if ($success && $checkout !== null) {
            $items[] = new ProviderPaymentItem(
                itemId: $checkout['item'],
                subMerchantKey: $checkout['sub_merchant'],
                paidAmountMinor: $paid,
                subMerchantPayoutMinor: max(0, $paid - $checkout['commission']),
            );
        }

        return new ProviderPayment(
            status: $status,
            paidAmountMinor: $paid,
            currency: $script['currency'] ?? ($checkout['currency'] ?? 'TRY'),
            providerPaymentId: $paymentId,
            conversationId: $script['conversation'] ?? ($checkout['conversation'] ?? null),
            items: $items,
        );
    }

    public function verifyWebhook(string $rawBody, array $headers): VerifiedWebhook
    {
        $secret = config('services.iyzico.secret_key');

        return (new IyzicoWebhookVerifier(
            is_string($secret) ? $secret : '',
            (int) config('payments.webhook_max_age_seconds', 300),
        ))->verify($rawBody, $headers, CarbonImmutable::now());
    }

    public function refund(RefundRequest $request): RefundResult
    {
        $key = $this->key('refund', $request->idempotencyKey);
        /** @var array{succeeded: bool, id: string|null, amount: int}|null $previous */
        $previous = $this->cache->get($key);

        if ($previous !== null) {
            return new RefundResult($previous['succeeded'], $previous['id'], $previous['amount']);
        }

        $succeeds = (bool) $this->cache->get($this->key('refund-outcome', $request->providerPaymentId), true);
        $result = $succeeds
            ? new RefundResult(true, 'fake-refund-'.substr(hash('sha256', 'refund|'.$request->idempotencyKey), 0, 20), $request->amountMinor)
            : new RefundResult(false, null, 0);

        $this->cache->put($key, [
            'succeeded' => $result->succeeded,
            'id' => $result->providerRefundId,
            'amount' => $result->refundedAmountMinor,
        ], self::TTL_SECONDS);

        return $result;
    }

    public function listSettlements(string $subMerchantKey, CarbonPeriod $period): array
    {
        /** @var list<array{id: string, amount: int, status: string, date: string}> $scripted */
        $scripted = $this->cache->get($this->key('settlements', $subMerchantKey), []);
        $start = CarbonImmutable::instance($period->getStartDate())->startOfDay();
        $endDate = $period->getEndDate();
        $end = $endDate === null ? null : CarbonImmutable::instance($endDate)->endOfDay();
        $records = [];

        foreach ($scripted as $row) {
            $date = CarbonImmutable::parse($row['date']);

            if ($date->lessThan($start) || ($end !== null && $date->greaterThan($end))) {
                continue;
            }

            $records[] = new SettlementRecord($row['id'], $subMerchantKey, $row['amount'], 'TRY', $row['status'], $date);
        }

        return $records;
    }

    /**
     * The local checkout: one form, one hidden field (the token), posting to the path of
     * the callback url so it stays on this origin (CSP `form-action 'self'`).
     */
    private static function checkoutForm(string $callbackUrl, string $token): string
    {
        $path = parse_url($callbackUrl, PHP_URL_PATH);
        $action = is_string($path) && $path !== '' ? $path : '/pay/callback';

        return '<form method="post" action="'.e($action).'" class="fake-checkout">'
            .'<input type="hidden" name="token" value="'.e($token).'">'
            .'<p class="fake-checkout-note">Deneme ödeme ekranı: gerçek bir kart çekimi yapılmaz.</p>'
            .'<button type="submit">Ödemeyi tamamla (deneme)</button>'
            .'</form>';
    }

    private function key(string $kind, string $id): string
    {
        return self::PREFIX.$kind.':'.hash('sha256', $id);
    }
}
