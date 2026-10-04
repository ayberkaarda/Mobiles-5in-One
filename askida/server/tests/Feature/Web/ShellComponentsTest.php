<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Support\Web\Facts;
use App\Support\Web\Format;
use App\Support\Web\JsonLd;
use App\Support\Web\Origin;
use App\Support\Web\PageMeta;
use App\Support\Web\PurifiedHtml;
use App\Support\Web\SitemapXml;
use App\Support\Web\TurkishSlug;
use App\Support\Web\ZeroCountersReader;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Blade;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Support\WebPage;

/*
| The shared building blocks of the public web: page metadata and hreflang, facts, number
| formatting, JSON-LD encoding, the sitemap builder and the Blade components.
*/

beforeEach(function (): void {
    WebPage::isolate();
});

it('builds canonical and hreflang from the configured origin, not the request host', function (): void {
    config(['web.origin' => 'https://example.test']);

    $meta = PageMeta::make('/nasil-calisir', 'Nasıl çalışır', 'Açıklama', [['Nasıl çalışır', '/nasil-calisir']]);

    expect($meta->canonical)->toBe('https://example.test/nasil-calisir')
        ->and($meta->alternates)->toBe([
            ['hreflang' => 'tr-TR', 'href' => 'https://example.test/nasil-calisir'],
            ['hreflang' => 'x-default', 'href' => 'https://example.test/nasil-calisir'],
        ])
        ->and($meta->robots)->toBe('index,follow')
        ->and($meta->ogImageUrl())->toBe('https://example.test/og/default.png');

    $blocks = $meta->jsonLdBlocks();

    expect(array_column($blocks, '@type'))->toBe(['Organization', 'BreadcrumbList'])
        ->and($blocks[1]['itemListElement'][0]['item'])->toBe('https://example.test/')
        ->and($blocks[1]['itemListElement'][1])->toBe(['@type' => 'ListItem', 'position' => 2, 'name' => 'Nasıl çalışır', 'item' => 'https://example.test/nasil-calisir']);
});

it('emits the en alternate only for pages with an English translation', function (): void {
    $tr = PageMeta::make('/', 'Askıda', 'Açıklama', translations: ['tr' => '/', 'en' => '/en']);
    $en = PageMeta::make('/en', 'Askıda', 'Description', translations: ['tr' => '/', 'en' => '/en'], lang: 'en');

    $expected = [
        ['hreflang' => 'tr-TR', 'href' => Origin::url('/')],
        ['hreflang' => 'en', 'href' => Origin::url('/en')],
        ['hreflang' => 'x-default', 'href' => Origin::url('/')],
    ];

    expect($tr->alternates)->toBe($expected)
        ->and($en->alternates)->toBe($expected)
        ->and($en->canonical)->toBe(Origin::url('/en'))
        ->and($en->ogLocale())->toBe('en_US');
});

it('refuses titles and descriptions over the limits', function (string $title, string $description): void {
    PageMeta::make('/', $title, $description);
})->with([
    'title of 61 characters' => [str_repeat('ş', 61), 'Açıklama'],
    'description of 156 characters' => ['Başlık', str_repeat('ı', 156)],
    'empty title' => ['  ', 'Açıklama'],
])->throws(InvalidArgumentException::class);

it('refuses canonical and Open Graph URLs off the origin', function (): void {
    new PageMeta('Başlık', 'Açıklama', 'https://elsewhere.test/');
})->throws(InvalidArgumentException::class);

it('prints the commission from the configuration with a Turkish decimal comma', function (int $bps, string $label): void {
    config(['payments.commission_bps' => $bps]);

    expect(Facts::commissionLabel())->toBe($label);
})->with([
    [500, '%5 (örnek oran)'],
    [750, '%7,5 (örnek oran)'],
    [125, '%1,25 (örnek oran)'],
    [1000, '%10 (örnek oran)'],
]);

it('reads the facts from the configuration and the API constants', function (): void {
    config(['askida.hooks.reservation_minutes' => 12]);

    expect(Facts::codeLength())->toBe(8)
        ->and(Facts::codeValidMinutes())->toBe(12)
        ->and(Facts::anonDailyCap())->toBe(2)
        ->and(Facts::anonShopDailyCap())->toBe(1)
        ->and(Facts::radiusDefaultM())->toBe(3000)
        ->and(Facts::radiusMaxM())->toBe(5000)
        ->and(Facts::qtyMax())->toBe(20)
        ->and(Facts::txCapMinor())->toBe(200_000)
        ->and(Facts::dayCapMinor())->toBe(500_000)
        ->and(Facts::LEGAL_NAME)->toBe('Askıda İyilik Teknolojileri')
        ->and(Facts::APP_ID)->toBe('app.askida.mobile');
});

it('formats money, counts and dates the Turkish way', function (): void {
    expect(Format::money(4500))->toBe('₺45,00')
        ->and(Format::money(124_000_050))->toBe('₺1.240.000,50')
        ->and(Format::count(1240))->toBe('1.240')
        ->and(Format::date(CarbonImmutable::parse('2026-10-04')))->toBe('4 Ekim 2026')
        ->and(Format::words("  Askıda,  bir\nekmek   "))->toBe(3);
});

it('folds Turkish letters into slugs', function (): void {
    expect(TurkishSlug::make('İstanbul'))->toBe('istanbul')
        ->and(TurkishSlug::make('Şişli'))->toBe('sisli')
        ->and(TurkishSlug::make('Kadıköy Moda'))->toBe('kadikoy-moda')
        ->and(TurkishSlug::make('ÇANAKKALE / Gökçeada'))->toBe('canakkale-gokceada')
        ->and(TurkishSlug::make('IĞDIR'))->toBe('igdir');
});

it('encodes JSON-LD so that no value can close the script element', function (): void {
    $json = JsonLd::encode(['name' => '</script><script>alert(1)</script> & Şişli', 'url' => 'https://askida.app/a']);

    expect($json)->not->toContain('<')
        ->not->toContain('>')
        ->toContain(trim((string) json_encode('</script>', JSON_HEX_TAG | JSON_UNESCAPED_SLASHES), '"'))
        ->toContain('Şişli')
        ->toContain('https://askida.app/a');
});

it('builds a sitemap of origin URLs only', function (): void {
    $xml = (new SitemapXml)
        ->add('/')
        ->add('/etki', CarbonImmutable::parse('2026-10-01T10:00:00+03:00'))
        ->toXml();

    expect($xml)->toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        ->toContain('<loc>'.Origin::url('/').'</loc>')
        ->toContain('<lastmod>2026-10-01T10:00:00+03:00</lastmod>');

    (new SitemapXml)->add('https://elsewhere.test/');
})->throws(InvalidArgumentException::class);

it('defaults to zero counters until the impact reader is bound', function (): void {
    $home = (new ZeroCountersReader)->home();

    expect($home->availableNow)->toBe(0)
        ->and($home->isSample)->toBeFalse()
        ->and(app(CountersReader::class))->toBeInstanceOf(CountersReader::class);
});

it('renders the head with metadata, theme colours and the data blocks only', function (): void {
    $this->app->instance(CountersReader::class, new FakeCountersReader);

    $html = WebPage::assertPublicPage($this->get('/'));

    expect($html)->toContain('<link rel="canonical" href="'.Origin::url('/').'">')
        ->toContain('<meta name="theme-color" content="#F4F0E8" media="(prefers-color-scheme: light)">')
        ->toContain('<meta name="theme-color" content="#171411" media="(prefers-color-scheme: dark)">')
        ->toContain('<meta property="og:locale" content="tr_TR">')
        ->not->toContain('apple-itunes-app');

    expect(WebPage::jsonLd($html)[0])->toMatchArray([
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        'name' => Facts::LEGAL_NAME,
        'logo' => Origin::url('/logo/askida-mark.svg'),
    ]);
});

it('adds the Smart App Banner only with a numeric App Store id', function (): void {
    $this->app->instance(CountersReader::class, new FakeCountersReader);

    config(['web.ios_app_id' => '1234567890']);
    expect((string) $this->get('/')->getContent())->toContain('<meta name="apple-itunes-app" content="app-id=1234567890">');

    config(['web.ios_app_id' => 'not-a-number']);
    expect((string) $this->get('/')->getContent())->not->toContain('apple-itunes-app');
});

it('draws one accent tag per item up to twelve, then a plus tag', function (int $count, int $tags, bool $plus): void {
    $html = Blade::render('<x-web.rail-counter :count="$count" />', ['count' => $count]);

    preg_match('/class="rc-tag"[^>]*d="([^"]*)"/', $html, $path);

    expect(intdiv(substr_count($path[1] ?? '', 'Z'), 2))->toBe($tags)
        ->and(str_contains($html, 'rc-more'))->toBe($plus)
        ->and($html)->toContain('<span class="numeral-xl">'.Format::count($count).'</span>');
})->with([
    'none' => [0, 0, false],
    'three' => [3, 3, false],
    'twelve' => [12, 12, false],
    'forty' => [40, 12, true],
]);

it('labels sample counters and dates them', function (): void {
    $html = Blade::render('<x-web.rail-counter :count="5" label="çorba askıda" :as-of="$date" :sample="true" />', ['date' => CarbonImmutable::parse('2026-10-04')]);

    expect($html)->toContain('ÖRNEK')
        ->toContain('4 Ekim 2026 itibarıyla.')
        ->toContain('<span class="title1">çorba askıda</span>');
});

it('escapes every text of the shop card', function (): void {
    $html = Blade::render('<x-web.shop-card :name="$name" href="/dukkan/x" district="Şişli, İstanbul" :available="0" :sample="true" />', [
        'name' => '<script>alert(1)</script> Fırın',
    ]);

    expect($html)->not->toContain('<script>')
        ->toContain('&lt;script&gt;alert(1)&lt;/script&gt; Fırın')
        ->toContain('<span class="numeral">—</span>')
        ->toContain('class="tag tag-sample">ÖRNEK</span>')
        ->not->toContain('is-on');
});

it('marks a shop with units on the rail with the accent pictogram tag', function (): void {
    $html = Blade::render('<x-web.shop-card name="Fırın" district="Kadıköy, İstanbul" :available="1240" pictogram="ekmek" heading="h2" />');

    expect($html)->toContain('shop-card-icon is-on')
        ->toContain('<h2 class="shop-card-name">Fırın</h2>')
        ->toContain('<span class="numeral">1.240</span>');
});

it('prints only purified HTML in the prose column', function (): void {
    $html = Blade::render('<x-web.prose :html="$html" />', ['html' => new PurifiedHtml('<h2>Soru?</h2><p>Cevap.</p>')]);

    expect($html)->toContain('<div class="prose">')
        ->toContain('<h2>Soru?</h2><p>Cevap.</p>');
});

it('shows a static map without any external request', function (): void {
    $html = Blade::render('<x-web.static-map label="Kadıköy, İstanbul" :lat="40.9903" :lng="29.0293" />');

    expect($html)->toContain('40,9903° K, 29,0293° D')
        ->not->toMatch('#(https?:)?//#');
});

it('omits store links that are not configured', function (): void {
    config(['web.store_urls' => ['android' => '', 'ios' => '']]);

    $empty = Blade::render('<x-web.download-band />');

    config(['web.store_urls' => ['android' => 'https://play.google.com/store/apps/details?id=app.askida.mobile', 'ios' => '']]);

    $android = Blade::render('<x-web.download-band deep-link="askida://shop/ornek" :primary="true" />');

    expect($empty)->not->toContain('<a ')
        ->toContain('Mağaza bağlantıları')
        ->and($android)->toContain('href="https://play.google.com/store/apps/details?id=app.askida.mobile"')
        ->not->toContain('App Store')
        ->toContain('class="button button-primary" href="askida://shop/ornek"');
});

it('puts the sample notice at the top of the page when asked', function (): void {
    $meta = PageMeta::make('/hakkinda', 'Hakkında', 'Açıklama', [['Hakkında', '/hakkinda']]);
    $html = Blade::render('<x-web.layout :meta="$meta" :sample-notice="true"><h1>Hakkında</h1></x-web.layout>', ['meta' => $meta]);

    expect($html)->toContain(Facts::SAMPLE_NOTICE)
        ->and(strpos($html, Facts::SAMPLE_NOTICE))->toBeLessThan((int) strpos($html, '<main'));
});
