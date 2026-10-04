<?php

namespace App\Domain\Fraud\Services;

use App\Domain\Fraud\Mail\PayoutHoldAlertMail;
use App\Domain\Fraud\Models\AbuseFlagKind;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Payouts\Services\PayoutHoldService;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * The fraud budget (spec item 22). For every verified shop, over the last WINDOW_MINUTES:
 * redemptions (REDEEMED hooks by `redeemed_at`) and `suspicious_self_redeem` activity
 * entries. A shop above any threshold (every threshold is a maximum: equal is fine):
 *
 * - redemptions > payments.fraud.max_redeems_per_hour         -> `redeem_rate`
 * - self entries / redemptions > payments.fraud.max_self_redeem_ratio -> `self_redeem_ratio`
 * - self entries > payments.fraud.max_suspicious_self_redeems -> `self_redeem_count`
 *
 * gets its pending payouts held, and per kind (only while no unreviewed flag of that kind
 * exists) an `abuse_flags` row with counts only, an activity log entry and a queued alert
 * mail to finance.
 */
final class FraudScanner
{
    public const NAME = 'fraud.scan';

    public const LOG_NAME = 'fraud';

    public const WINDOW_MINUTES = 60;

    private const RATIO_SCALE = 1_000_000;

    public function __construct(
        private readonly PayoutHoldService $holds,
        private readonly AbuseFlagger $flags,
    ) {}

    /**
     * @return array{shops: int, flagged: int, held_payouts: int}
     */
    public function scan(?CarbonImmutable $now = null): array
    {
        $end = $now ?? CarbonImmutable::now();
        $start = $end->subMinutes(self::WINDOW_MINUTES);
        $summary = ['shops' => 0, 'flagged' => 0, 'held_payouts' => 0];

        $redemptions = $this->redemptionsPerShop($start, $end);
        $selfRedeems = $this->selfRedeemsPerShop($start, $end);
        $shopIds = array_values(array_filter(
            array_unique([...array_keys($redemptions), ...array_keys($selfRedeems)]),
            static fn (string $id): bool => Str::isUuid($id),
        ));

        if ($shopIds === []) {
            return $summary;
        }

        $shops = Shop::query()
            ->whereIn('id', $shopIds)
            ->where('verification_state', ShopVerificationState::Verified->value)
            ->get();

        foreach ($shops as $shop) {
            $summary['shops']++;
            $redeemed = $redemptions[$shop->id] ?? 0;
            $self = $selfRedeems[$shop->id] ?? 0;

            foreach ($this->exceeded($redeemed, $self) as $kind => $threshold) {
                $outcome = $this->flag($shop, AbuseFlagKind::from($kind), $redeemed, $self, $threshold);
                $summary['flagged'] += $outcome['flagged'] ? 1 : 0;
                $summary['held_payouts'] += $outcome['held'];
            }
        }

        Log::info(self::NAME, $summary);

        return $summary;
    }

    /**
     * Kinds whose threshold is exceeded, with the threshold value.
     *
     * @return array<string, int|float>
     */
    public function exceeded(int $redeemed, int $self): array
    {
        $maxRedeems = (int) config('payments.fraud.max_redeems_per_hour', 30);
        $maxRatio = (float) config('payments.fraud.max_self_redeem_ratio', 0.5);
        $maxSelf = (int) config('payments.fraud.max_suspicious_self_redeems', 3);
        $kinds = [];

        if ($redeemed > $maxRedeems) {
            $kinds[AbuseFlagKind::RedeemRate->value] = $maxRedeems;
        }

        // Integer comparison of self/redeemed > ratio, so an exact boundary never flips
        // through floating point rounding.
        if ($redeemed > 0 && $self * self::RATIO_SCALE > (int) round($maxRatio * self::RATIO_SCALE) * $redeemed) {
            $kinds[AbuseFlagKind::SelfRedeemRatio->value] = $maxRatio;
        }

        if ($self > $maxSelf) {
            $kinds[AbuseFlagKind::SelfRedeemCount->value] = $maxSelf;
        }

        return $kinds;
    }

    /**
     * @return array{flagged: bool, held: int}
     */
    private function flag(Shop $shop, AbuseFlagKind $kind, int $redeemed, int $self, int|float $threshold): array
    {
        return DB::transaction(function () use ($shop, $kind, $redeemed, $self, $threshold): array {
            $held = $this->holds->hold($shop, $kind->holdReason());

            $detail = [
                'window_minutes' => self::WINDOW_MINUTES,
                'redemptions' => $redeemed,
                'suspicious_self_redeems' => $self,
                'threshold' => $threshold,
                'held_payouts' => $held,
            ];

            $flag = $this->flags->raise($shop, $kind, $detail);

            if ($flag === null) {
                return ['flagged' => false, 'held' => $held];
            }

            activity(self::LOG_NAME)
                ->performedOn($shop)
                ->event('fraud.flagged')
                ->withProperties(['shop_id' => $shop->id, 'abuse_flag_id' => $flag->id, 'kind' => $kind->value, ...$detail])
                ->log('fraud.flagged');

            $recipient = config('payments.finance_alert_email');

            if (is_string($recipient) && $recipient !== '') {
                Mail::to($recipient)->queue(new PayoutHoldAlertMail($shop->id, $flag->id, $kind->value, $detail));
            }

            return ['flagged' => true, 'held' => $held];
        });
    }

    /**
     * @return array<string, int> shop id => REDEEMED hooks in [start, end)
     */
    private function redemptionsPerShop(CarbonImmutable $start, CarbonImmutable $end): array
    {
        $rows = DB::table('hooks')
            ->where('status', HookStatus::Redeemed->value)
            ->where('redeemed_at', '>=', self::stamp($start))
            ->where('redeemed_at', '<', self::stamp($end))
            ->groupBy('shop_id')
            ->selectRaw('shop_id, COUNT(*) AS n')
            ->get();

        return self::counts($rows);
    }

    /**
     * @param  iterable<object>  $rows  objects with `shop_id` and `n`
     * @return array<string, int>
     */
    private static function counts(iterable $rows): array
    {
        $out = [];

        foreach ($rows as $row) {
            /** @var object{shop_id: mixed, n: mixed} $row */
            $out[(string) $row->shop_id] = (int) $row->n;
        }

        return $out;
    }

    /**
     * @return array<string, int> shop id => `suspicious_self_redeem` entries in [start, end)
     */
    private function selfRedeemsPerShop(CarbonImmutable $start, CarbonImmutable $end): array
    {
        // activity_log.created_at is a timestamp without zone in the session zone; the
        // bounds are cast from offset-qualified strings, so the comparison is exact.
        $rows = DB::table('activity_log')
            ->where('log_name', 'hooks')
            ->where('event', 'suspicious_self_redeem')
            ->whereRaw('created_at >= ?::timestamptz', [self::stamp($start)])
            ->whereRaw('created_at < ?::timestamptz', [self::stamp($end)])
            ->whereRaw("properties->>'shop_id' IS NOT NULL")
            ->groupByRaw("properties->>'shop_id'")
            ->selectRaw("properties->>'shop_id' AS shop_id, COUNT(*) AS n")
            ->get();

        return self::counts($rows);
    }

    private static function stamp(CarbonImmutable $time): string
    {
        return $time->format('Y-m-d H:i:s.uP');
    }
}
