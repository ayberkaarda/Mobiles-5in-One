<?php

namespace App\Domain\Hooks\Codes;

/**
 * Redemption code format: 8 characters of Crockford base32 without I, L, O and U
 * (32 symbols, 40 bits). Input is normalised before validation: upper case, spaces and
 * dashes removed, I and L read as 1, O read as 0.
 */
final class HookCode
{
    public const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public const LENGTH = 8;

    public const PATTERN = '/^[0-9A-HJKMNP-TV-Z]{8}$/';

    public static function normalise(string $input): string
    {
        $code = strtoupper(str_replace([' ', '-', "\t"], '', $input));

        return strtr($code, ['I' => '1', 'L' => '1', 'O' => '0']);
    }

    public static function isValid(string $code): bool
    {
        return preg_match(self::PATTERN, $code) === 1;
    }
}
