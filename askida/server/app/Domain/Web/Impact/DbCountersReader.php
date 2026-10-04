<?php

namespace App\Domain\Web\Impact;

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Services\ImpactReader;
use App\Domain\Impact\Services\ImpactSnapshotService;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Data\DistrictCounters;
use App\Domain\Web\Data\HomeCounters;
use App\Support\Web\TurkishSlug;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Counters of the public pages read from the database and cached for CACHE_SECONDS (only
 * plain arrays are cached). Counts are of item units and shops, never of people.
 *
 * - availableNow: AVAILABLE hooks of verified shops (non-sample) of the area, right now;
 * - donated / redeemed / shops: the latest impact snapshot day, rolled up by ImpactReader's
 *   small-cell rule;
 * - isSample: sample shops are allowed and every real figure is zero: the figures are then
 *   read from the sample shops instead (the page labels them [ÖRNEK]).
 */
final class DbCountersReader implements CountersReader
{
    public const CACHE_SECONDS = 300;

    public function __construct(private readonly ImpactReader $impact) {}

    public function home(): HomeCounters
    {
        /** @var array{available: int, donated: int, redeemed: int, shops: int, sample: bool, as_of: string} $data */
        $data = Cache::remember($this->key('home'), self::CACHE_SECONDS, fn (): array => $this->computeHome());

        return new HomeCounters(
            availableNow: $data['available'],
            donatedToday: $data['donated'],
            redeemedToday: $data['redeemed'],
            shops: $data['shops'],
            asOf: CarbonImmutable::parse($data['as_of']),
            isSample: $data['sample'],
            methodology: ImpactSnapshotService::METHODOLOGY,
        );
    }

    public function district(string $il, ?string $ilce): DistrictCounters
    {
        /** @var array{level: string, available: int, donated: int, redeemed: int, shops: int, day: string|null, sample: bool, as_of: string} $data */
        $data = Cache::remember($this->key('district:'.$il.':'.($ilce ?? '')), self::CACHE_SECONDS, fn (): array => $this->computeDistrict($il, $ilce));

        return new DistrictCounters(
            il: $il,
            ilce: $ilce,
            level: $data['level'],
            availableNow: $data['available'],
            donated: $data['donated'],
            redeemed: $data['redeemed'],
            shops: $data['shops'],
            day: $data['day'],
            asOf: CarbonImmutable::parse($data['as_of']),
            isSample: $data['sample'],
            methodology: ImpactSnapshotService::METHODOLOGY,
        );
    }

    /**
     * @return array{available: int, donated: int, redeemed: int, shops: int, sample: bool, as_of: string}
     */
    private function computeHome(): array
    {
        $latest = $this->impact->latest(null, null);
        $available = $this->available(false, null, null);
        $real = ['available' => $available, 'donated' => $latest['donated'], 'redeemed' => $latest['redeemed'], 'shops' => $latest['shops']];

        if (array_sum($real) === 0 && $this->sampleAllowed()) {
            return [...$this->sampleFigures(null, null), 'sample' => true, 'as_of' => $this->now()];
        }

        return [...$real, 'sample' => false, 'as_of' => $this->now()];
    }

    /**
     * @return array{level: string, available: int, donated: int, redeemed: int, shops: int, day: string|null, sample: bool, as_of: string}
     */
    private function computeDistrict(string $ilSlug, ?string $ilceSlug): array
    {
        [$il, $ilce] = $this->names($ilSlug, $ilceSlug);

        $latest = $this->impact->latest($il, $ilce);
        $available = $this->available(false, $il, $ilce);
        $real = ['available' => $available, 'donated' => $latest['donated'], 'redeemed' => $latest['redeemed'], 'shops' => $latest['shops']];

        if (array_sum($real) === 0 && $this->sampleAllowed()) {
            return [...$this->sampleFigures($il, $ilce), 'level' => $ilce === null ? 'il' : 'ilce', 'day' => null, 'sample' => true, 'as_of' => $this->now()];
        }

        return [...$real, 'level' => $latest['level'], 'day' => $latest['day'], 'sample' => false, 'as_of' => $this->now()];
    }

    /**
     * Display names of the slugs as the shops store them; an unknown slug is kept as given
     * (it then matches nothing and the figures roll up to the country).
     *
     * @return array{0: string|null, 1: string|null}
     */
    private function names(string $ilSlug, ?string $ilceSlug): array
    {
        $rows = DB::table('shops')->select('il', 'ilce')->distinct()->get();
        $il = null;
        $ilce = null;

        foreach ($rows as $row) {
            if ($il === null && TurkishSlug::make((string) $row->il) === $ilSlug) {
                $il = (string) $row->il;
            }

            if ($ilceSlug !== null && $il !== null && $row->il === $il && TurkishSlug::make((string) $row->ilce) === $ilceSlug) {
                $ilce = (string) $row->ilce;
            }
        }

        $il ??= $ilSlug;

        if ($ilceSlug !== null) {
            $ilce ??= $ilceSlug;
        }

        return [$il, $ilce];
    }

    /**
     * @return array{available: int, donated: int, redeemed: int, shops: int}
     */
    private function sampleFigures(?string $il, ?string $ilce): array
    {
        $zone = (string) config('app.timezone');
        $start = CarbonImmutable::now($zone)->startOfDay();
        $end = $start->addDay();

        $shops = $this->shops(true);
        $this->area($shops, 'shops', $il, $ilce);

        $donated = DB::table('donations')
            ->join('shops', 'shops.id', '=', 'donations.shop_id')
            ->where('shops.is_sample', true)
            ->where('donations.status', DonationStatus::Paid->value)
            ->where('donations.paid_at', '>=', $start->toIso8601String())
            ->where('donations.paid_at', '<', $end->toIso8601String());
        $this->area($donated, 'shops', $il, $ilce);

        $redeemed = DB::table('hooks')
            ->join('shops', 'shops.id', '=', 'hooks.shop_id')
            ->where('shops.is_sample', true)
            ->where('hooks.status', HookStatus::Redeemed->value)
            ->where('hooks.redeemed_at', '>=', $start->toIso8601String())
            ->where('hooks.redeemed_at', '<', $end->toIso8601String());
        $this->area($redeemed, 'shops', $il, $ilce);

        return [
            'available' => $this->available(true, $il, $ilce),
            'donated' => (int) $donated->sum('donations.qty'),
            'redeemed' => $redeemed->count(),
            'shops' => $shops->count(),
        ];
    }

    private function available(bool $sample, ?string $il, ?string $ilce): int
    {
        $query = DB::table('hooks')
            ->join('shops', 'shops.id', '=', 'hooks.shop_id')
            ->where('shops.is_sample', $sample)
            ->where('shops.verification_state', ShopVerificationState::Verified->value)
            ->where('hooks.status', HookStatus::Available->value);

        $this->area($query, 'shops', $il, $ilce);

        return $query->count();
    }

    private function shops(bool $sample): Builder
    {
        return DB::table('shops')
            ->where('is_sample', $sample)
            ->where('verification_state', ShopVerificationState::Verified->value);
    }

    private function area(Builder $query, string $table, ?string $il, ?string $ilce): void
    {
        if ($il !== null) {
            $query->where($table.'.il', $il);
        }

        if ($ilce !== null) {
            $query->where($table.'.ilce', $ilce);
        }
    }

    private function sampleAllowed(): bool
    {
        return (bool) config('askida.allow_sample_shops');
    }

    private function key(string $suffix): string
    {
        return 'web:counters:v1:'.($this->sampleAllowed() ? 's' : 'r').':'.hash('sha256', $suffix);
    }

    private function now(): string
    {
        return CarbonImmutable::now()->toIso8601String();
    }
}
