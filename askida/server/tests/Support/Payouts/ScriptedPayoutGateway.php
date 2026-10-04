<?php

namespace Tests\Support\Payouts;

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\CheckoutSession;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Data\SubMerchantResult;
use App\Domain\Payments\Data\VerifiedWebhook;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonPeriod;
use LogicException;
use Throwable;

/**
 * A small scriptable gateway for the payouts tests: records sub-merchant calls and
 * returns scripted settlements per sub-merchant key. Payment methods are not used by
 * the payouts area and refuse to run.
 */
final class ScriptedPayoutGateway implements PaymentGateway
{
    /** @var list<SubMerchantData> */
    public array $subMerchantCalls = [];

    /** @var list<array{key: string, period: CarbonPeriod}> */
    public array $settlementCalls = [];

    /** @var list<Throwable|string> queued outcomes of createSubMerchant: a key or an exception */
    public array $subMerchantOutcomes = [];

    /** @var array<string, list<mixed>|Throwable> settlements (or an exception) per key */
    public array $settlements = [];

    public static function bind(): self
    {
        $gateway = new self;
        app()->instance(PaymentGateway::class, $gateway);

        return $gateway;
    }

    public function createSubMerchant(Shop $shop, SubMerchantData $data): SubMerchantResult
    {
        $this->subMerchantCalls[] = $data;
        $outcome = array_shift($this->subMerchantOutcomes) ?? 'sm-'.substr(hash('sha256', $shop->id), 0, 16);

        if ($outcome instanceof Throwable) {
            throw $outcome;
        }

        return new SubMerchantResult($outcome);
    }

    /**
     * @return array<int, SettlementRecord>
     */
    public function listSettlements(string $subMerchantKey, CarbonPeriod $period): array
    {
        $this->settlementCalls[] = ['key' => $subMerchantKey, 'period' => $period];
        $scripted = $this->settlements[$subMerchantKey] ?? [];

        if ($scripted instanceof Throwable) {
            throw $scripted;
        }

        /** @var array<int, SettlementRecord> $scripted */
        return $scripted;
    }

    public function initializeCheckout(CheckoutRequest $request): CheckoutSession
    {
        throw new LogicException('Not used by the payouts tests.');
    }

    public function retrievePayment(string $providerToken): ProviderPayment
    {
        throw new LogicException('Not used by the payouts tests.');
    }

    public function verifyWebhook(string $rawBody, array $headers): VerifiedWebhook
    {
        throw new LogicException('Not used by the payouts tests.');
    }

    public function refund(RefundRequest $request): RefundResult
    {
        throw new LogicException('Not used by the payouts tests.');
    }
}
