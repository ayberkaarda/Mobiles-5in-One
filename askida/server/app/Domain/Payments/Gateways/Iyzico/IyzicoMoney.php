<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use UnexpectedValueException;

/**
 * Conversion between kuruş (int) and the provider's decimal lira amounts.
 *
 * Requests carry amounts as decimal strings ("15.00"); responses may carry numbers or
 * strings. Floats are never used for our own arithmetic, only when parsing a response.
 */
final class IyzicoMoney
{
    public static function format(int $minor): string
    {
        if ($minor < 0) {
            throw new UnexpectedValueException('Amounts are never negative.');
        }

        return sprintf('%d.%02d', intdiv($minor, 100), $minor % 100);
    }

    public static function parse(mixed $value): int
    {
        if (is_int($value)) {
            return $value * 100;
        }

        if (is_float($value)) {
            return (int) round($value * 100);
        }

        if (is_string($value) && preg_match('/^(\d{1,12})(?:\.(\d{1,8}))?$/', trim($value), $match) === 1) {
            $fraction = str_pad(substr($match[2] ?? '', 0, 3), 3, '0');

            // Two decimals are kuruş; a third rounds half up.
            return (int) $match[1] * 100 + intdiv((int) $fraction + 5, 10);
        }

        throw new UnexpectedValueException('The provider returned an amount that is not a number.');
    }
}
