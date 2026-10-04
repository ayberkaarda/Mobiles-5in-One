<?php

namespace App\Support\Web;

/**
 * URL slugs of Turkish place and shop names: "Şişli" -> "sisli", "İstanbul" -> "istanbul",
 * "Kadıköy Moda" -> "kadikoy-moda". Turkish letters are folded by hand before lowercasing,
 * because a locale-unaware lowercase turns "I" into "i" and "İ" into "i̇".
 */
final class TurkishSlug
{
    private const MAP = [
        'İ' => 'i', 'I' => 'i', 'ı' => 'i',
        'Ş' => 's', 'ş' => 's',
        'Ğ' => 'g', 'ğ' => 'g',
        'Ü' => 'u', 'ü' => 'u',
        'Ö' => 'o', 'ö' => 'o',
        'Ç' => 'c', 'ç' => 'c',
        'Â' => 'a', 'â' => 'a',
        'Î' => 'i', 'î' => 'i',
        'Û' => 'u', 'û' => 'u',
    ];

    public static function make(string $value): string
    {
        $folded = strtolower(strtr($value, self::MAP));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $folded) ?? '';

        return trim($slug, '-');
    }
}
