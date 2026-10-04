<?php

namespace App\Domain\Shops\Support;

/**
 * Turkish IBAN: `TR`, two check digits and 22 digits (26 characters), valid under the
 * ISO 13616 mod-97 check.
 */
final class TurkishIban
{
    public static function normalise(string $value): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', $value));
    }

    public static function isValid(string $value): bool
    {
        if (preg_match('/^TR\d{24}$/', $value) !== 1) {
            return false;
        }

        return self::mod97(substr($value, 4).substr($value, 0, 4)) === 1;
    }

    /**
     * Check digits for a Turkish basic bank account number (the 22 digits after them).
     */
    public static function checkDigits(string $bban): string
    {
        if (preg_match('/^\d{22}$/', $bban) !== 1) {
            throw new \InvalidArgumentException('Twenty-two digits are required.');
        }

        return sprintf('%02d', 98 - self::mod97($bban.'TR00'));
    }

    /**
     * Remainder of the letter-expanded value divided by 97, computed in chunks so no
     * big-number arithmetic is needed.
     */
    private static function mod97(string $value): int
    {
        $digits = '';

        foreach (str_split($value) as $char) {
            $digits .= ctype_alpha($char) ? (string) (ord($char) - 55) : $char;
        }

        $remainder = 0;

        foreach (str_split($digits, 7) as $chunk) {
            $remainder = (int) ($remainder.$chunk) % 97;
        }

        return $remainder;
    }

    /**
     * Country code and last four digits, for the owner's own view.
     */
    public static function mask(?string $value): ?string
    {
        if ($value === null || strlen($value) < 8) {
            return null;
        }

        return substr($value, 0, 2).str_repeat('*', strlen($value) - 6).substr($value, -4);
    }
}
