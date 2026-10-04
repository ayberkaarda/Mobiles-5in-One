<?php

namespace App\Domain\Payouts\Jobs;

use App\Domain\Fraud\Models\AbuseFlagKind;
use App\Domain\Fraud\Services\AbuseFlagger;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payouts\Exceptions\OnboardingFailed;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Registers a verified shop as a sub-merchant at the payment provider and stores the
 * returned `sub_merchant_key` (queue `payments`).
 *
 * - The payload is the shop id only. The tax number and IBAN are decrypted inside
 *   handle() and live only in the SubMerchantData passed to the gateway.
 * - Idempotent: a shop that already has a key is never sent again; the key is written
 *   only while the column is still empty.
 * - A shop that is not verified (any more) is skipped. A shop that went back to pending
 *   keeps its key: nothing here clears it.
 * - Failures are rethrown as OnboardingFailed (shop id and failure class only), retried
 *   with the configured backoff; after the last attempt finance gets an abuse flag of
 *   kind `onboarding_failed` and an activity log entry.
 */
class OnboardSubMerchant implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = 'payouts.onboard-sub-merchant';

    public const QUEUE = 'payments';

    public const LOG_NAME = 'payouts';

    /**
     * Provider merchant type sent for every shop: shops register as sole proprietors
     * (the shop form has no company type field).
     */
    public const MERCHANT_TYPE = 'PRIVATE_COMPANY';

    public int $tries;

    public int $uniqueFor = 3600;

    public function __construct(public readonly string $shopId)
    {
        $this->onQueue(self::QUEUE);
        $this->tries = max(1, (int) config('payments.onboarding.max_attempts', 5));
    }

    public function uniqueId(): string
    {
        return $this->shopId;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        $configured = config('payments.onboarding.backoff_seconds', [60]);

        return array_values(array_map('intval', is_array($configured) ? $configured : [60]));
    }

    public function handle(PaymentGateway $gateway, AbuseFlagger $flags): void
    {
        $shop = Shop::query()->find($this->shopId);

        if (! $shop instanceof Shop) {
            return;
        }

        if ($shop->sub_merchant_key !== null && $shop->sub_merchant_key !== '') {
            return;
        }

        if ($shop->verification_state !== ShopVerificationState::Verified) {
            Log::info(self::NAME.'.skipped', ['shop_id' => $shop->id, 'reason' => 'not_verified']);

            return;
        }

        $data = $this->subMerchantData($shop);

        if ($data === null) {
            $this->flagFinance($flags, $shop, 'incomplete_shop_data');

            return;
        }

        try {
            $result = $gateway->createSubMerchant($shop, $data);
        } catch (GatewayUnavailable) {
            throw OnboardingFailed::forShop($shop->id, 'provider_unavailable');
        } catch (Throwable $e) {
            throw OnboardingFailed::forShop($shop->id, class_basename($e));
        } finally {
            unset($data);
        }

        $key = trim($result->subMerchantKey);

        if ($key === '') {
            throw OnboardingFailed::forShop($shop->id, 'empty_key');
        }

        $stored = Shop::query()
            ->whereKey($shop->id)
            ->whereNull('sub_merchant_key')
            ->update(['sub_merchant_key' => $key]);

        if ($stored === 1) {
            activity(self::LOG_NAME)
                ->performedOn($shop)
                ->event('payout.sub_merchant_onboarded')
                ->withProperties(['shop_id' => $shop->id])
                ->log('payout.sub_merchant_onboarded');
        }
    }

    /**
     * Called by the queue after the last attempt. The exception given here is the
     * sanitised OnboardingFailed (or a framework timeout), never a provider payload.
     */
    public function failed(?Throwable $exception = null): void
    {
        $shop = Shop::query()->find($this->shopId);

        if ($shop instanceof Shop) {
            $this->flagFinance(app(AbuseFlagger::class), $shop, 'attempts_exhausted');
        }
    }

    public function displayName(): string
    {
        return self::NAME;
    }

    private function subMerchantData(Shop $shop): ?SubMerchantData
    {
        $owner = $shop->owner_id === null ? null : User::query()->find($shop->owner_id);
        $taxNumber = $shop->tax_number_enc;
        $iban = $shop->iban_enc;

        if (! $owner instanceof User || ! is_string($taxNumber) || $taxNumber === '' || ! is_string($iban) || $iban === '') {
            return null;
        }

        return new SubMerchantData(
            externalId: $shop->id,
            name: $shop->name,
            address: trim($shop->address.', '.$shop->ilce.' / '.$shop->il),
            email: $owner->email,
            phone: $shop->phone,
            taxNumber: $taxNumber,
            iban: $iban,
            merchantType: self::MERCHANT_TYPE,
        );
    }

    private function flagFinance(AbuseFlagger $flags, Shop $shop, string $reason): void
    {
        $flag = $flags->raise($shop, AbuseFlagKind::OnboardingFailed, [
            'reason' => $reason,
            'max_attempts' => $this->tries,
        ]);

        Log::warning(self::NAME.'.failed', ['shop_id' => $shop->id, 'reason' => $reason]);

        if ($flag !== null) {
            activity(self::LOG_NAME)
                ->performedOn($shop)
                ->event('payout.onboarding_failed')
                ->withProperties(['shop_id' => $shop->id, 'abuse_flag_id' => $flag->id, 'reason' => $reason])
                ->log('payout.onboarding_failed');
        }
    }
}
