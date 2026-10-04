<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use App\Domain\Payments\Data\CheckoutSession;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\ProviderPaymentItem;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Data\SubMerchantResult;
use Carbon\CarbonImmutable;
use UnexpectedValueException;

/**
 * Maps decoded provider responses to our DTOs. Anything missing or malformed raises
 * UnexpectedValueException, which the gateway turns into GatewayUnavailable (never a
 * guessed success).
 *
 * Provider facts used here, not verified (no sandbox account):
 * - checkout initialize returns `token`, `checkoutFormContent` (an inline script that
 *   renders the form into `#iyzipay-checkout-form`) and `paymentPageUrl` (the hosted
 *   form on an iyzipay.com host);
 * - checkout detail returns `paymentStatus` (`SUCCESS`, `FAILURE`, other values while
 *   the payment is in progress), `paidPrice`, `currency`, `paymentId`, `basketId` (our
 *   conversation id, see IyzicoRequestMapper) and `itemTransactions[]` with `itemId`,
 *   `paidPrice`, `subMerchantKey`, `subMerchantPayoutAmount`;
 * - refund v2 returns `paymentId`, `price` and optionally `hostReference`;
 * - sub-merchant create and detail return `subMerchantKey`;
 * - the completed payout report returns `payoutCompletedTransactions[]` with
 *   `payoutType` (`SUB_MERCHANT` for shop payouts), `subMerchantKey`, `payoutAmount`, `currency`.
 */
final class IyzicoResponseMapper
{
    public const HOSTED_FORM_HOST_SUFFIX = '.iyzipay.com';

    /**
     * @param  array<string, mixed>  $body
     */
    public function checkoutSession(array $body): CheckoutSession
    {
        $token = self::text($body, 'token');
        $content = self::text($body, 'checkoutFormContent');
        $pageUrl = self::text($body, 'paymentPageUrl');

        if ($token === '' || $content === '') {
            throw new UnexpectedValueException('The checkout response has no token or form.');
        }

        return new CheckoutSession(
            providerToken: $token,
            paymentPageHtml: $this->paymentPageHtml($content, $pageUrl),
        );
    }

    /**
     * @param  array<string, mixed>  $body
     */
    public function payment(array $body): ProviderPayment
    {
        $status = match (self::text($body, 'paymentStatus')) {
            'SUCCESS' => ProviderPaymentStatus::Success,
            'FAILURE' => ProviderPaymentStatus::Failure,
            default => ProviderPaymentStatus::Pending,
        };

        // A success needs the envelope to say so too and the amount and currency to be
        // present: a contradictory or partial answer is "unavailable", never a payment.
        if ($status === ProviderPaymentStatus::Success
            && (self::text($body, 'status') !== 'success' || ! isset($body['paidPrice']) || self::text($body, 'currency') === '')) {
            throw new UnexpectedValueException('Contradictory or incomplete payment detail.');
        }

        $items = [];

        foreach (self::list($body, 'itemTransactions') as $line) {
            $items[] = new ProviderPaymentItem(
                itemId: self::text($line, 'itemId'),
                subMerchantKey: self::text($line, 'subMerchantKey') === '' ? null : self::text($line, 'subMerchantKey'),
                paidAmountMinor: IyzicoMoney::parse($line['paidPrice'] ?? 0),
                subMerchantPayoutMinor: isset($line['subMerchantPayoutAmount']) ? IyzicoMoney::parse($line['subMerchantPayoutAmount']) : null,
            );
        }

        $paymentId = self::text($body, 'paymentId');
        $basketId = self::text($body, 'basketId');
        $conversationId = $basketId !== '' ? $basketId : self::text($body, 'conversationId');

        return new ProviderPayment(
            status: $status,
            paidAmountMinor: isset($body['paidPrice']) ? IyzicoMoney::parse($body['paidPrice']) : 0,
            currency: self::text($body, 'currency'),
            providerPaymentId: $paymentId === '' ? null : $paymentId,
            conversationId: $conversationId === '' ? null : $conversationId,
            items: $items,
        );
    }

    /**
     * @param  array<string, mixed>  $body
     */
    public function refund(array $body): RefundResult
    {
        $reference = self::text($body, 'hostReference');

        return new RefundResult(
            succeeded: self::text($body, 'status') === 'success',
            providerRefundId: $reference !== '' ? $reference : (self::text($body, 'paymentId') ?: null),
            refundedAmountMinor: isset($body['price']) ? IyzicoMoney::parse($body['price']) : 0,
        );
    }

    /**
     * @param  array<string, mixed>  $body
     */
    public function subMerchant(array $body): SubMerchantResult
    {
        $key = self::text($body, 'subMerchantKey');

        if ($key === '') {
            throw new UnexpectedValueException('The sub-merchant response has no key.');
        }

        return new SubMerchantResult($key);
    }

    /**
     * One record per day with completed payouts to the sub-merchant; the id is stable
     * per (sub-merchant, day) so repeated reads upsert the same row.
     *
     * @param  array<string, mixed>  $body
     */
    public function dailySettlement(array $body, string $subMerchantKey, CarbonImmutable $day): ?SettlementRecord
    {
        $total = 0;
        $found = false;

        foreach (self::list($body, 'payoutCompletedTransactions') as $line) {
            if (self::text($line, 'payoutType') !== 'SUB_MERCHANT' || self::text($line, 'subMerchantKey') !== $subMerchantKey) {
                continue;
            }

            if (self::text($line, 'currency') !== '' && self::text($line, 'currency') !== 'TRY') {
                throw new UnexpectedValueException('The payout report has a currency other than TRY.');
            }

            $total += IyzicoMoney::parse($line['payoutAmount'] ?? 0);
            $found = true;
        }

        if (! $found) {
            return null;
        }

        return new SettlementRecord(
            settlementId: 'iyz-'.substr(hash('sha256', $subMerchantKey.'|'.$day->format('Y-m-d')), 0, 32),
            subMerchantKey: $subMerchantKey,
            amountMinor: $total,
            currency: 'TRY',
            status: 'paid',
            settlementDate: $day,
        );
    }

    /**
     * The provider's own form script, then our fallback: a top-level link to the hosted
     * form on an iyzipay.com host (validated here) for when the script cannot run.
     */
    private function paymentPageHtml(string $content, string $pageUrl): string
    {
        $html = '<div id="iyzipay-checkout-form" class="responsive"></div>'."\n".$content;
        $parts = parse_url($pageUrl);
        $host = is_array($parts) ? strtolower((string) ($parts['host'] ?? '')) : '';

        if (is_array($parts) && ($parts['scheme'] ?? '') === 'https' && str_ends_with($host, self::HOSTED_FORM_HOST_SUFFIX)) {
            $html .= "\n".'<p class="pay-fallback"><a href="'.e($pageUrl).'" rel="noopener">Ödeme formu açılmazsa buradan devam et</a></p>';
        }

        return $html;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private static function text(array $body, string $field): string
    {
        $value = $body[$field] ?? null;

        return is_scalar($value) ? trim((string) $value) : '';
    }

    /**
     * @param  array<string, mixed>  $body
     * @return list<array<string, mixed>>
     */
    private static function list(array $body, string $field): array
    {
        $value = $body[$field] ?? [];

        if (! is_array($value)) {
            throw new UnexpectedValueException('The provider returned a malformed list.');
        }

        $lines = [];

        foreach ($value as $line) {
            if (! is_array($line)) {
                throw new UnexpectedValueException('The provider returned a malformed list entry.');
            }

            /** @var array<string, mixed> $line */
            $lines[] = $line;
        }

        return $lines;
    }
}
