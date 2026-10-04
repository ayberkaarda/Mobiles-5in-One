<?php

namespace App\Domain\Shops\Support;

/**
 * Turkish tax identification number (vergi kimlik numarası, VKN): ten digits, the last
 * one a check digit over the first nine.
 */
final class TurkishTaxNumber
{
    public static function isValid(string $value): bool
    {
        if (preg_match('/^\d{10}$/', $value) !== 1) {
            return false;
        }

        return self::checkDigit(substr($value, 0, 9)) === (int) $value[9];
    }

    /**
     * Check digit for the first nine digits.
     */
    public static function checkDigit(string $firstNine): int
    {
        if (preg_match('/^\d{9}$/', $firstNine) !== 1) {
            throw new \InvalidArgumentException('Nine digits are required.');
        }

        $sum = 0;

        for ($i = 0; $i < 9; $i++) {
            $shifted = ((int) $firstNine[$i] + 9 - $i) % 10;
            $weighted = ($shifted * (2 ** (9 - $i))) % 9;

            if ($shifted !== 0 && $weighted === 0) {
                $weighted = 9;
            }

            $sum += $weighted;
        }

        return (10 - ($sum % 10)) % 10;
    }

    /**
     * Last four digits behind a mask, for the owner's own view.
     */
    public static function mask(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return str_repeat('*', max(strlen($value) - 4, 0)).substr($value, -4);
    }
}
