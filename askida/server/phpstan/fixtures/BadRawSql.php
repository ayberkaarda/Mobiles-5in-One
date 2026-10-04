<?php

namespace Askida\PHPStan\Fixtures;

use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Fixture for tests/Unit/Phpstan: every method below must be reported by
 * NoInterpolatedRawSqlRule. Not part of the normal analysis paths.
 */
final class BadRawSql
{
    public function interpolatedRaw(string $column): Expression
    {
        return DB::raw("count({$column}) as total");
    }

    public function concatenatedWhereRaw(Builder $query, string $email): Builder
    {
        return $query->whereRaw('email = \''.$email.'\'');
    }

    public function interpolatedOrWhereRaw(Builder $query, string $name): Builder
    {
        return $query->orWhereRaw("name = '$name'");
    }

    public function concatenatedSelectRaw(Builder $query, string $alias): Builder
    {
        return $query->selectRaw('count(*) as '.$alias);
    }

    public function interpolatedOrderByRaw(Builder $query, string $direction): Builder
    {
        return $query->orderByRaw("created_at {$direction}");
    }

    public function concatenatedGroupByRaw(Builder $query, string $column): Builder
    {
        return $query->groupByRaw('date('.$column.')');
    }

    public function concatenatedHavingRaw(Builder $query, int $minimum): Builder
    {
        return $query->havingRaw('count(*) > '.$minimum);
    }

    public function interpolatedStatement(string $table): bool
    {
        return DB::statement("analyze {$table}");
    }

    public function concatenatedUnprepared(string $role): bool
    {
        return DB::unprepared('set role '.$role);
    }

    public function interpolatedFromRaw(Builder $query, string $table): Builder
    {
        return $query->fromRaw("{$table} as t");
    }

    public function heredocWhereRaw(Builder $query, string $code): Builder
    {
        return $query->whereRaw(<<<SQL
            code = '{$code}'
            SQL);
    }
}
