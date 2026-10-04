<?php

namespace App\Domain\Web\Impact;

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Shops\Models\ShopVerificationState;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Day-level impact cells (il, ilce, day, donated, redeemed, shops) of the public impact
 * pages and the open data CSV. Real cells come from `impact_snapshots` (which never contain
 * sample shops); only when sample shops are allowed and the real cells of the window are all
 * zero, the cells are derived from the sample shops, so a portfolio build shows labelled
 * example figures instead of an empty page.
 *
 * @phpstan-type Cell array{day: string, il: string, ilce: string, donated: int, redeemed: int, shops: int}
 */
final class ImpactCells
{
    /**
     * @return array{cells: list<Cell>, sample: bool}
     */
    public function between(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $real = $this->snapshotCells($from, $to);
        $total = array_sum(array_map(static fn (array $c): int => $c['donated'] + $c['redeemed'] + $c['shops'], $real));

        if ($total > 0) {
            return ['cells' => $real, 'sample' => false];
        }

        if ((bool) config('askida.allow_sample_shops')) {
            $sample = $this->sampleCells($from, $to);

            if ($sample !== []) {
                return ['cells' => $sample, 'sample' => true];
            }
        }

        return ['cells' => $real, 'sample' => false];
    }

    /**
     * @return list<Cell>
     */
    private function snapshotCells(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $rows = ImpactSnapshot::query()
            ->toBase()
            ->whereDate('day', '>=', $from->toDateString())
            ->whereDate('day', '<=', $to->toDateString())
            ->orderBy('day')
            ->orderBy('il')
            ->orderBy('ilce')
            ->get(['il', 'ilce', 'day', 'donated', 'redeemed', 'shops']);

        $cells = [];

        foreach ($rows as $row) {
            $cells[] = [
                'day' => substr((string) $row->day, 0, 10),
                'il' => (string) $row->il,
                'ilce' => (string) $row->ilce,
                'donated' => (int) $row->donated,
                'redeemed' => (int) $row->redeemed,
                'shops' => (int) $row->shops,
            ];
        }

        return $cells;
    }

    /**
     * Same definitions as ImpactSnapshotService, over the sample shops, per calendar day of
     * the application time zone. Shops are the verified sample shops of the cell.
     *
     * @return list<Cell>
     */
    private function sampleCells(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $zone = (string) config('app.timezone');
        $start = CarbonImmutable::parse($from->toDateString(), $zone)->startOfDay()->toIso8601String();
        $end = CarbonImmutable::parse($to->toDateString(), $zone)->addDay()->startOfDay()->toIso8601String();

        $shops = DB::table('shops')
            ->where('is_sample', true)
            ->where('verification_state', ShopVerificationState::Verified->value)
            ->groupBy('il', 'ilce')
            ->selectRaw('il, ilce, COUNT(*) AS n')
            ->get();

        // Sample shops are few: rows are read and bucketed per calendar day in PHP, which keeps
        // the SQL free of time zone expressions.
        $donated = DB::table('donations')
            ->join('shops', 'shops.id', '=', 'donations.shop_id')
            ->where('shops.is_sample', true)
            ->where('donations.status', DonationStatus::Paid->value)
            ->where('donations.paid_at', '>=', $start)
            ->where('donations.paid_at', '<', $end)
            ->get(['shops.il as il', 'shops.ilce as ilce', 'donations.paid_at as at', 'donations.qty as n']);

        $redeemed = DB::table('hooks')
            ->join('shops', 'shops.id', '=', 'hooks.shop_id')
            ->where('shops.is_sample', true)
            ->where('hooks.status', HookStatus::Redeemed->value)
            ->where('hooks.redeemed_at', '>=', $start)
            ->where('hooks.redeemed_at', '<', $end)
            ->get(['shops.il as il', 'shops.ilce as ilce', 'hooks.redeemed_at as at']);

        $shopCount = [];

        foreach ($shops as $row) {
            $shopCount[$row->il."\n".$row->ilce] = (int) $row->n;
        }

        /** @var array<string, Cell> $cells */
        $cells = [];

        foreach (['donated' => $donated, 'redeemed' => $redeemed] as $metric => $rows) {
            foreach ($rows as $row) {
                $day = CarbonImmutable::parse((string) $row->at)->setTimezone($zone)->toDateString();
                $key = $day.'
'.$row->il.'
'.$row->ilce;
                $cells[$key] ??= [
                    'day' => $day,
                    'il' => (string) $row->il,
                    'ilce' => (string) $row->ilce,
                    'donated' => 0,
                    'redeemed' => 0,
                    'shops' => $shopCount[$row->il.'
'.$row->ilce] ?? 0,
                ];
                $cells[$key][$metric] += $metric === 'donated' ? (int) $row->n : 1;
            }
        }

        if ($cells === []) {
            $today = CarbonImmutable::now($zone)->toDateString();

            foreach ($shops as $row) {
                $cells[$today."\n".$row->il."\n".$row->ilce] = [
                    'day' => $today,
                    'il' => (string) $row->il,
                    'ilce' => (string) $row->ilce,
                    'donated' => 0,
                    'redeemed' => 0,
                    'shops' => (int) $row->n,
                ];
            }
        }

        ksort($cells);

        return array_values($cells);
    }
}
