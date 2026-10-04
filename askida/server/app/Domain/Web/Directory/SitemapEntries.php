<?php

namespace App\Domain\Web\Directory;

use App\Support\Web\SitemapXml;
use App\Support\Web\TurkishSlug;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Every indexable URL of the public web, assembled in process (no crawling): the static
 * pages, the two English pages, the guides (lastmod from their front matter), the impact
 * pages, the province and district pages and every listed shop (lastmod = its last
 * change). Pages that are `noindex` (/hesap-silme, /pay/*, /admin/*, /og/*) are never
 * listed. Static pages carry no lastmod: no date is invented.
 */
final class SitemapEntries
{
    public const STATIC_PAGES = [
        '/', '/en', '/nasil-calisir', '/en/how-it-works', '/esnaf', '/bagisci', '/askidan-al',
        '/sss', '/hakkinda', '/iletisim', '/gizlilik', '/kvkk-aydinlatma', '/etki',
    ];

    /** Days of impact history that make a province impact page worth listing. */
    public const IMPACT_DAYS = 30;

    /**
     * @param  string|null  $guidesDirectory  directory of the guide Markdown files (default resources/content/guides)
     */
    public function __construct(
        private readonly DirectoryQuery $directory,
        private readonly ?string $guidesDirectory = null,
    ) {}

    public function build(): SitemapXml
    {
        $sitemap = new SitemapXml;

        foreach (self::STATIC_PAGES as $path) {
            $sitemap->add($path);
        }

        foreach ($this->guides() as $slug => $updated) {
            $sitemap->add('/rehber/'.$slug, $updated);
        }

        foreach ($this->impactProvinces() as $slug => $updated) {
            $sitemap->add('/etki/'.$slug, $updated);
        }

        $rows = $this->directory->sitemap();

        foreach ($rows['provinces'] as $province) {
            $sitemap->add('/dukkanlar/'.$province['il_slug'], $province['updated_at']);
        }

        foreach ($rows['districts'] as $district) {
            $sitemap->add('/dukkanlar/'.$district['il_slug'].'/'.$district['ilce_slug'], $district['updated_at']);
        }

        foreach ($rows['shops'] as $shop) {
            $sitemap->add('/dukkan/'.$shop['slug'], $shop['updated_at']);
        }

        return $sitemap;
    }

    /**
     * Guide slugs (file names under resources/content/guides) with the `updated` date of
     * their front matter (`published` when there is no `updated`).
     *
     * @return array<string, CarbonImmutable|null>
     */
    public function guides(): array
    {
        $files = glob(rtrim($this->guidesDirectory ?? resource_path('content/guides'), '/').'/*.md') ?: [];
        sort($files);
        $guides = [];

        foreach ($files as $file) {
            $slug = basename($file, '.md');

            if (preg_match('/^'.DirectoryQuery::SLUG_PATTERN.'$/', $slug) !== 1) {
                continue;
            }

            $guides[$slug] = self::frontMatterDate((string) file_get_contents($file));
        }

        return $guides;
    }

    /**
     * Province slugs with impact snapshots in the last IMPACT_DAYS days and the time of
     * their latest snapshot.
     *
     * @return array<string, CarbonImmutable|null>
     */
    public function impactProvinces(): array
    {
        $since = CarbonImmutable::now('Europe/Istanbul')->subDays(self::IMPACT_DAYS)->toDateString();
        $provinces = [];

        $rows = DB::table('impact_snapshots')
            ->where('day', '>=', $since)
            ->where('il', '<>', '')
            ->groupBy('il')
            ->selectRaw('il, MAX(updated_at) AS updated_at')
            ->orderBy('il')
            ->get();

        foreach ($rows as $row) {
            $slug = TurkishSlug::make((string) $row->il);

            if ($slug === '') {
                continue;
            }

            $updated = is_string($row->updated_at) ? CarbonImmutable::parse($row->updated_at) : null;
            $current = $provinces[$slug] ?? null;
            $provinces[$slug] = $current !== null && $updated !== null && $current->greaterThan($updated) ? $current : ($updated ?? $current);
        }

        ksort($provinces);

        return $provinces;
    }

    private static function frontMatterDate(string $markdown): ?CarbonImmutable
    {
        if (preg_match('/\A---\R(.*?)\R---/s', $markdown, $block) !== 1) {
            return null;
        }

        foreach (['updated', 'published'] as $key) {
            if (preg_match('/^'.$key.':\s*["\']?(\d{4}-\d{2}-\d{2})["\']?\s*$/m', $block[1], $match) === 1) {
                try {
                    return CarbonImmutable::createFromFormat('!Y-m-d', $match[1], 'Europe/Istanbul') ?: null;
                } catch (Throwable) {
                    return null;
                }
            }
        }

        return null;
    }
}
