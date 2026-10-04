<?php

namespace Tests\Support\Payouts;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/**
 * Fixtures for the payouts and fraud tests. Tax numbers, IBANs and provider keys are
 * built at run time (checksum-valid dummies), never written as literals.
 */
final class PayoutWorld
{
    /**
     * A shop with an encrypted tax number and IBAN. Returns the shop and the plaintexts.
     *
     * @return array{shop: Shop, tax: string, iban: string}
     */
    public static function shopWithFinancials(bool $verified = true, ?string $subMerchantKey = null): array
    {
        $shop = HookWorld::shop($verified);
        $tax = ShopTestKit::taxNumber();
        $iban = ShopTestKit::iban();

        $shop->forceFill([
            'tax_number_enc' => $tax,
            'iban_enc' => $iban,
            'sub_merchant_key' => $subMerchantKey,
        ])->save();

        return ['shop' => $shop->refresh(), 'tax' => $tax, 'iban' => $iban];
    }

    public static function key(): string
    {
        return 'sm-'.Str::lower(Str::random(12));
    }

    public static function payout(Shop $shop, PayoutStatus $status, string $period, int $amount = 10_000, bool $hold = false, ?string $settlementId = null): Payout
    {
        $payout = new Payout;
        $payout->forceFill([
            'shop_id' => $shop->id,
            'provider_settlement_id' => $settlementId ?? 'st-'.Str::lower(Str::random(10)),
            'amount_minor' => $amount,
            'currency' => 'TRY',
            'status' => $status,
            'period' => $period,
            'hold' => $hold,
            'hold_reason' => $hold ? 'fraud.redeem_rate' : null,
        ])->save();

        return $payout->refresh();
    }

    public static function record(string $settlementId, string $key, int $amount, string $status, string $date): SettlementRecord
    {
        return new SettlementRecord($settlementId, $key, $amount, 'TRY', $status, CarbonImmutable::parse($date, 'Europe/Istanbul'));
    }

    public static function donation(Item $item, User $donor, int $amount, int $commission, DonationStatus $status, ?CarbonImmutable $paidAt): Donation
    {
        $donation = new Donation;
        $donation->forceFill([
            'donor_id' => $donor->id,
            'shop_id' => $item->shop_id,
            'item_id' => $item->id,
            'qty' => 1,
            'amount_minor' => $amount,
            'commission_minor' => $commission,
            'currency' => 'TRY',
            'provider' => 'fake',
            'status' => $status,
            'paid_at' => $paidAt,
        ])->save();

        return $donation;
    }

    /**
     * Inserts `count` REDEEMED hooks of the shop at the given instants (one donation).
     *
     * @param  list<CarbonImmutable>|CarbonImmutable  $at
     */
    public static function redeemed(Shop $shop, array|CarbonImmutable $at, int $count = 1, ?User $by = null): void
    {
        $times = is_array($at) ? $at : array_fill(0, $count, $at);
        $item = HookWorld::item($shop);
        // An unpaid donation, so the fixture adds nothing to paid ledger totals.
        $donation = HookWorld::donation($item, null, max(1, min(20, count($times))), paid: false);
        $rows = [];

        foreach ($times as $time) {
            $rows[] = [
                'id' => (string) Str::uuid(),
                'donation_id' => $donation->id,
                'shop_id' => $shop->id,
                'item_id' => $item->id,
                'status' => HookStatus::Redeemed->value,
                'code_hash' => bin2hex(random_bytes(32)),
                'reserved_at' => $time->subMinutes(2)->format('Y-m-d H:i:s.uP'),
                'expires_at' => $time->addMinutes(8)->format('Y-m-d H:i:s.uP'),
                'redeemed_at' => $time->format('Y-m-d H:i:s.uP'),
                'redeemed_by_user_id' => $by?->id,
                'created_at' => $time->subHour()->format('Y-m-d H:i:s.uP'),
                'updated_at' => $time->format('Y-m-d H:i:s.uP'),
            ];
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('hooks')->insert($chunk);
        }
    }

    /**
     * Writes `count` `suspicious_self_redeem` entries for the shop, as the redemption
     * engine does, at the given instant.
     */
    public static function selfRedeems(Shop $shop, int $count, CarbonImmutable $at): void
    {
        for ($i = 0; $i < $count; $i++) {
            $entry = activity('hooks')
                ->event('suspicious_self_redeem')
                ->withProperties(['shop_id' => $shop->id, 'donation_id' => (string) Str::uuid()])
                ->log('suspicious_self_redeem');

            if ($entry !== null) {
                // activity_log has zone-less timestamps written in the application zone.
                $local = $at->setTimezone((string) config('app.timezone'));
                $entry->forceFill(['created_at' => $local, 'updated_at' => $local])->save();
            }
        }
    }
}
