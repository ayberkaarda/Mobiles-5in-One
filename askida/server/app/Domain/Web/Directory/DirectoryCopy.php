<?php

namespace App\Domain\Web\Directory;

use App\Support\Web\Facts;
use App\Support\Web\Format;
use App\Support\Web\PageMeta;

/**
 * Turkish copy of the directory pages built around user-entered names (shop, province,
 * district). Titles and descriptions are cut to the PageMeta limits by shortening the
 * name, never the fixed words; the answer paragraph stays within 40-60 words whatever
 * the length of the names (a long name is replaced by a neutral reference). Names are
 * returned as plain text; Blade escapes them where they are printed.
 */
final class DirectoryCopy
{
    private const ANSWER_MAX = 60;

    public static function shopTitle(string $name, string $ilce): string
    {
        return self::fit($name, ' · '.$ilce.' | '.Facts::BRAND, PageMeta::TITLE_MAX)
            ?? self::fit($name, ' | '.Facts::BRAND, PageMeta::TITLE_MAX)
            ?? Facts::BRAND;
    }

    public static function shopDescription(string $name, string $ilce, string $il): string
    {
        $suffix = ', '.$ilce.' / '.$il.': askıdaki ürünler, adres, çalışma saatleri ve konum. Askıdan almak için hesap gerekmez.';

        return self::fit($name, $suffix, PageMeta::DESCRIPTION_MAX)
            ?? self::fit($name, ': askıdaki ürünler, adres, çalışma saatleri ve konum.', PageMeta::DESCRIPTION_MAX)
            ?? 'Askıda dükkânı: askıdaki ürünler, adres, çalışma saatleri ve konum.';
    }

    public static function shopAnswer(string $name, string $ilce, string $il): string
    {
        $text = static fn (string $who, string $where): string => $who.', '.$where.' Askıda ağına katılmış ve doğrulanmış bir işletmedir. '
            .'Bağışçılar buradaki ürünleri uygulamadan askıya bırakır; dileyen herkes hesap açmadan ve kimlik göstermeden, '
            .Facts::codeLength().' karakterlik tek kullanımlık kodla dükkândan askıdan alır. '
            .'Bu sayfada askıdaki ürün sayıları, adres, çalışma saatleri ve konum yer alır.';

        return self::firstWithin([
            $text($name, $ilce.' ('.$il.') bölgesinde'),
            $text('Bu işletme', $ilce.' ('.$il.') bölgesinde'),
            $text('Bu işletme', 'bulunduğu ilçede'),
        ]);
    }

    public static function districtTitle(string $ilce, string $il): string
    {
        return self::fit($ilce.', '.$il, ' dükkânları | '.Facts::BRAND, PageMeta::TITLE_MAX)
            ?? self::fit($ilce, ' dükkânları | '.Facts::BRAND, PageMeta::TITLE_MAX)
            ?? 'İlçe dükkânları | '.Facts::BRAND;
    }

    public static function districtDescription(string $ilce, string $il): string
    {
        return self::fit($ilce.' ('.$il.')', ' ilçesinde Askıda ağındaki doğrulanmış dükkânlar ve şu an askıda bekleyen ürün sayıları.', PageMeta::DESCRIPTION_MAX)
            ?? 'Bu ilçede Askıda ağındaki doğrulanmış dükkânlar ve şu an askıda bekleyen ürün sayıları.';
    }

    public static function districtAnswer(string $ilce, string $il, int $shops): string
    {
        $text = static fn (string $where): string => $where.' Askıda ağına katılmış ve sahibinin onayıyla bu dizinde listelenen '
            .Format::count($shops).' doğrulanmış dükkân var. Her dükkânın yanındaki sayı, şu an orada askıda bekleyen ürün adedidir. '
            .'Dileyen herkes hesap açmadan, uygulamadaki tek kullanımlık kodla bu dükkânlardan askıdan alabilir; bağışçılar da aynı uygulamadan askıya bırakır.';

        return self::firstWithin([
            $text($ilce.' ('.$il.') ilçesinde'),
            $text('Bu ilçede'),
        ]);
    }

    public static function provinceTitle(string $il): string
    {
        return self::fit($il, ' dükkânları | '.Facts::BRAND, PageMeta::TITLE_MAX) ?? 'İl dükkânları | '.Facts::BRAND;
    }

    public static function provinceDescription(string $il): string
    {
        return self::fit($il, ' ilindeki Askıda dükkânları, ilçelere göre: dükkân sayıları ve şu an askıda bekleyen ürünler.', PageMeta::DESCRIPTION_MAX)
            ?? 'Bu ildeki Askıda dükkânları, ilçelere göre: dükkân sayıları ve şu an askıda bekleyen ürünler.';
    }

    public static function provinceAnswer(string $il, int $shops, int $districts): string
    {
        $text = static fn (string $where): string => $where.' Askıda ağına katılmış ve sahibinin onayıyla bu dizinde listelenen '
            .Format::count($shops).' doğrulanmış dükkân, '.Format::count($districts).' ilçeye dağılmış durumda. '
            .'Bir ilçe seçerek oradaki dükkânları, adreslerini ve şu an askıda bekleyen ürün sayılarını görebilirsiniz. '
            .'Askıdan almak için hesap gerekmez; uygulamadaki tek kullanımlık kod yeter.';

        return self::firstWithin([
            $text($il.' ilinde'),
            $text('Bu ilde'),
        ]);
    }

    /**
     * "+902120000000" -> "+90 212 000 00 00".
     */
    public static function phoneLabel(string $e164): string
    {
        if (preg_match('/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/', $e164, $m) !== 1) {
            return $e164;
        }

        return '+90 '.$m[1].' '.$m[2].' '.$m[3].' '.$m[4];
    }

    /**
     * `$name.$suffix` within $max characters, the name shortened with an ellipsis when
     * needed; null when not even a few characters of the name fit.
     */
    public static function fit(string $name, string $suffix, int $max): ?string
    {
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));
        $room = $max - mb_strlen($suffix);

        if (mb_strlen($name) <= $room) {
            return $name.$suffix;
        }

        if ($room < 8) {
            return null;
        }

        return rtrim(mb_substr($name, 0, $room - 1)).'…'.$suffix;
    }

    /**
     * @param  non-empty-list<string>  $candidates  longest first; the last one is always within the limit
     */
    private static function firstWithin(array $candidates): string
    {
        foreach ($candidates as $candidate) {
            if (Format::words($candidate) <= self::ANSWER_MAX) {
                return $candidate;
            }
        }

        return $candidates[array_key_last($candidates)];
    }
}
