<?php

namespace App\Domain\Impact\Services;

use App\Domain\Impact\Models\ImpactSnapshot;
use Illuminate\Support\Facades\Cache;
use LogicException;

/**
 * Public read of the latest impact snapshot day, cached CACHE_SECONDS.
 *
 * Small-cell rule: a district is shown on its own only when it has at least
 * MIN_SHOPS_PER_CELL verified shops; otherwise the answer rolls up to the province,
 * and a province below the threshold rolls up to the whole country, so the counters of
 * a single shop can never be singled out.
 */
class ImpactReader
{
    public const CACHE_SECONDS = 300;

    public const MIN_SHOPS_PER_CELL = 3;

    /**
     * @return array{day: string|null, level: string, il: string|null, ilce: string|null, donated: int, redeemed: int, shops: int, methodology: string}
     */
    public function latest(?string $il, ?string $ilce): array
    {
        $key = 'impact:v1:'.hash('sha256', ($il ?? '')."\n".($ilce ?? ''));

        /** @var array{day: string|null, level: string, il: string|null, ilce: string|null, donated: int, redeemed: int, shops: int, methodology: string} $result */
        $result = Cache::remember($key, self::CACHE_SECONDS, fn (): array => $this->compute($il, $ilce));

        return $result;
    }

    /**
     * @return array{day: string|null, level: string, il: string|null, ilce: string|null, donated: int, redeemed: int, shops: int, methodology: string}
     */
    private function compute(?string $il, ?string $ilce): array
    {
        $latest = ImpactSnapshot::query()->max('day');
        $day = is_string($latest) ? substr($latest, 0, 10) : null;

        $levels = [];

        if ($il !== null && $ilce !== null) {
            $levels[] = ['ilce', $il, $ilce];
        }

        if ($il !== null) {
            $levels[] = ['il', $il, null];
        }

        $levels[] = ['tr', null, null];

        foreach ($levels as $index => [$level, $levelIl, $levelIlce]) {
            $totals = $this->totals($day, $levelIl, $levelIlce);
            $isLast = $index === count($levels) - 1;

            if ($isLast || $totals['shops'] >= self::MIN_SHOPS_PER_CELL) {
                return [
                    'day' => $day,
                    'level' => $level,
                    'il' => $levelIl,
                    'ilce' => $levelIlce,
                    ...$totals,
                    'methodology' => ImpactSnapshotService::METHODOLOGY,
                ];
            }
        }

        throw new LogicException('The country level always answers.');
    }

    /**
     * @return array{donated: int, redeemed: int, shops: int}
     */
    private function totals(?string $day, ?string $il, ?string $ilce): array
    {
        if ($day === null) {
            return ['donated' => 0, 'redeemed' => 0, 'shops' => 0];
        }

        $query = ImpactSnapshot::query()->whereDate('day', $day);

        if ($il !== null) {
            $query->where('il', $il);
        }

        if ($ilce !== null) {
            $query->where('ilce', $ilce);
        }

        $row = $query->toBase()
            ->selectRaw('COALESCE(SUM(donated), 0) AS donated, COALESCE(SUM(redeemed), 0) AS redeemed, COALESCE(SUM(shops), 0) AS shops')
            ->first();

        return [
            'donated' => (int) ($row->donated ?? 0),
            'redeemed' => (int) ($row->redeemed ?? 0),
            'shops' => (int) ($row->shops ?? 0),
        ];
    }
}
