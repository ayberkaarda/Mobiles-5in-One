<?php

namespace App\Domain\Accounts\Services;

use Illuminate\Support\Str;

/**
 * Reduces a property array to identifiers: integers and UUID strings are kept (nested
 * arrays are filtered the same way), every other value is dropped.
 */
final class IdentifiersOnly
{
    /**
     * @param  array<array-key, mixed>  $properties
     * @return array<array-key, mixed>
     */
    public static function filter(array $properties): array
    {
        $kept = [];

        foreach ($properties as $key => $value) {
            if (is_array($value)) {
                $nested = self::filter($value);

                if ($nested !== []) {
                    $kept[$key] = $nested;
                }

                continue;
            }

            if (is_int($value) || (is_string($value) && Str::isUuid($value))) {
                $kept[$key] = $value;
            }
        }

        return $kept;
    }
}
