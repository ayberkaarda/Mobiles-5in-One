<?php

use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

it('renders a listed shop with its public facts and the public page contract', function (): void {
    $shop = DirectoryWorld::bakery();

    $html = WebPage::assertPublicPage($this->get('/dukkan/cinar-firini-kadikoy'));

    expect($html)
        ->toContain('<h1>Çınar Fırını</h1>')
        ->toContain('Fırın · Kadıköy, İstanbul')
        ->toContain('Moda Caddesi No: 12, Caferağa')
        ->toContain('<a href="tel:+902165550102">+90 216 555 01 02</a>')
        ->toContain('<dt>Pazartesi</dt><dd class="tabular">08:00–20:00</dd>')
        ->toContain('<dt>Pazar</dt><dd class="tabular">Kapalı</dd>')
        ->toContain('<td>Ekmek</td><td class="num">₺15,00</td><td class="num">3</td>')
        ->toContain('<td>Poğaça</td><td class="num">₺20,00</td><td class="num">—</td>')
        ->toContain('href="askida://shop/cinar-firini-kadikoy"')
        ->toContain('Askıya bırak')
        ->toContain('<link rel="canonical" href="https://askida.app/dukkan/cinar-firini-kadikoy">')
        ->toContain('<meta property="og:image" content="https://askida.app/og/dukkan/cinar-firini-kadikoy.png">')
        ->toContain('href="/dukkanlar/istanbul/kadikoy"')
        ->toContain('class="static-map"');

    // The rail counter shows the units hanging on the shop's active items (3 + 2).
    expect($html)->toMatch('#<span class="numeral-xl">5</span>#');

    expect($shop->owner)->toBeInstanceOf(User::class);
});

it('never shows the owner, documents, tax number, IBAN or anything about people', function (): void {
    $shop = DirectoryWorld::bakery();
    $owner = $shop->owner;
    assert($owner instanceof User);
    $owner->forceFill(['name' => 'Sahibin Gizli Adı'])->save();

    $html = (string) $this->get('/dukkan/'.$shop->slug)->assertOk()->getContent();

    foreach ([$owner->email, $owner->name, (string) $shop->tax_number_enc, (string) $shop->iban_enc, $shop->id, 'vergi', 'IBAN', 'belge'] as $secret) {
        expect($html)->not->toContain($secret);
    }
});

it('leaves inactive items out', function (): void {
    $shop = DirectoryWorld::listed(['slug' => 'pasif-urun-dukkani']);
    DirectoryWorld::item($shop, 2, ['name' => 'Görünen ürün']);
    DirectoryWorld::item($shop, 0, ['name' => 'Kaldırılmış ürün', 'active' => false]);

    expect((string) $this->get('/dukkan/pasif-urun-dukkani')->assertOk()->getContent())
        ->toContain('Görünen ürün')
        ->not->toContain('Kaldırılmış ürün');
});

it('answers 404, never 403, for every shop that is not verified and listed', function (array $attributes, ShopVerificationState $state): void {
    $shop = DirectoryWorld::listed(['slug' => 'gizli-dukkan', ...$attributes], $state);

    $this->get('/dukkan/'.$shop->slug)->assertNotFound();
    $this->get('/d/'.$shop->slug)->assertNotFound();
    $this->get('/og/dukkan/'.$shop->slug.'.png')->assertNotFound();
    $this->get('/dukkanlar/istanbul/kadikoy')->assertNotFound();
    $this->get('/dukkanlar/istanbul')->assertNotFound();
})->with([
    'pending' => [[], ShopVerificationState::Pending],
    'rejected' => [[], ShopVerificationState::Rejected],
    'verified but not listed' => [['listed_on_web' => false], ShopVerificationState::Verified],
    'sample while samples are off' => [['is_sample' => true], ShopVerificationState::Verified],
]);

it('lists sample shops only where samples are allowed, with the sample label', function (): void {
    config(['askida.allow_sample_shops' => true]);
    DirectoryWorld::listed(['slug' => 'ornek-dukkan', 'name' => '[ÖRNEK] Örnek Fırın', 'is_sample' => true]);

    $html = WebPage::assertPublicPage($this->get('/dukkan/ornek-dukkan'));

    expect($html)->toContain('<span class="tag tag-sample">ÖRNEK</span>');
});

it('answers 404 for unknown and malformed slugs', function (string $path): void {
    $this->get($path)->assertNotFound();
})->with(['/dukkan/yok-boyle-dukkan', '/dukkan/Buyuk-Harf', '/dukkan/a--b', '/d/yok', '/dukkan/%C3%A7inar']);

it('redirects the short link permanently to the shop page', function (): void {
    DirectoryWorld::bakery();

    $this->get('/d/cinar-firini-kadikoy')
        ->assertStatus(301)
        ->assertRedirect('/dukkan/cinar-firini-kadikoy');
});

it('describes the shop as a LocalBusiness subtype in JSON-LD', function (): void {
    DirectoryWorld::bakery();

    $blocks = WebPage::jsonLd((string) $this->get('/dukkan/cinar-firini-kadikoy')->getContent());
    $types = array_column($blocks, '@type');

    expect($types)->toBe(['Organization', 'Bakery', 'BreadcrumbList']);

    $business = $blocks[1];

    expect($business)->toMatchArray([
        '@context' => 'https://schema.org',
        '@id' => 'https://askida.app/dukkan/cinar-firini-kadikoy#shop',
        'name' => 'Çınar Fırını',
        'url' => 'https://askida.app/dukkan/cinar-firini-kadikoy',
        'image' => 'https://askida.app/og/dukkan/cinar-firini-kadikoy.png',
        'telephone' => '+902165550102',
        'address' => [
            '@type' => 'PostalAddress',
            'streetAddress' => 'Moda Caddesi No: 12, Caferağa',
            'addressLocality' => 'Kadıköy',
            'addressRegion' => 'İstanbul',
            'addressCountry' => 'TR',
        ],
    ])
        ->and($business['geo'])->toMatchArray(['@type' => 'GeoCoordinates', 'latitude' => 40.9903, 'longitude' => 29.029])
        ->and($business['openingHoursSpecification'])->toHaveCount(6)
        ->and($business['openingHoursSpecification'][0])->toBe([
            '@type' => 'OpeningHoursSpecification',
            'dayOfWeek' => 'https://schema.org/Monday',
            'opens' => '08:00',
            'closes' => '20:00',
        ]);

    expect(array_column($blocks[2]['itemListElement'], 'item'))->toBe([
        'https://askida.app/',
        'https://askida.app/dukkanlar/istanbul',
        'https://askida.app/dukkanlar/istanbul/kadikoy',
        'https://askida.app/dukkan/cinar-firini-kadikoy',
    ]);
});

it('maps every shop type to its schema.org subtype', function (string $type, string $schemaType): void {
    DirectoryWorld::listed(['slug' => 'tur-dukkani', 'type' => $type]);

    $blocks = WebPage::jsonLd((string) $this->get('/dukkan/tur-dukkani')->assertOk()->getContent());

    expect($blocks[1]['@type'])->toBe($schemaType);
})->with([
    ['bakery', 'Bakery'],
    ['restaurant', 'Restaurant'],
    ['cafe', 'CafeOrCoffeeShop'],
    ['grocery', 'GroceryStore'],
    ['stationery', 'Store'],
    ['other', 'Store'],
    // Rows written before the type enum (the sample seeder's nouns).
    ['firin', 'Bakery'],
    ['bakkal', 'GroceryStore'],
]);

it('leaves hours and telephone out of JSON-LD when the shop has none', function (): void {
    DirectoryWorld::listed(['slug' => 'saatsiz-dukkan', 'phone' => 'yok']);

    $html = WebPage::assertPublicPage($this->get('/dukkan/saatsiz-dukkan'));
    $business = WebPage::jsonLd($html)[1];

    expect($business)->not->toHaveKeys(['openingHoursSpecification', 'telephone'])
        ->and($html)->toContain('Dükkân çalışma saatlerini henüz belirtmedi.')
        ->and($html)->not->toContain('tel:');
});

it('keeps title, description and the answer paragraph within limits for long names', function (): void {
    $name = str_repeat('Uzun İsimli Mahalle Fırını ', 4).'Sonu';
    DirectoryWorld::listed(['slug' => 'uzun-isim', 'name' => mb_substr($name, 0, 120), 'ilce' => 'Kahramankazan Merkez Mahallesi Bölgesi']);

    $html = WebPage::assertPublicPage($this->get('/dukkan/uzun-isim'));

    preg_match('#<title>(.*?)</title>#', $html, $title);
    preg_match('#<meta name="description" content="([^"]*)">#', $html, $description);

    expect(mb_strlen(html_entity_decode($title[1])))->toBeLessThanOrEqual(60)
        ->and(mb_strlen(html_entity_decode($description[1])))->toBeLessThanOrEqual(155)
        ->and(html_entity_decode($title[1]))->toEndWith('| Askıda');
});

it('shows the Smart App Banner only when an App Store id is configured', function (): void {
    DirectoryWorld::bakery();

    expect((string) $this->get('/dukkan/cinar-firini-kadikoy')->getContent())->not->toContain('apple-itunes-app');

    config(['web.ios_app_id' => '1234567890']);

    expect((string) $this->get('/dukkan/cinar-firini-kadikoy')->getContent())
        ->toContain('<meta name="apple-itunes-app" content="app-id=1234567890">');
});
