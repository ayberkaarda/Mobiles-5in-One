<?php

namespace App\Domain\Web\Impact;

use App\Support\Web\TurkishSlug;
use Carbon\CarbonImmutable;

/**
 * Read model of the public impact pages and the open data CSV: the last 30 days per
 * province and district (`/etki`, `/etki/{il}`) and the last 90 days per day (`/etki.csv`).
 * Counts are of item units and shops, never of people; the small-cell rule
 * (ImpactRollup) pools cells below three shops.
 *
 * @phpstan-import-type Cell from ImpactCells
 * @phpstan-import-type Row from ImpactRollup
 */
final class ImpactWebReader
{
    public const WINDOW_DAYS = 30;

    public const CSV_DAYS = 90;

    public const CSV_HEADER = ['day', 'il', 'ilce', 'donated', 'redeemed', 'shops'];

    public function __construct(private readonly ImpactCells $cells) {}

    /**
     * @return array{from: CarbonImmutable, to: CarbonImmutable}
     */
    public function window(int $days): array
    {
        $to = CarbonImmutable::now((string) config('app.timezone'))->startOfDay();

        return ['from' => $to->subDays($days - 1), 'to' => $to];
    }

    /**
     * The country page: totals of the last 30 days and one row per province.
     */
    public function overview(): ImpactOverview
    {
        ['from' => $from, 'to' => $to] = $this->window(self::WINDOW_DAYS);
        ['cells' => $cells, 'sample' => $sample] = $this->cells->between($from, $to);

        $districts = $this->aggregate($cells);
        $total = $this->total($districts);

        $perProvince = [];

        foreach ($districts as $row) {
            $perProvince[$row['il']] ??= ['il' => $row['il'], 'ilce' => '', 'donated' => 0, 'redeemed' => 0, 'shops' => 0];
            $perProvince[$row['il']]['donated'] += $row['donated'];
            $perProvince[$row['il']]['redeemed'] += $row['redeemed'];
            $perProvince[$row['il']]['shops'] += $row['shops'];
        }

        $rows = ImpactRollup::provinces(array_values($perProvince));
        usort($rows, static fn (array $a, array $b): int => [$a['il'] === ImpactRollup::OTHER_PROVINCES, $a['il']] <=> [$b['il'] === ImpactRollup::OTHER_PROVINCES, $b['il']]);

        return new ImpactOverview(
            from: $from,
            to: $to,
            donated: $total['donated'],
            redeemed: $total['redeemed'],
            shops: $total['shops'],
            sample: $sample,
            rows: array_map(fn (array $row): ImpactRow => $this->impactRow($row, $row['il'], ImpactRollup::OTHER_PROVINCES), $rows),
        );
    }

    /**
     * A province page, or null when the slug matches no province with figures.
     */
    public function province(string $ilSlug): ?ProvinceImpact
    {
        ['from' => $from, 'to' => $to] = $this->window(self::WINDOW_DAYS);
        ['cells' => $cells, 'sample' => $sample] = $this->cells->between($from, $to);

        $districts = $this->aggregate($cells);
        $name = null;

        foreach ($districts as $row) {
            if (TurkishSlug::make($row['il']) === $ilSlug) {
                $name = $row['il'];

                break;
            }
        }

        if ($name === null) {
            return null;
        }

        $own = array_values(array_filter($districts, static fn (array $row): bool => $row['il'] === $name));
        $total = $this->total($own);
        $listed = $total['shops'] >= ImpactRollup::MIN_SHOPS;

        $rows = [];

        if ($listed) {
            $pooled = ImpactRollup::districts($own);
            usort($pooled, static fn (array $a, array $b): int => [$a['ilce'] === ImpactRollup::OTHER_DISTRICTS, $a['ilce']] <=> [$b['ilce'] === ImpactRollup::OTHER_DISTRICTS, $b['ilce']]);
            $rows = array_map(fn (array $row): ImpactRow => $this->impactRow($row, $row['ilce'], ImpactRollup::OTHER_DISTRICTS, province: false), $pooled);
        }

        return new ProvinceImpact(
            name: $name,
            slug: $ilSlug,
            from: $from,
            to: $to,
            listed: $listed,
            donated: $listed ? $total['donated'] : 0,
            redeemed: $listed ? $total['redeemed'] : 0,
            shops: $listed ? $total['shops'] : 0,
            sample: $sample,
            rows: $rows,
        );
    }

    /**
     * Provinces that have their own figures (a province page worth indexing): name and slug.
     *
     * @return list<array{name: string, slug: string}>
     */
    public function publishedProvinces(): array
    {
        $provinces = [];

        foreach ($this->overview()->rows as $row) {
            if ($row->slug !== null) {
                $provinces[] = ['name' => $row->name, 'slug' => $row->slug];
            }
        }

        return $provinces;
    }

    /**
     * Rows of the open data CSV: one row per day and cell of the last 90 days, small cells
     * pooled per day. Example (sample shop) figures are never published as data.
     *
     * @return list<array{day: string, il: string, ilce: string, donated: int, redeemed: int, shops: int}>
     */
    public function csvRows(): array
    {
        ['from' => $from, 'to' => $to] = $this->window(self::CSV_DAYS);
        ['cells' => $cells, 'sample' => $sample] = $this->cells->between($from, $to);

        // Open data is never filled with example figures: a sample build serves the header only.
        if ($sample) {
            return [];
        }

        $perDay = [];

        foreach ($cells as $cell) {
            $perDay[$cell['day']][] = [
                'il' => $cell['il'],
                'ilce' => $cell['ilce'],
                'donated' => $cell['donated'],
                'redeemed' => $cell['redeemed'],
                'shops' => $cell['shops'],
            ];
        }

        ksort($perDay);

        $out = [];

        foreach ($perDay as $day => $rows) {
            foreach (ImpactRollup::apply($rows) as $row) {
                $out[] = ['day' => (string) $day, ...$row];
            }
        }

        return $out;
    }

    /**
     * Cells of a window summed per district: units add up over the days, the shop count is the
     * one of the cell's latest day (shops are a level, not a flow).
     *
     * @param  list<Cell>  $cells  ordered by day
     * @return list<Row>
     */
    private function aggregate(array $cells): array
    {
        $rows = [];

        foreach ($cells as $cell) {
            $key = $cell['il']."\n".$cell['ilce'];
            $rows[$key] ??= ['il' => $cell['il'], 'ilce' => $cell['ilce'], 'donated' => 0, 'redeemed' => 0, 'shops' => 0];
            $rows[$key]['donated'] += $cell['donated'];
            $rows[$key]['redeemed'] += $cell['redeemed'];
            $rows[$key]['shops'] = $cell['shops'];
        }

        return array_values($rows);
    }

    /**
     * @param  list<Row>  $rows
     * @return array{donated: int, redeemed: int, shops: int}
     */
    private function total(array $rows): array
    {
        return [
            'donated' => array_sum(array_column($rows, 'donated')),
            'redeemed' => array_sum(array_column($rows, 'redeemed')),
            'shops' => array_sum(array_column($rows, 'shops')),
        ];
    }

    /**
     * @param  Row  $row
     */
    private function impactRow(array $row, string $name, string $poolName, bool $province = true): ImpactRow
    {
        $isPool = $name === $poolName;

        return new ImpactRow(
            name: $name,
            slug: $province && ! $isPool ? TurkishSlug::make($name) : null,
            donated: $row['donated'],
            redeemed: $row['redeemed'],
            shops: $row['shops'],
        );
    }
}
