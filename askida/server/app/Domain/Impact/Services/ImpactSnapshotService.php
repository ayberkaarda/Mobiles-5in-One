<?php

namespace App\Domain\Impact\Services;

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Shops\Models\ShopVerificationState;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Public district counters (spec story 8), methodology METHODOLOGY:
 *
 * - donated: units (donation qty) of donations in status `paid` whose payment time
 *   falls on the day;
 * - redeemed: units in status REDEEMED whose redemption time falls on the day;
 * - shops: verified shops at the time of the snapshot.
 *
 * Days are calendar days in the application time zone (Europe/Istanbul). The district
 * is the shop's il/ilce. Sample shops (`is_sample`) and everything attached to them are
 * excluded. Only counts are stored: no shop, donor or recipient identifiers.
 */
class ImpactSnapshotService
{
    public const METHODOLOGY = 'impact.v1.daily_units';

    /**
     * Recomputes the snapshot rows of one day and returns the number of districts
     * written. Districts that no longer have any activity that day are set to zero.
     */
    public function snapshot(?CarbonInterface $day = null): int
    {
        $start = CarbonImmutable::parse(($day ?? Carbon::now())->format('Y-m-d'), (string) config('app.timezone'))->startOfDay();
        $end = $start->addDay();

        /** @var array<string, array{il: string, ilce: string, donated: int, redeemed: int, shops: int}> $cells */
        $cells = [];

        $donated = DB::table('donations')
            ->join('shops', 'shops.id', '=', 'donations.shop_id')
            ->where('shops.is_sample', false)
            ->where('donations.status', DonationStatus::Paid->value)
            ->where('donations.paid_at', '>=', $start->toIso8601String())
            ->where('donations.paid_at', '<', $end->toIso8601String())
            ->groupBy('shops.il', 'shops.ilce')
            ->selectRaw('shops.il AS il, shops.ilce AS ilce, SUM(donations.qty) AS n')
            ->get();

        $redeemed = DB::table('hooks')
            ->join('shops', 'shops.id', '=', 'hooks.shop_id')
            ->where('shops.is_sample', false)
            ->where('hooks.status', HookStatus::Redeemed->value)
            ->where('hooks.redeemed_at', '>=', $start->toIso8601String())
            ->where('hooks.redeemed_at', '<', $end->toIso8601String())
            ->groupBy('shops.il', 'shops.ilce')
            ->selectRaw('shops.il AS il, shops.ilce AS ilce, COUNT(*) AS n')
            ->get();

        $shops = DB::table('shops')
            ->where('is_sample', false)
            ->where('verification_state', ShopVerificationState::Verified->value)
            ->groupBy('il', 'ilce')
            ->selectRaw('il, ilce, COUNT(*) AS n')
            ->get();

        foreach (['donated' => $donated, 'redeemed' => $redeemed, 'shops' => $shops] as $metric => $rows) {
            foreach ($rows as $row) {
                $key = $row->il."\n".$row->ilce;
                $cells[$key] ??= ['il' => (string) $row->il, 'ilce' => (string) $row->ilce, 'donated' => 0, 'redeemed' => 0, 'shops' => 0];
                $cells[$key][$metric] = (int) $row->n;
            }
        }

        $dayString = $start->toDateString();
        $now = Carbon::now()->toIso8601String();

        return DB::transaction(function () use ($cells, $dayString, $now): int {
            ImpactSnapshot::query()
                ->whereDate('day', $dayString)
                ->update(['donated' => 0, 'redeemed' => 0, 'shops' => 0, 'updated_at' => $now]);

            if ($cells === []) {
                return 0;
            }

            $rows = array_map(static fn (array $cell): array => [
                'id' => (string) Str::uuid7(),
                'il' => $cell['il'],
                'ilce' => $cell['ilce'],
                'day' => $dayString,
                'donated' => $cell['donated'],
                'redeemed' => $cell['redeemed'],
                'shops' => $cell['shops'],
                'created_at' => $now,
                'updated_at' => $now,
            ], array_values($cells));

            DB::table('impact_snapshots')->upsert($rows, ['il', 'ilce', 'day'], ['donated', 'redeemed', 'shops', 'updated_at']);

            return count($rows);
        });
    }
}
