<?php

use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Web\Directory\DirectoryQuery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

it('lists the districts of a province with shop and unit counts', function (): void {
    $kadikoy = DirectoryWorld::listed(['slug' => 'kadikoy-bir', 'ilce' => 'Kadıköy']);
    DirectoryWorld::item($kadikoy, 4);
    DirectoryWorld::listed(['slug' => 'kadikoy-iki', 'ilce' => 'Kadıköy']);
    DirectoryWorld::listed(['slug' => 'sisli-bir', 'ilce' => 'Şişli']);
    DirectoryWorld::listed(['slug' => 'gizli', 'ilce' => 'Üsküdar', 'listed_on_web' => false]);
    DirectoryWorld::listed(['slug' => 'ankara-bir', 'il' => 'Ankara', 'ilce' => 'Çankaya']);

    $html = WebPage::assertPublicPage($this->get('/dukkanlar/istanbul'));

    expect($html)
        ->toContain('<h1>İstanbul: askıda dükkânlar</h1>')
        ->toContain('<a href="/dukkanlar/istanbul/kadikoy">Kadıköy</a><span class="footnote tabular">2 dükkân · 4 ürün askıda</span>')
        ->toContain('<a href="/dukkanlar/istanbul/sisli">Şişli</a><span class="footnote tabular">1 dükkân · 0 ürün askıda</span>')
        ->not->toContain('uskudar')
        ->not->toContain('Çankaya')
        ->toContain('<link rel="canonical" href="https://askida.app/dukkanlar/istanbul">');

    expect(WebPage::answer($html))->toContain('3 doğrulanmış dükkân, 2 ilçeye');
});

it('lists the listed shops of a district as shop cards with their units', function (): void {
    $open = DirectoryWorld::listed(['slug' => 'acik-firin', 'name' => 'Açık Fırın']);
    DirectoryWorld::item($open, 3);
    DirectoryWorld::item($open, 1, ['name' => 'Simit']);
    DirectoryWorld::listed(['slug' => 'bos-firin', 'name' => 'Boş Fırın']);
    DirectoryWorld::listed(['slug' => 'bekleyen', 'name' => 'Bekleyen Fırın'], ShopVerificationState::Pending);
    DirectoryWorld::listed(['slug' => 'baska-ilce', 'name' => 'Başka İlçe Fırını', 'ilce' => 'Beşiktaş']);

    $html = WebPage::assertPublicPage($this->get('/dukkanlar/istanbul/kadikoy'));

    expect($html)
        ->toContain('<h1>Kadıköy, İstanbul: askıda dükkânlar</h1>')
        ->toContain('<a href="/dukkan/acik-firin">Açık Fırın</a>')
        ->toContain('<a href="/dukkan/bos-firin">Boş Fırın</a>')
        ->not->toContain('Bekleyen Fırın')
        ->not->toContain('Başka İlçe Fırını')
        ->toMatch('#<span class="numeral-xl">4</span>#');

    // Shop cards are ordered by name; the empty one shows a dash.
    expect(strpos($html, 'Açık Fırın'))->toBeLessThan(strpos($html, 'Boş Fırın'))
        ->and($html)->toMatch('#Boş Fırın</a>.*?<span class="numeral">—</span>#s');

    $breadcrumbs = WebPage::jsonLd($html)[1];
    expect($breadcrumbs['@type'])->toBe('BreadcrumbList')
        ->and(array_column($breadcrumbs['itemListElement'], 'name'))->toBe(['Askıda', 'İstanbul', 'Kadıköy']);
});

it('serves Turkish names under folded ASCII slugs', function (): void {
    DirectoryWorld::listed(['slug' => 'karsiyaka-firini', 'il' => 'İzmir', 'ilce' => 'Karşıyaka', 'name' => 'Karşıyaka Fırını']);

    WebPage::assertPublicPage($this->get('/dukkanlar/izmir'));
    $html = WebPage::assertPublicPage($this->get('/dukkanlar/izmir/karsiyaka'));

    expect($html)->toContain('<h1>Karşıyaka, İzmir: askıda dükkânlar</h1>');
});

it('answers 404 for unknown, empty or malformed provinces and districts', function (string $path): void {
    DirectoryWorld::listed(['slug' => 'tek-dukkan']);

    $this->get($path)->assertNotFound();
})->with([
    '/dukkanlar/ankara',
    '/dukkanlar/istanbul/sisli',
    '/dukkanlar/İstanbul',
    '/dukkanlar/Istanbul/kadikoy',
    '/dukkanlar/istanbul/kadikoy?sayfa=0',
    '/dukkanlar/istanbul/kadikoy?sayfa=2',
    '/dukkanlar/istanbul/kadikoy?sayfa=bir',
]);

it('pages a large district and keeps every page within the budget', function (): void {
    for ($i = 1; $i <= DirectoryQuery::PER_PAGE + 1; $i++) {
        DirectoryWorld::listed(['slug' => sprintf('firin-%02d', $i), 'name' => sprintf('Mahalle Fırını %02d', $i)]);
    }

    $first = WebPage::assertPublicPage($this->get('/dukkanlar/istanbul/kadikoy'));
    $second = WebPage::assertPublicPage($this->get('/dukkanlar/istanbul/kadikoy?sayfa=2'));

    expect(substr_count($first, 'class="shop-card"'))->toBe(DirectoryQuery::PER_PAGE)
        ->and($first)->toContain('<a href="/dukkanlar/istanbul/kadikoy?sayfa=2" rel="next">Sonraki sayfa</a>')
        ->and(substr_count($second, 'class="shop-card"'))->toBe(1)
        ->and($second)->toContain('<a href="/dukkanlar/istanbul/kadikoy" rel="prev">Önceki sayfa</a>')
        ->and($second)->toContain('<link rel="canonical" href="https://askida.app/dukkanlar/istanbul/kadikoy?sayfa=2">')
        ->and(WebPage::answer($second))->toContain((DirectoryQuery::PER_PAGE + 1).' doğrulanmış dükkân');

    $this->get('/dukkanlar/istanbul/kadikoy?sayfa=3')->assertNotFound();
});
