<?php

namespace App\Domain\Web\Impact;

/**
 * The small-cell rule of the public impact figures (the same threshold as ImpactReader): a
 * district is listed on its own only when it has at least MIN_SHOPS verified shops;
 * otherwise it is pooled into "other districts" of its province, and a pool below the
 * threshold joins the national pool, so the figures of a single shop are never singled out.
 *
 * @phpstan-type Row array{il: string, ilce: string, donated: int, redeemed: int, shops: int}
 */
final class ImpactRollup
{
    public const MIN_SHOPS = 3;

    public const OTHER_DISTRICTS = 'Diğer ilçeler';

    public const OTHER_PROVINCES = 'Diğer iller';

    /**
     * Pools the rows of one period (all rows describe the same day or window).
     *
     * @param  list<Row>  $rows
     * @return list<Row>
     */
    public static function apply(array $rows): array
    {
        $kept = [];
        $leftover = [];

        foreach ($rows as $row) {
            if ($row['shops'] >= self::MIN_SHOPS) {
                $kept[] = $row;
            } else {
                $leftover[$row['il']][] = $row;
            }
        }

        $national = null;

        foreach ($leftover as $il => $cells) {
            $pool = self::sum($cells, (string) $il, self::OTHER_DISTRICTS);

            if ($pool['shops'] >= self::MIN_SHOPS) {
                $kept[] = $pool;

                continue;
            }

            $national = self::sum([...($national === null ? [] : [$national]), $pool], self::OTHER_PROVINCES, self::OTHER_DISTRICTS);
        }

        if ($national !== null) {
            $kept[] = $national;
        }

        return $kept;
    }

    /**
     * Provinces of one window: a province with fewer than MIN_SHOPS shops joins "other
     * provinces" (rows carry the province in `il`; `ilce` is empty).
     *
     * @param  list<Row>  $rows
     * @return list<Row>
     */
    public static function provinces(array $rows): array
    {
        $kept = [];
        $leftover = [];

        foreach ($rows as $row) {
            if ($row['shops'] >= self::MIN_SHOPS) {
                $kept[] = $row;
            } else {
                $leftover[] = $row;
            }
        }

        if ($leftover !== []) {
            $kept[] = self::sum($leftover, self::OTHER_PROVINCES, '');
        }

        return $kept;
    }

    /**
     * Districts of one province: those below MIN_SHOPS join "other districts" (the province
     * total is shown separately, so the pool needs no further roll-up).
     *
     * @param  list<Row>  $rows
     * @return list<Row>
     */
    public static function districts(array $rows): array
    {
        $kept = [];
        $leftover = [];

        foreach ($rows as $row) {
            if ($row['shops'] >= self::MIN_SHOPS) {
                $kept[] = $row;
            } else {
                $leftover[] = $row;
            }
        }

        if ($leftover !== []) {
            $kept[] = self::sum($leftover, $leftover[0]['il'], self::OTHER_DISTRICTS);
        }

        return $kept;
    }

    /**
     * @param  list<Row>  $rows
     * @return Row
     */
    private static function sum(array $rows, string $il, string $ilce): array
    {
        return [
            'il' => $il,
            'ilce' => $ilce,
            'donated' => array_sum(array_column($rows, 'donated')),
            'redeemed' => array_sum(array_column($rows, 'redeemed')),
            'shops' => array_sum(array_column($rows, 'shops')),
        ];
    }
}
