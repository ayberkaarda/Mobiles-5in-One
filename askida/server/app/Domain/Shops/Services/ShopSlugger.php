<?php

namespace App\Domain\Shops\Services;

use App\Domain\Shops\Models\Shop;
use Illuminate\Support\Str;

/**
 * Builds a unique URL slug from the shop name and district ("Çınar Fırını", "Kadıköy"
 * -> "cinar-firini-kadikoy", then "-2", "-3" ... when taken). The unique index on
 * `shops.slug` stays the final guard against a concurrent insert.
 */
final class ShopSlugger
{
    private const MAX_BASE_LENGTH = 120;

    public function base(string $name, string $ilce): string
    {
        $base = Str::slug(self::fold($name.' '.$ilce), '-', 'tr');
        $base = trim(substr($base, 0, self::MAX_BASE_LENGTH), '-');

        return $base !== '' ? $base : 'dukkan';
    }

    public function unique(string $name, string $ilce): string
    {
        $base = $this->base($name, $ilce);

        $taken = Shop::query()
            ->where('slug', $base)
            ->orWhere('slug', 'like', addcslashes($base, '%_\\').'-%')
            ->pluck('slug')
            ->all();

        if (! in_array($base, $taken, true)) {
            return $base;
        }

        for ($n = 2; ; $n++) {
            $candidate = $base.'-'.$n;

            if (! in_array($candidate, $taken, true)) {
                return $candidate;
            }
        }
    }

    /**
     * A slug with a random suffix, used after a unique-index collision.
     */
    public function withRandomSuffix(string $name, string $ilce): string
    {
        return $this->base($name, $ilce).'-'.strtolower(Str::random(6));
    }

    /**
     * Lower-cases Turkish dotted and dotless capitals correctly before transliteration.
     */
    private static function fold(string $value): string
    {
        return mb_strtolower(strtr($value, ['I' => 'ı', 'İ' => 'i']), 'UTF-8');
    }
}
