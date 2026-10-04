<?php

namespace App\Domain\Admin\Services;

use InvalidArgumentException;

/**
 * RFC 4648 base32 (upper-case alphabet, no padding), the encoding authenticator apps
 * expect for TOTP secrets.
 */
final class Base32
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function encode(string $bytes): string
    {
        if ($bytes === '') {
            return '';
        }

        $bits = '';

        foreach (str_split($bytes) as $byte) {
            $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
        }

        $output = '';

        foreach (str_split($bits, 5) as $chunk) {
            $output .= self::ALPHABET[(int) bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
        }

        return $output;
    }

    public static function decode(string $encoded): string
    {
        $encoded = strtoupper(rtrim(str_replace(' ', '', $encoded), '='));

        if ($encoded === '') {
            return '';
        }

        $bits = '';

        foreach (str_split($encoded) as $char) {
            $value = strpos(self::ALPHABET, $char);

            if ($value === false) {
                throw new InvalidArgumentException('The value is not base32.');
            }

            $bits .= str_pad(decbin($value), 5, '0', STR_PAD_LEFT);
        }

        $bytes = '';

        foreach (str_split($bits, 8) as $chunk) {
            if (strlen($chunk) === 8) {
                $bytes .= chr((int) bindec($chunk));
            }
        }

        return $bytes;
    }
}
