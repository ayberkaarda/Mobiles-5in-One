<?php

use App\Domain\Shops\Models\ShopType;
use App\Domain\Web\Content\GuideRepository;
use App\Support\Web\Facts;
use App\Support\Web\Origin;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| JSON-LD validation (ADR-0045). Every `application/ld+json` block of every public page
| parses, names `https://schema.org` as its context, carries the required properties of its
| type (map below; a type missing from the map fails, so a new type is reviewed here), holds
| no empty string or empty list, and every URL in it is absolute on config('web.origin').
| Two exceptions: `MobileApplication.installUrl` lists the configured store URLs (present only
| when they are configured), and `OpeningHoursSpecification.dayOfWeek` is a schema.org
| enumeration URL. The Dataset of /etki carries no `license` while the licence is only a
| proposal.
*/

const JSONLD_REQUIRED = [
    'Organization' => ['name', 'url', 'logo'],
    'BreadcrumbList' => ['itemListElement'],
    'ListItem' => ['position', 'name', 'item'],
    'MobileApplication' => ['name', 'url', 'applicationCategory', 'operatingSystem', 'offers'],
    'Offer' => ['price', 'priceCurrency'],
    'Bakery' => ['@id', 'name', 'url', 'image', 'address', 'geo'],
    'Restaurant' => ['@id', 'name', 'url', 'image', 'address', 'geo'],
    'CafeOrCoffeeShop' => ['@id', 'name', 'url', 'image', 'address', 'geo'],
    'GroceryStore' => ['@id', 'name', 'url', 'image', 'address', 'geo'],
    'Store' => ['@id', 'name', 'url', 'image', 'address', 'geo'],
    'PostalAddress' => ['streetAddress', 'addressLocality', 'addressRegion', 'addressCountry'],
    'GeoCoordinates' => ['latitude', 'longitude'],
    'OpeningHoursSpecification' => ['dayOfWeek', 'opens', 'closes'],
    'FAQPage' => ['mainEntity'],
    'Question' => ['name', 'acceptedAnswer'],
    'Answer' => ['text'],
    'Article' => ['headline', 'description', 'datePublished', 'dateModified', 'author', 'publisher', 'inLanguage', 'wordCount', 'mainEntityOfPage'],
    'Dataset' => ['name', 'description', 'url', 'creator', 'distribution', 'temporalCoverage', 'spatialCoverage'],
    'DataDownload' => ['contentUrl', 'encodingFormat'],
];

/** Properties whose values are URLs (strings or lists of strings). */
const JSONLD_URL_KEYS = ['@id', 'url', 'logo', 'item', 'image', 'contentUrl', 'mainEntityOfPage', 'installUrl', 'sameAs'];

beforeEach(function (): void {
    WebPage::isolate();
    config([
        'web.origin' => 'https://askida.app',
        'web.store_urls' => ['android' => '', 'ios' => ''],
        'askida.allow_sample_shops' => false,
    ]);
});

/**
 * Walks one JSON-LD node and its children: required properties per type, no empty values,
 * URLs on the origin. Returns the types seen.
 *
 * @param  array<mixed>  $node
 * @return list<string>
 */
function assertJsonLdNode(array $node, string $where, ?string $parentType = null, ?string $parentKey = null): array
{
    $types = [];
    $type = $node['@type'] ?? null;

    if (is_string($type)) {
        expect(JSONLD_REQUIRED)->toHaveKey($type);
        $types[] = $type;

        foreach (JSONLD_REQUIRED[$type] as $property) {
            expect(array_key_exists($property, $node))->toBeTrue("{$where}: {$type} misses {$property}");
        }
    }

    foreach ($node as $key => $value) {
        $path = "{$where} > ".(is_string($type) ? $type.'.' : '').$key;

        expect($value)->not->toBe('', "{$path} is an empty string")
            ->and($value)->not->toBe([], "{$path} is an empty list")
            ->and($value)->not->toBeNull("{$path} is null");

        if (is_string($value)) {
            expect(trim($value))->toBe($value, "{$path} has surrounding whitespace");
            assertJsonLdUrl($value, (string) $key, is_string($type) ? $type : $parentType, $path);
        }

        if (is_array($value)) {
            if (is_string($key) && in_array($key, JSONLD_URL_KEYS, true) && array_is_list($value)) {
                foreach ($value as $url) {
                    expect($url)->toBeString();
                    assertJsonLdUrl((string) $url, $key, is_string($type) ? $type : $parentType, $path);
                }

                continue;
            }

            $types = [...$types, ...assertJsonLdNode($value, $path, is_string($type) ? $type : $parentType, is_string($key) ? $key : $parentKey)];
        }
    }

    return $types;
}

function assertJsonLdUrl(string $value, string $key, ?string $type, string $path): void
{
    $isUrlKey = in_array($key, JSONLD_URL_KEYS, true);
    $looksLikeUrl = preg_match('#^(?:[a-z][a-z0-9+.-]*:)?//#i', $value) === 1;

    if (! $isUrlKey && ! $looksLikeUrl) {
        return;
    }

    if ($key === '@context') {
        expect($value)->toBe('https://schema.org');

        return;
    }

    if ($key === 'dayOfWeek' && $type === 'OpeningHoursSpecification') {
        expect($value)->toMatch('#^https://schema\.org/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$#');

        return;
    }

    if ($key === 'installUrl' && $type === 'MobileApplication') {
        expect(array_values(Facts::storeUrls()))->toContain($value);

        return;
    }

    expect(Origin::owns($value))->toBeTrue("{$path}: {$value} is not absolute on ".Origin::base());
}

/**
 * @return array<string, array<string, mixed>> blocks by @type
 */
function validatedJsonLd(string $html, string $where): array
{
    preg_match_all('#<script\b([^>]*)>(.*?)</script>#s', $html, $scripts, PREG_SET_ORDER);
    expect($scripts)->not->toBeEmpty("{$where} has no JSON-LD");

    $byType = [];

    foreach ($scripts as [, $attributes, $json]) {
        expect(trim($attributes))->toBe('type="application/ld+json"')
            // HEX_TAG encoding: no value can close the element or open another.
            ->and($json)->not->toContain('<')
            ->and($json)->not->toContain('>');

        $block = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        expect($block)->toBeArray()
            ->and($block['@context'] ?? null)->toBe('https://schema.org', "{$where}: @context")
            ->and($block['@type'] ?? null)->toBeString();

        assertJsonLdNode($block, $where);

        expect($byType)->not->toHaveKey($block['@type']);
        $byType[$block['@type']] = $block;
    }

    return $byType;
}

it('validates every JSON-LD block of every public page', function (): void {
    $expected = [
        '/' => ['Organization', 'MobileApplication'],
        '/en' => ['Organization'],
        '/sss' => ['Organization', 'FAQPage', 'BreadcrumbList'],
        '/dukkan/'.PublicSite::SHOP_SLUG => ['Organization', 'Bakery', 'BreadcrumbList'],
        '/etki' => ['Organization', 'Dataset', 'BreadcrumbList'],
    ];

    foreach (GuideRepository::SLUGS as $slug) {
        $expected['/rehber/'.$slug] = ['Organization', 'Article', 'BreadcrumbList'];
    }

    foreach (PublicSite::seed() as $path => $lang) {
        $html = (string) $this->get($path)->assertOk()->getContent();
        $blocks = validatedJsonLd($html, $path);

        expect(array_keys($blocks))->toBe($expected[$path] ?? ['Organization', 'BreadcrumbList'], "JSON-LD types of {$path}");

        $organization = $blocks['Organization'];
        expect($organization['name'])->toBe(Facts::LEGAL_NAME)
            ->and($organization['url'])->toBe(Origin::url('/'))
            ->and($organization['logo'])->toBe(Origin::url('/logo/askida-mark.svg'))
            ->and($organization)->not->toHaveKey('sameAs');

        if (isset($blocks['BreadcrumbList'])) {
            $items = $blocks['BreadcrumbList']['itemListElement'];
            $last = $items[array_key_last($items)];

            expect(array_column($items, 'position'))->toBe(range(1, count($items)))
                ->and($items[0]['item'])->toBe(Origin::url($lang === 'en' ? '/en' : '/'))
                ->and(count($items))->toBeGreaterThanOrEqual(2, "{$path}: breadcrumbs")
                ->and($last['item'])->toBe(Origin::url($path), "{$path}: last crumb is the page itself");
        }
    }
});

it('describes the app on the home page, with store links only when configured', function (): void {
    $app = validatedJsonLd((string) $this->get('/')->getContent(), '/')['MobileApplication'];

    expect($app['applicationCategory'])->toBe('LifestyleApplication')
        ->and($app['operatingSystem'])->toBe('Android, iOS')
        ->and($app['offers'])->toMatchArray(['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'TRY'])
        ->and($app)->not->toHaveKey('installUrl');

    $android = 'https://play.google.com/store/apps/details?id='.Facts::APP_ID;
    config(['web.store_urls' => ['android' => $android, 'ios' => '']]);

    $app = validatedJsonLd((string) $this->get('/')->getContent(), '/ with a store URL')['MobileApplication'];

    // The store URL is the one URL that is not on the origin; it is allowed by name.
    expect($app['installUrl'])->toBe([$android]);
});

it('types each shop by its kind with address, geo, hours and phone', function (string $type, string $schemaType): void {
    $shop = DirectoryWorld::bakery(['slug' => 'tur-'.$type, 'type' => $type]);

    $blocks = validatedJsonLd((string) $this->get('/dukkan/'.$shop->slug)->assertOk()->getContent(), $type);
    $business = $blocks[$schemaType];

    expect($business['@id'])->toBe(Origin::url('/dukkan/'.$shop->slug).'#shop')
        ->and($business['name'])->toBe($shop->name)
        ->and($business['image'])->toBe(Origin::url('/og/dukkan/'.$shop->slug.'.png'))
        ->and($business['address']['@type'])->toBe('PostalAddress')
        ->and($business['address']['addressCountry'])->toBe('TR')
        ->and($business['geo']['@type'])->toBe('GeoCoordinates')
        ->and($business['telephone'])->toBe('+902165550102')
        // Sunday is closed in the fixture: six open days.
        ->and($business['openingHoursSpecification'])->toHaveCount(6);
})->with([
    'bakery' => [ShopType::Bakery->value, 'Bakery'],
    'restaurant' => [ShopType::Restaurant->value, 'Restaurant'],
    'cafe' => [ShopType::Cafe->value, 'CafeOrCoffeeShop'],
    'grocery' => [ShopType::Grocery->value, 'GroceryStore'],
    'stationery' => [ShopType::Stationery->value, 'Store'],
    'other' => [ShopType::Other->value, 'Store'],
]);

it('omits the hours of a shop without opening hours', function (): void {
    $shop = DirectoryWorld::listed(['slug' => 'saatsiz', 'opening_hours' => null]);

    $blocks = validatedJsonLd((string) $this->get('/dukkan/saatsiz')->assertOk()->getContent(), 'saatsiz');
    $business = array_values(array_diff_key($blocks, ['Organization' => true, 'BreadcrumbList' => true]))[0];

    expect($business)->not->toHaveKey('openingHoursSpecification')
        ->and($business['name'])->toBe($shop->name);
});

it('lists exactly the fifteen questions rendered on the FAQ page', function (): void {
    $html = (string) $this->get('/sss')->assertOk()->getContent();
    $faq = validatedJsonLd($html, '/sss')['FAQPage'];

    expect($faq['mainEntity'])->toHaveCount(15);

    $xpath = PublicSite::dom($html);
    $summaries = [];

    foreach ($xpath->query('//details/summary') ?: [] as $summary) {
        $summaries[] = trim((string) preg_replace('/\s+/u', ' ', $summary->textContent));
    }

    expect(array_column($faq['mainEntity'], 'name'))->toBe($summaries);

    foreach ($faq['mainEntity'] as $question) {
        expect($question['@type'])->toBe('Question')
            ->and($question['acceptedAnswer']['@type'])->toBe('Answer');
    }
});

it('dates each guide from its front matter and counts its words', function (): void {
    foreach (app(GuideRepository::class)->all() as $guide) {
        $article = validatedJsonLd((string) $this->get('/rehber/'.$guide->slug)->assertOk()->getContent(), $guide->slug)['Article'];

        expect($article['headline'])->toBe($guide->title)
            ->and($article['datePublished'])->toBe($guide->published->toDateString())
            ->and($article['dateModified'])->toBe($guide->updated->toDateString())
            ->and($article['inLanguage'])->toBe('tr-TR')
            ->and($article['wordCount'])->toBe($guide->wordCount())
            ->and($article['wordCount'])->toBeGreaterThanOrEqual(600)
            ->and($article['mainEntityOfPage'])->toBe(Origin::url('/rehber/'.$guide->slug))
            ->and($article['author']['@id'])->toBe(Origin::url('/').'#organization')
            ->and($article['publisher']['@id'])->toBe(Origin::url('/').'#organization');
    }
});

it('describes the open data set without a licence grant', function (): void {
    PublicSite::seed();

    $dataset = validatedJsonLd((string) $this->get('/etki')->assertOk()->getContent(), '/etki')['Dataset'];

    expect($dataset)->not->toHaveKey('license')
        ->and($dataset['description'])->toEndWith('Önerilen lisans: CC BY 4.0; hukuki onay bekliyor, henüz lisans verilmemiştir.')
        ->and($dataset['spatialCoverage'])->toBe('Türkiye')
        ->and($dataset['temporalCoverage'])->toMatch('#^\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$#')
        ->and($dataset['distribution'][0])->toMatchArray([
            '@type' => 'DataDownload',
            'contentUrl' => Origin::url('/etki.csv'),
            'encodingFormat' => 'text/csv',
        ]);
});

it('keeps the sample shops valid for the Lighthouse world', function (): void {
    config(['askida.allow_sample_shops' => true]);
    $this->seed(Database\Seeders\SampleDataSeeder::class);

    $blocks = validatedJsonLd((string) $this->get('/dukkan/ornek-moda-firini')->assertOk()->getContent(), 'sample bakery');

    expect($blocks)->toHaveKey('Bakery')
        ->and($blocks['Bakery']['openingHoursSpecification'])->toHaveCount(6);
});

it('rejects a block that breaks the rules', function (array $block): void {
    expect(fn () => assertJsonLdNode($block, 'fixture'))->toThrow(PHPUnit\Framework\ExpectationFailedException::class);
})->with([
    'unknown type' => [['@type' => 'Thing', 'name' => 'x']],
    'missing property' => [['@type' => 'Organization', 'name' => 'x', 'url' => 'https://askida.app/']],
    'empty string' => [['@type' => 'Organization', 'name' => '', 'url' => 'https://askida.app/', 'logo' => 'https://askida.app/l.svg']],
    'foreign url' => [['@type' => 'Organization', 'name' => 'x', 'url' => 'https://ornek.example/', 'logo' => 'https://askida.app/l.svg']],
    'relative url' => [['@type' => 'Organization', 'name' => 'x', 'url' => '/', 'logo' => 'https://askida.app/l.svg']],
]);
