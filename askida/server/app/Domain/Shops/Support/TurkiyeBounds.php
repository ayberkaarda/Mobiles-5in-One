<?php

namespace App\Domain\Shops\Support;

/**
 * The bounding box the database enforces on shop locations
 * (`shops_location_turkiye_bbox_check`).
 */
final class TurkiyeBounds
{
    public const MIN_LATITUDE = 35.8;

    public const MAX_LATITUDE = 42.2;

    public const MIN_LONGITUDE = 25.5;

    public const MAX_LONGITUDE = 45.0;

    public static function contains(float $latitude, float $longitude): bool
    {
        return $latitude >= self::MIN_LATITUDE && $latitude <= self::MAX_LATITUDE
            && $longitude >= self::MIN_LONGITUDE && $longitude <= self::MAX_LONGITUDE;
    }
}
