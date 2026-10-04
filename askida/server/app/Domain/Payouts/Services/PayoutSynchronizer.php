<?php

namespace App\Domain\Payouts\Services;

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Mirrors the provider's sub-merchant settlements into `payouts` (read-only towards the
 * provider; the platform never holds the funds).
 *
 * Rules:
 * - provider status `pending|paid|failed` maps to `pending|settled|failed` (the database
 *   vocabulary says `settled` for the provider's `paid`); anything else is skipped;
 * - a record must be a SettlementRecord of this shop's sub-merchant key, TRY, with a
 *   non-negative amount and a settlement id of at most 191 characters;
 * - upsert by (shop_id, provider_settlement_id); a `settled` payout never changes status
 *   again (no downgrade), a held payout is never overwritten (finance releases it);
 * - a provider settlement id may name a daily aggregate (the provider gateway reports one
 *   completed-payout total per sub-merchant and day): a later report of a higher total
 *   for a `settled` payout raises its amount, because completed payouts only add up
 *   during a day; a lower total is refused and logged (ids only);
 * - a payout that is (or becomes) pending while its shop has an unreviewed fraud flag is
 *   put on hold; the shop row is locked first, like the fraud scan does;
 * - repeating a sync with the same provider data changes nothing.
 */
final class PayoutSynchronizer
{
    public const NAME = 'payouts.sync';

    public const WINDOW_DAYS = 14;

    public const TIMEZONE = 'Europe/Istanbul';

    /**
     * @var array<string, PayoutStatus>
     */
    public const STATUS_MAP = [
        'pending' => PayoutStatus::Pending,
        'paid' => PayoutStatus::Settled,
        'failed' => PayoutStatus::Failed,
    ];

    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly PayoutHoldService $holds,
    ) {}

    /**
     * @return array{shops: int, failed_shops: int, created: int, updated: int, unchanged: int, protected: int, rejected: int}
     */
    public function syncAll(?CarbonImmutable $now = null): array
    {
        $summary = self::emptySummary();
        $period = self::period($now ?? CarbonImmutable::now());

        Shop::query()
            ->whereNotNull('sub_merchant_key')
            ->where('sub_merchant_key', '<>', '')
            ->orderBy('id')
            ->chunkById(100, function ($shops) use ($period, &$summary): void {
                foreach ($shops as $shop) {
                    $summary['shops']++;
                    $this->syncShop($shop, $period, $summary);
                }
            });

        Log::info(self::NAME, $summary);

        return $summary;
    }

    /**
     * The last WINDOW_DAYS Istanbul calendar days, today included (14 days: today and the 13 before).
     */
    public static function period(CarbonImmutable $now): CarbonPeriod
    {
        $today = $now->setTimezone(self::TIMEZONE)->startOfDay();

        return CarbonPeriod::create($today->subDays(self::WINDOW_DAYS - 1), $today->endOfDay());
    }

    /**
     * @param  array{shops: int, failed_shops: int, created: int, updated: int, unchanged: int, protected: int, rejected: int}  $summary
     */
    public function syncShop(Shop $shop, CarbonPeriod $period, array &$summary): void
    {
        $key = (string) $shop->sub_merchant_key;

        try {
            $records = $this->gateway->listSettlements($key, $period);
        } catch (GatewayUnavailable) {
            $summary['failed_shops']++;
            Log::warning(self::NAME.'.shop_failed', ['shop_id' => $shop->id, 'reason' => 'provider_unavailable']);

            return;
        }

        foreach ($records as $record) {
            $status = $this->validStatus($record, $key);

            // validStatus() also refuses anything that is not a SettlementRecord: the
            // gateway's array is not trusted to hold only those.
            if ($status === null) {
                $summary['rejected']++;
                Log::warning(self::NAME.'.record_rejected', ['shop_id' => $shop->id]);

                continue;
            }

            $outcome = $this->upsert($shop, $record, $status);
            $summary[$outcome]++;
        }
    }

    private function validStatus(mixed $record, string $key): ?PayoutStatus
    {
        if (! $record instanceof SettlementRecord
            || ! hash_equals($key, $record->subMerchantKey)
            || $record->currency !== 'TRY'
            || $record->amountMinor < 0
            || $record->settlementId === ''
            || strlen($record->settlementId) > 191) {
            return null;
        }

        return self::STATUS_MAP[$record->status] ?? null;
    }

    /**
     * @return 'created'|'updated'|'unchanged'|'protected'
     */
    private function upsert(Shop $shop, SettlementRecord $record, PayoutStatus $status, bool $retry = true): string
    {
        try {
            return DB::transaction(function () use ($shop, $record, $status): string {
                // Same lock, same order as the fraud scan (shop row first, payouts after): a
                // scan's hold and a new pending payout can never both slip past each other.
                Shop::query()->whereKey($shop->id)->lockForUpdate()->first();

                $period = $record->settlementDate->setTimezone(self::TIMEZONE)->toDateString();

                /** @var Payout|null $existing */
                $existing = Payout::query()
                    ->where('shop_id', $shop->id)
                    ->where('provider_settlement_id', $record->settlementId)
                    ->lockForUpdate()
                    ->first();

                if ($existing === null) {
                    $payout = new Payout;
                    $payout->forceFill([
                        'shop_id' => $shop->id,
                        'provider_settlement_id' => $record->settlementId,
                        'amount_minor' => $record->amountMinor,
                        'currency' => 'TRY',
                        'status' => $status,
                        'period' => $period,
                    ]);

                    $reason = $status === PayoutStatus::Pending ? $this->holds->reasonForNewPayout($shop) : null;

                    if ($reason !== null) {
                        $payout->forceFill(['hold' => true, 'hold_reason' => $reason, 'status' => PayoutStatus::Held]);
                    }

                    $payout->save();

                    return 'created';
                }

                if ($existing->hold || $existing->status === PayoutStatus::Held) {
                    return 'protected';
                }

                if ($existing->status === PayoutStatus::Settled) {
                    return $this->raiseSettledTotal($shop, $existing, $record, $status);
                }

                $existing->forceFill([
                    'amount_minor' => $record->amountMinor,
                    'status' => $status,
                    'period' => $period,
                ]);

                $reason = $status === PayoutStatus::Pending ? $this->holds->reasonForNewPayout($shop) : null;

                if ($reason !== null) {
                    $existing->forceFill(['hold' => true, 'hold_reason' => $reason, 'status' => PayoutStatus::Held]);
                }

                if (! $existing->isDirty()) {
                    return 'unchanged';
                }

                $existing->save();

                return 'updated';
            });
        } catch (UniqueConstraintViolationException $e) {
            // A parallel writer inserted the same settlement first: apply the rules again.
            if ($retry) {
                return $this->upsert($shop, $record, $status, false);
            }

            throw $e;
        }
    }

    /**
     * A settled daily aggregate only grows: the same settled status with a higher amount
     * updates it; anything else leaves it as it is.
     *
     * @return 'updated'|'unchanged'|'protected'
     */
    private function raiseSettledTotal(Shop $shop, Payout $existing, SettlementRecord $record, PayoutStatus $status): string
    {
        if ($status !== PayoutStatus::Settled || $record->amountMinor < $existing->amount_minor) {
            if ($status === PayoutStatus::Settled) {
                Log::warning(self::NAME.'.settled_total_decreased', ['shop_id' => $shop->id, 'payout_id' => $existing->id]);
            }

            return 'protected';
        }

        if ($record->amountMinor === $existing->amount_minor) {
            return 'unchanged';
        }

        $existing->forceFill(['amount_minor' => $record->amountMinor])->save();

        return 'updated';
    }

    /**
     * @return array{shops: int, failed_shops: int, created: int, updated: int, unchanged: int, protected: int, rejected: int}
     */
    private static function emptySummary(): array
    {
        return ['shops' => 0, 'failed_shops' => 0, 'created' => 0, 'updated' => 0, 'unchanged' => 0, 'protected' => 0, 'rejected' => 0];
    }
}
