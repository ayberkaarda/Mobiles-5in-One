<?php

namespace Askida\PHPStan\Fixtures;

use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Fixture for tests/Unit/Phpstan: raw SQL with bound parameters and literal-only
 * strings; NoInterpolatedRawSqlRule must report nothing here. Not part of the normal
 * analysis paths.
 */
final class GoodRawSql
{
    private const DISTANCE = 'ST_Distance(location, ST_MakePoint(?, ?)::geography)';

    public function nearby(Builder $query, float $lng, float $lat, int $radius): Builder
    {
        return $query
            ->whereRaw('ST_DWithin(location, ST_MakePoint(?, ?)::geography, ?)', [$lng, $lat, $radius])
            ->orderByRaw(self::DISTANCE.' asc', [$lng, $lat]);
    }

    public function counts(Builder $query, int $minimum): Builder
    {
        return $query
            ->selectRaw('count(*) as total')
            ->groupByRaw('date(created_at)')
            ->havingRaw('count(*) > ?', [$minimum]);
    }

    public function literalPieces(): Expression
    {
        return DB::raw('count(*) '.'as total');
    }

    public function boundStatement(string $email): bool
    {
        return DB::statement('update users set deactivated_at = now() where email = ?', [$email]);
    }

    public function nowdoc(Builder $query): Builder
    {
        return $query->whereRaw(<<<'SQL'
            kind = 'merchant'
            SQL);
    }
}
