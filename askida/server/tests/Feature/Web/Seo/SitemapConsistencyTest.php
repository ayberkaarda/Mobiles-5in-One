<?php

use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Web\Content\GuideRepository;
use App\Domain\Web\Impact\ImpactWebReader;
use App\Support\Web\Origin;
use App\Support\Web\TurkishSlug;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| The sitemap agrees with the pages it lists: every URL answers 200, is indexable and names
| itself as canonical; the impact entries are exactly the provinces the impact pages publish
| (same TurkishSlug as the /etki/{il} route and the links on /etki); guide lastmod is the
| front matter `updated` that the guide's Article JSON-LD carries; every public page of the
| site is listed.
*/

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

/**
 * @return array<string, string|null> path => lastmod
 */
function sitemapPaths(string $xml): array
{
    $document = simplexml_load_string($xml);
    assert($document instanceof SimpleXMLElement);

    $paths = [];

    foreach ($document->url as $url) {
        $loc = (string) $url->loc;
        expect(Origin::owns($loc))->toBeTrue($loc);

        $paths[substr($loc, strlen(Origin::base())) ?: '/'] = isset($url->lastmod) ? (string) $url->lastmod : null;
    }

    return $paths;
}

/**
 * A province with its own figures (three shops or more) or below the threshold.
 */
function impactProvince(string $il, string $ilce, int $shops): void
{
    $row = new ImpactSnapshot;
    $row->forceFill(['il' => $il, 'ilce' => $ilce, 'day' => now()->toDateString(), 'donated' => 3, 'redeemed' => 1, 'shops' => $shops])->save();
}

it('lists only pages that answer 200, are indexable and are their own canonical', function (): void {
    $site = PublicSite::seed();
    $paths = sitemapPaths((string) $this->get('/sitemap.xml')->assertOk()->getContent());

    foreach (array_keys($paths) as $path) {
        $response = $this->get($path);
        $response->assertOk();
        $body = (string) $response->getContent();

        if (str_starts_with((string) $response->headers->get('Content-Type'), 'text/html')) {
            $xpath = PublicSite::dom($body);

            expect(PublicSite::attributes($xpath, '//head/meta[@name="robots"]', 'content'))->toBe(['index,follow'], "robots of {$path}")
                ->and(PublicSite::attributes($xpath, '//head/link[@rel="canonical"]', 'href'))->toBe([Origin::url($path)], "canonical of {$path}");
        }
    }

    // Every public page of the site is in the sitemap.
    foreach (array_keys($site) as $path) {
        expect($paths)->toHaveKey($path);
    }
});

it('lists exactly the impact provinces the impact pages publish, with the route slug', function (): void {
    impactProvince('İstanbul', 'Kadıköy', 3);
    impactProvince('İstanbul', 'Üsküdar', 2);
    impactProvince('Şanlıurfa', 'Eyyübiye', 4);
    impactProvince('Muğla', 'Bodrum', 1);

    $paths = sitemapPaths((string) $this->get('/sitemap.xml')->assertOk()->getContent());
    $listed = array_values(array_filter(array_keys($paths), static fn (string $path): bool => str_starts_with($path, '/etki/')));
    $published = array_map(static fn (array $province): string => '/etki/'.$province['slug'], app(ImpactWebReader::class)->publishedProvinces());

    sort($published);
    expect($listed)->toBe($published)
        ->and($listed)->toBe(['/etki/istanbul', '/etki/sanliurfa'])
        ->and(TurkishSlug::make('Şanlıurfa'))->toBe('sanliurfa');

    // The overview links the same province pages, and each one answers as an indexable page.
    $overview = PublicSite::dom((string) $this->get('/etki')->assertOk()->getContent());
    $links = array_values(array_unique(array_filter(
        PublicSite::attributes($overview, '//main//a[@href]', 'href'),
        static fn (string $href): bool => preg_match('#^/etki/[a-z0-9-]+$#', $href) === 1,
    )));
    sort($links);

    expect($links)->toBe($listed);

    foreach ($listed as $path) {
        expect((string) $this->get($path)->assertOk()->getContent())->toContain('<meta name="robots" content="index,follow">');
    }

    // The province below the threshold has a page, but it is not indexed and not listed.
    expect((string) $this->get('/etki/mugla')->assertOk()->getContent())->toContain('<meta name="robots" content="noindex,follow">')
        ->and($paths)->not->toHaveKey('/etki/mugla');
});

it('dates the guides in the sitemap with the updated date of their front matter', function (): void {
    $paths = sitemapPaths((string) $this->get('/sitemap.xml')->assertOk()->getContent());

    foreach (app(GuideRepository::class)->all() as $guide) {
        $path = '/rehber/'.$guide->slug;

        expect($paths)->toHaveKey($path)
            ->and(substr((string) $paths[$path], 0, 10))->toBe($guide->updated->toDateString(), $path);

        $article = collect(WebPage::jsonLd((string) $this->get($path)->getContent()))->firstWhere('@type', 'Article');
        expect($article['dateModified'] ?? null)->toBe($guide->updated->toDateString());
    }

    expect(array_filter(array_keys($paths), static fn (string $path): bool => str_starts_with($path, '/rehber/')))
        ->toHaveCount(count(GuideRepository::SLUGS));
});
