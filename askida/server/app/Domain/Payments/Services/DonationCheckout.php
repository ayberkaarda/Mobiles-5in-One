<?php

namespace App\Domain\Payments\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Starts a donation (POST donations): checks the shop and item, computes the amount on
 * the server, enforces the caps, records an `initiated` donation and opens the checkout.
 *
 * Money rules (security item 23, payment amount tampering):
 * - amount = items.price_minor * qty, read from the database; the request has no amount;
 * - per transaction at most `payments.caps.transaction_minor` (TRY 2000);
 * - per donor and Europe/Istanbul day at most `payments.caps.donor_day_minor` (TRY 5000),
 *   counting paid donations of the day plus initiated ones younger than
 *   `payments.caps.initiated_window_minutes`;
 * - commission from CommissionCalculator, stored on the donation and shown on the pay page.
 *
 * The cap check and the insert run in one transaction holding the donor's user row
 * `FOR UPDATE`, so parallel requests of one donor cannot pass the day cap together. The
 * provider is called after that commit (no row lock is held over the network); if it is
 * unavailable the donation is marked failed and the caller gets 503.
 */
final class DonationCheckout
{
    public const DAY_TIMEZONE = 'Europe/Istanbul';

    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly CommissionCalculator $commission,
        private readonly PayPageStore $pages,
    ) {}

    /**
     * @return array{donation: Donation, checkout_url: string}
     */
    public function start(User $donor, string $shopId, string $itemId, int $qty): array
    {
        /** @var Shop|null $shop */
        $shop = Shop::query()->find($shopId);

        if ($shop === null) {
            throw ProblemException::make(ProblemCode::NotFound, 404);
        }

        if ($shop->verification_state !== ShopVerificationState::Verified || ($shop->sub_merchant_key ?? '') === '') {
            throw ProblemException::make(ProblemCode::ShopNotPayable, 409);
        }

        /** @var Item|null $item */
        $item = Item::query()->whereKey($itemId)->where('shop_id', $shop->id)->first();

        if ($item === null || ! $item->active) {
            throw ProblemException::make(ProblemCode::NotFound, 404);
        }

        $amount = $item->price_minor * $qty;

        if ($amount > (int) config('payments.caps.transaction_minor')) {
            throw ProblemException::make(ProblemCode::DonationTxCapExceeded, 422);
        }

        $donation = DB::transaction(function () use ($donor, $shop, $item, $qty, $amount): Donation {
            User::query()->whereKey($donor->getKey())->lockForUpdate()->first();

            if ($this->spentToday($donor) + $amount > (int) config('payments.caps.donor_day_minor')) {
                throw ProblemException::make(ProblemCode::DonationCapExceeded, 409);
            }

            $donation = new Donation;
            $donation->forceFill([
                'donor_id' => $donor->getKey(),
                'shop_id' => $shop->id,
                'item_id' => $item->id,
                'qty' => $qty,
                'amount_minor' => $amount,
                'commission_minor' => $this->commission->commission($amount),
                'currency' => 'TRY',
                'provider' => (string) config('payments.provider'),
                'status' => DonationStatus::Initiated,
                'conversation_id' => (string) Str::uuid7(),
            ])->save();

            return $donation;
        });

        try {
            $session = $this->gateway->initializeCheckout(new CheckoutRequest(
                donationId: $donation->id,
                conversationId: (string) $donation->conversation_id,
                subMerchantKey: (string) $shop->sub_merchant_key,
                itemId: $item->id,
                itemName: $item->name,
                qty: $qty,
                unitPriceMinor: $item->price_minor,
                amountMinor: $amount,
                commissionMinor: $donation->commission_minor,
                currency: 'TRY',
                callbackUrl: self::origin().'/pay/callback',
                buyerReference: (string) $donor->getKey(),
            ));
        } catch (GatewayUnavailable) {
            $donation->forceFill(['status' => DonationStatus::Failed])->save();

            throw ProblemException::make(ProblemCode::ServiceUnavailable, 503);
        }

        $donation->forceFill([
            'provider_token' => $session->providerToken,
            'provider_payment_id' => $session->providerPaymentId,
        ])->save();

        $this->pages->put($session->providerToken, $session->paymentPageHtml);

        return [
            'donation' => $donation,
            'checkout_url' => self::origin().'/pay/'.rawurlencode($session->providerToken),
        ];
    }

    /**
     * Kuruş counted towards the donor's cap for the current Europe/Istanbul day.
     */
    public function spentToday(User $donor): int
    {
        $now = CarbonImmutable::now();
        $start = $now->setTimezone(self::DAY_TIMEZONE)->startOfDay();
        $format = 'Y-m-d H:i:s.uP';
        $window = $now->subMinutes((int) config('payments.caps.initiated_window_minutes', 30));

        return (int) Donation::query()
            ->where('donor_id', $donor->getKey())
            ->where('created_at', '>=', $start->format($format))
            ->where('created_at', '<', $start->addDay()->format($format))
            ->where(static function ($query) use ($window, $format): void {
                $query->where('status', DonationStatus::Paid->value)
                    ->orWhere(static function ($initiated) use ($window, $format): void {
                        $initiated->where('status', DonationStatus::Initiated->value)
                            ->where('created_at', '>=', $window->format($format));
                    });
            })
            ->sum('amount_minor');
    }

    /**
     * The web origin serving the pay pages (this application's APP_URL).
     */
    public static function origin(): string
    {
        return rtrim((string) config('app.url'), '/');
    }
}
