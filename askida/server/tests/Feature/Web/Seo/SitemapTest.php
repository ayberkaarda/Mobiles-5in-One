<?php

use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Web\Directory\DirectoryQuery;
use App\Domain\Web\Directory\SitemapEntries;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

/**
 * @return array<string, string|null> loc => lastmod
 */
function sitemapUrls(string $xml): array
{
    $document = simplexml_load_string($xml);
    expect($document)->not->toBeFalse();
    assert($document instanceof SimpleXMLElement);

    expect($document->getName())->toBe('urlset')
        ->and($document->getNamespaces()[''] ?? null)->toBe('http://www.sitemaps.org/schemas/sitemap/0.9');

    $urls = [];

    foreach ($document->url as $url) {
        $urls[(string) $url->loc] = isset($url->lastmod) ? (string) $url->lastmod : null;
    }

    return $urls;
}

it('lists the static pages, the listed shops, their districts and provinces', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00'));
    DirectoryWorld::listed(['slug' => 'cinar-firini', 'ilce' => 'Kadıköy']);
    $this->travelTo(CarbonImmutable::parse('2026-10-04 15:30:00'));
    DirectoryWorld::listed(['slug' => 'karsiyaka-firini', 'il' => 'İzmir', 'ilce' => 'Karşıyaka']);
    $this->travelBack();

    DirectoryWorld::listed(['slug' => 'bekleyen'], ShopVerificationState::Pending);
    DirectoryWorld::listed(['slug' => 'reddedilen'], ShopVerificationState::Rejected);
    DirectoryWorld::listed(['slug' => 'listelenmeyen', 'listed_on_web' => false, 'ilce' => 'Üsküdar']);
    DirectoryWorld::listed(['slug' => 'ornek', 'is_sample' => true, 'ilce' => 'Fatih']);

    $response = $this->get('/sitemap.xml')->assertOk()->assertHeader('Content-Type', 'application/xml; charset=utf-8');
    $urls = sitemapUrls((string) $response->getContent());

    foreach (SitemapEntries::STATIC_PAGES as $path) {
        expect($urls)->toHaveKey('https://askida.app'.$path)
            ->and($urls['https://askida.app'.$path])->toBeNull();
    }

    expect($urls)
        ->toHaveKey('https://askida.app/dukkan/cinar-firini')
        ->toHaveKey('https://askida.app/dukkan/karsiyaka-firini')
        ->toHaveKey('https://askida.app/dukkanlar/istanbul')
        ->toHaveKey('https://askida.app/dukkanlar/istanbul/kadikoy')
        ->toHaveKey('https://askida.app/dukkanlar/izmir')
        ->toHaveKey('https://askida.app/dukkanlar/izmir/karsiyaka')
        ->and($urls['https://askida.app/dukkan/cinar-firini'])->toBe(CarbonImmutable::parse('2026-10-04 12:00:00')->toAtomString())
        ->and($urls['https://askida.app/dukkanlar/izmir/karsiyaka'])->toBe(CarbonImmutable::parse('2026-10-04 15:30:00')->toAtomString());

    $all = implode("\n", array_keys($urls));

    foreach (['bekleyen', 'reddedilen', 'listelenmeyen', 'uskudar', 'ornek', 'fatih'] as $hidden) {
        expect($all)->not->toContain($hidden);
    }

    // Every URL is absolute on the configured origin; noindex areas are never listed.
    foreach (array_keys($urls) as $url) {
        expect($url)->toStartWith('https://askida.app/')
            ->and($url)->not->toMatch('#^https://askida\.app/(admin|pay/|hesap-silme|og/)#');
    }
});

it('builds every URL from the configured origin, never the request host', function (): void {
    config(['web.origin' => 'https://ornek.askida.app']);
    DirectoryWorld::listed(['slug' => 'cinar-firini']);

    $xml = (string) $this->get('http://evil.example/sitemap.xml')->assertOk()->getContent();

    expect($xml)->not->toContain('evil.example')
        ->and(sitemapUrls($xml))->toHaveKey('https://ornek.askida.app/dukkan/cinar-firini');
});

it('lists the guides with the date from their front matter', function (): void {
    $directory = sys_get_temp_dir().'/askida-guides-'.bin2hex(random_bytes(4));
    mkdir($directory);
    file_put_contents($directory.'/askida-ekmek-gelenegi-nedir.md', "---\ntitle: Askıda ekmek\nslug: askida-ekmek-gelenegi-nedir\npublished: 2026-09-20\nupdated: 2026-10-02\n---\n\n## Soru\n");
    file_put_contents($directory.'/bagisiniz-nereye-gidiyor.md', "---\ntitle: Bağış\npublished: \"2026-09-21\"\n---\nMetin\n");
    file_put_contents($directory.'/README.txt', 'not a guide');

    $this->app->bind(SitemapEntries::class, fn () => new SitemapEntries(app(DirectoryQuery::class), $directory));

    $urls = sitemapUrls((string) $this->get('/sitemap.xml')->assertOk()->getContent());

    expect($urls['https://askida.app/rehber/askida-ekmek-gelenegi-nedir'])->toBe('2026-10-02T00:00:00+03:00')
        ->and($urls['https://askida.app/rehber/bagisiniz-nereye-gidiyor'])->toBe('2026-09-21T00:00:00+03:00')
        ->and(implode("\n", array_keys($urls)))->not->toContain('README');

    array_map(unlink(...), glob($directory.'/*') ?: []);
    rmdir($directory);
});

it('lists the impact pages of provinces with recent snapshots', function (): void {
    $now = CarbonImmutable::now('Europe/Istanbul');
    DB::table('impact_snapshots')->insert([
        ['id' => (string) Str::uuid(), 'il' => 'İstanbul', 'ilce' => 'Kadıköy', 'day' => $now->subDay()->toDateString(), 'donated' => 4, 'redeemed' => 2, 'shops' => 3, 'created_at' => $now, 'updated_at' => $now],
        ['id' => (string) Str::uuid(), 'il' => 'Muğla', 'ilce' => 'Bodrum', 'day' => $now->subDays(SitemapEntries::IMPACT_DAYS + 5)->toDateString(), 'donated' => 1, 'redeemed' => 1, 'shops' => 3, 'created_at' => $now, 'updated_at' => $now],
    ]);

    $urls = sitemapUrls((string) $this->get('/sitemap.xml')->assertOk()->getContent());

    expect($urls)->toHaveKey('https://askida.app/etki')
        ->toHaveKey('https://askida.app/etki/istanbul')
        ->not->toHaveKey('https://askida.app/etki/mugla');
});

it('is kept in the page cache for an hour', function (): void {
    config(['responsecache.enabled' => true, 'responsecache.store' => 'array']);
    Cache::store('array')->flush();

    $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'miss');
    $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'hit')->assertHeader('Content-Type', 'application/xml; charset=utf-8');

    $this->travel(59)->minutes();
    $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'hit');

    $this->travel(2)->minutes();
    $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'miss');
});
