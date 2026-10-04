<?php

namespace App\Domain\Shops\Models;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * Casts a geography(Point, 4326) column to a GeoPoint. Writes go out as a bound EWKT
 * parameter, never as SQL text built from the coordinates.
 *
 * @implements CastsAttributes<GeoPoint, mixed>
 */
final class GeoPointCast implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?GeoPoint
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof GeoPoint) {
            return $value;
        }

        if (! is_string($value)) {
            throw new InvalidArgumentException("The [{$key}] attribute is not a geography value.");
        }

        if (str_starts_with($value, 'SRID=')) {
            return self::fromEwkt($value);
        }

        return GeoPoint::fromEwkbHex($value);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }

        if (! $value instanceof GeoPoint) {
            throw new InvalidArgumentException("The [{$key}] attribute must be a GeoPoint.");
        }

        return $value->toEwkt();
    }

    private static function fromEwkt(string $value): GeoPoint
    {
        if (preg_match('/^SRID=4326;POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/', $value, $matches) !== 1) {
            throw new InvalidArgumentException('Value is not a point in SRID 4326.');
        }

        return new GeoPoint((float) $matches[2], (float) $matches[1]);
    }
}
