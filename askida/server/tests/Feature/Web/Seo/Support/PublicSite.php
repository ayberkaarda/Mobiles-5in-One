<?php

namespace Tests\Feature\Web\Seo\Support;

use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Web\Content\GuideRepository;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;

/**
 * Every public GET page of the site in one world: the static pages, the two English pages,
 * the guides, the legal pages, a listed shop with its district and province pages and the
 * impact pages of a province with its own figures. The SEO tests (JSON-LD, hreflang, meta
 * lengths, answer paragraph) run their checks over this list, so a page added to the site
 * is added here once.
 */
final class PublicSite
{
    public const SHOP_SLUG = 'cinar-firini-kadikoy';

    /** Pages that have an English (or Turkish) counterpart: path => counterpart path. */
    public const TRANSLATED = [
        '/' => '/en',
        '/en' => '/',
        '/nasil-calisir' => '/en/how-it-works',
        '/en/how-it-works' => '/nasil-calisir',
    ];

    /**
     * path => lang, after creating the rows the dynamic pages need.
     *
     * @return array<string, 'tr'|'en'>
     */
    public static function seed(): array
    {
        DirectoryWorld::bakery(['slug' => self::SHOP_SLUG]);

        foreach ([['Kadıköy', 3], ['Beşiktaş', 4]] as [$ilce, $shops]) {
            $row = new ImpactSnapshot;
            $row->forceFill([
                'il' => 'İstanbul',
                'ilce' => $ilce,
                'day' => now()->toDateString(),
                'donated' => 6,
                'redeemed' => 4,
                'shops' => $shops,
            ])->save();
        }

        return self::paths();
    }

    /**
     * The page parsed as a DOM, for checks on elements and attributes rather than on raw text.
     */
    public static function dom(string $html): DOMXPath
    {
        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="utf-8"?>'.$html, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return new DOMXPath($dom);
    }

    /**
     * Attribute values of the elements matched by an XPath query, in document order.
     *
     * @return list<string>
     */
    public static function attributes(DOMXPath $xpath, string $query, string $attribute): array
    {
        $values = [];

        foreach ($xpath->query($query) ?: [] as $node) {
            if ($node instanceof DOMElement) {
                $values[] = $node->getAttribute($attribute);
            }
        }

        return $values;
    }

    /**
     * @return array<string, 'tr'|'en'>
     */
    public static function paths(): array
    {
        $paths = [
            '/' => 'tr',
            '/en' => 'en',
            '/nasil-calisir' => 'tr',
            '/en/how-it-works' => 'en',
            '/esnaf' => 'tr',
            '/bagisci' => 'tr',
            '/askidan-al' => 'tr',
            '/sss' => 'tr',
            '/hakkinda' => 'tr',
            '/iletisim' => 'tr',
        ];

        foreach (GuideRepository::SLUGS as $slug) {
            $paths['/rehber/'.$slug] = 'tr';
        }

        return [
            ...$paths,
            '/gizlilik' => 'tr',
            '/kvkk-aydinlatma' => 'tr',
            '/dukkan/'.self::SHOP_SLUG => 'tr',
            '/dukkanlar/istanbul' => 'tr',
            '/dukkanlar/istanbul/kadikoy' => 'tr',
            '/etki' => 'tr',
            '/etki/istanbul' => 'tr',
        ];
    }
}
