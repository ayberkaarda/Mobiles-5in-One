<?php

namespace App\Domain\Web\Directory;

use App\Domain\Web\Impact\ImpactWebReader;
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
     * @param  ImpactWebReader|null  $impact  read model of the impact pages (default from the container)
     */
    public function __construct(
        private readonly DirectoryQuery $directory,
        private readonly ?string $guidesDirectory = null,
        private readonly ?ImpactWebReader $impact = null,
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
     * Province impact pages worth indexing: exactly the provinces the impact pages publish
     * with their own figures (ImpactWebReader::publishedProvinces(), the same slugs as the
     * `/etki/{il}` route; provinces below the small-cell threshold answer `noindex` and are
     * left out), with the time of their latest snapshot as lastmod when there is one.
     *
     * @return array<string, CarbonImmutable|null>
     */
    public function impactProvinces(): array
    {
        $updated = $this->snapshotTimes();
        $provinces = [];

        foreach (($this->impact ?? app(ImpactWebReader::class))->publishedProvinces() as $province) {
            $provinces[$province['slug']] = $updated[$province['slug']] ?? null;
        }

        ksort($provinces);

        return $provinces;
    }

    /**
     * Time of the latest impact snapshot per province slug in the last IMPACT_DAYS days.
     *
     * @return array<string, CarbonImmutable|null>
     */
    private function snapshotTimes(): array
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
