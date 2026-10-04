<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Data\HomeCounters;
use App\Support\Web\Facts;
use App\Support\Web\Origin;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| The static public pages: the shared page contract (WebPage), hreflang, JSON-LD of home and
| FAQ, the counters on the home page, the facts and the commission label on every surface,
| the sample notice and the plain-text contact address.
*/

beforeEach(function (): void {
    WebPage::isolate();
    $this->app->instance(CountersReader::class, new FakeCountersReader);
});

dataset('turkish pages', ['/', '/nasil-calisir', '/esnaf', '/bagisci', '/askidan-al', '/sss', '/hakkinda', '/iletisim']);

dataset('english pages', ['/en', '/en/how-it-works']);

/**
 * @return list<string> the hreflang => href pairs of the page as "hreflang=href"
 */
function pageAlternates(string $html): array
{
    preg_match_all('#<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"#', $html, $matches, PREG_SET_ORDER);

    return array_map(static fn (array $m): string => $m[1].'='.$m[2], $matches);
}

it('renders every Turkish page with the public page contract', function (string $path): void {
    $html = WebPage::assertPublicPage($this->get($path), 'tr', $path === '/sss' ? WebPage::BUDGET_LONG : WebPage::BUDGET);

    expect($html)->toContain('<link rel="canonical" href="'.Origin::url($path).'">');
})->with('turkish pages');

it('renders the English pages with lang en', function (string $path): void {
    $html = WebPage::assertPublicPage($this->get($path), 'en');

    expect($html)->toContain('<link rel="canonical" href="'.Origin::url($path).'">');
})->with('english pages');

it('links the English pages reciprocally with x-default on the Turkish URL', function (string $turkish, string $english): void {
    $expected = [
        'tr-TR='.Origin::url($turkish),
        'en='.Origin::url($english),
        'x-default='.Origin::url($turkish),
    ];

    expect(pageAlternates((string) $this->get($turkish)->getContent()))->toBe($expected)
        ->and(pageAlternates((string) $this->get($english)->getContent()))->toBe($expected);
})->with([
    'home' => ['/', '/en'],
    'how it works' => ['/nasil-calisir', '/en/how-it-works'],
]);

it('emits no en alternate on pages without an English version', function (string $path): void {
    $alternates = pageAlternates((string) $this->get($path)->getContent());

    expect($alternates)->toBe(['tr-TR='.Origin::url($path), 'x-default='.Origin::url($path)]);
})->with(['/esnaf', '/bagisci', '/askidan-al', '/sss', '/hakkinda', '/iletisim']);

it('keeps titles and descriptions within the limits and unique per page', function (): void {
    $titles = [];
    $descriptions = [];

    foreach (['/', '/en', '/nasil-calisir', '/en/how-it-works', '/esnaf', '/bagisci', '/askidan-al', '/sss', '/hakkinda', '/iletisim'] as $path) {
        $html = (string) $this->get($path)->getContent();

        preg_match('#<title>(.*?)</title>#s', $html, $title);
        preg_match('#<meta name="description" content="([^"]*)"#', $html, $description);

        $titles[] = html_entity_decode($title[1]);
        $descriptions[] = html_entity_decode($description[1]);
    }

    foreach ($titles as $title) {
        expect(mb_strlen($title))->toBeLessThanOrEqual(60);
    }

    foreach ($descriptions as $description) {
        expect(mb_strlen($description))->toBeLessThanOrEqual(155)->toBeGreaterThan(50);
    }

    expect(array_unique($titles))->toHaveCount(count($titles))
        ->and(array_unique($descriptions))->toHaveCount(count($descriptions));
});

it('shows the sample notice only on the about and contact pages', function (string $path, bool $notice): void {
    $html = (string) $this->get($path)->getContent();

    if ($notice) {
        expect($html)->toContain(Facts::SAMPLE_NOTICE);
    } else {
        expect($html)->not->toContain(Facts::SAMPLE_NOTICE);
    }
})->with([
    ['/hakkinda', true],
    ['/iletisim', true],
    ['/', false],
    ['/esnaf', false],
    ['/sss', false],
]);

it('prints the contact address as plain text, not a link', function (): void {
    $html = WebPage::assertPublicPage($this->get('/iletisim'));

    expect($html)->toContain(Facts::contactEmail().'</span> (örnek adres, aktif değil)')
        ->and($html)->toContain(Facts::LEGAL_NAME)
        ->and($html)->not->toContain('mailto:')
        ->and($html)->not->toContain('<form');

    config(['web.contact_email' => 'ornek@example.test']);

    expect((string) $this->get('/iletisim')->getContent())->toContain('ornek@example.test');
});

it('carries the MobileApplication block on the home page only, with store URLs when configured', function (): void {
    $blocks = WebPage::jsonLd((string) $this->get('/')->getContent());
    $app = collect($blocks)->firstWhere('@type', 'MobileApplication');

    expect(array_column($blocks, '@type'))->toBe(['Organization', 'MobileApplication'])
        ->and($app['applicationCategory'])->toBe('LifestyleApplication')
        ->and($app['operatingSystem'])->toBe('Android, iOS')
        ->and($app['offers'])->toBe(['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'TRY'])
        ->and($app)->not->toHaveKey('installUrl');

    config(['web.store_urls.android' => 'https://play.example.test/askida']);

    $app = collect(WebPage::jsonLd((string) $this->get('/')->getContent()))->firstWhere('@type', 'MobileApplication');

    expect($app['installUrl'])->toBe(['https://play.example.test/askida']);

    expect(array_column(WebPage::jsonLd((string) $this->get('/esnaf')->getContent()), '@type'))->toBe(['Organization', 'BreadcrumbList']);
});

it('mirrors the 15 FAQ pairs of the page in the FAQPage block, same strings', function (): void {
    $html = WebPage::assertPublicPage($this->get('/sss'), 'tr', WebPage::BUDGET_LONG);
    $faq = collect(WebPage::jsonLd($html))->firstWhere('@type', 'FAQPage');

    expect($faq['mainEntity'])->toHaveCount(15);

    preg_match_all('#<summary>(.*?)</summary>\s*<p>(.*?)</p>#s', $html, $rendered, PREG_SET_ORDER);

    expect($rendered)->toHaveCount(15);

    foreach ($faq['mainEntity'] as $index => $question) {
        expect($question['@type'])->toBe('Question')
            ->and($question['acceptedAnswer']['@type'])->toBe('Answer')
            ->and(html_entity_decode($rendered[$index][1], ENT_QUOTES | ENT_HTML5))->toBe($question['name'])
            ->and(html_entity_decode($rendered[$index][2], ENT_QUOTES | ENT_HTML5))->toBe($question['acceptedAnswer']['text']);
    }
});

it('shows the counters of the reader on the home page, dated and labelled as sample', function (): void {
    $html = (string) $this->get('/')->getContent();

    expect($html)->toContain('Bugün')
        ->and($html)->toContain('>14<')
        ->and($html)->toContain('ÖRNEK')
        ->and($html)->toContain('4 Ekim 2026')
        ->and($html)->toContain('Sayılar ürün adedidir; kişi sayısı tutulmaz.');

    $this->app->instance(CountersReader::class, new FakeCountersReader(new HomeCounters(
        availableNow: 1240,
        donatedToday: 300,
        redeemedToday: 250,
        shops: 40,
        asOf: FakeCountersReader::asOf(),
        isSample: false,
        methodology: 'impact.v1.daily_units',
    )));

    $html = (string) $this->get('/')->getContent();

    expect($html)->toContain('1.240')
        ->and($html)->not->toContain('ÖRNEK');
});

it('prints the same facts on the pages, the FAQ and the JSON-LD', function (): void {
    $label = '%5 (örnek oran)';

    foreach (['/hakkinda', '/esnaf', '/bagisci', '/nasil-calisir'] as $path) {
        expect((string) $this->get($path)->getContent())->toContain($label);
    }

    $faq = (string) $this->get('/sss')->getContent();

    expect($faq)->toContain($label)
        ->and($faq)->toContain('₺2.000,00')
        ->and($faq)->toContain('₺5.000,00')
        ->and($faq)->toContain('8 karakterlik')
        ->and($faq)->toContain('10 dakika')
        ->and($faq)->toContain('en fazla 20 adet');

    $about = (string) $this->get('/hakkinda')->getContent();

    expect($about)->toContain('₺2.000,00')
        ->and($about)->toContain('₺5.000,00')
        ->and($about)->toContain('8 karakter, 10 dakika');
});

it('never hard-codes the commission and follows the configuration', function (): void {
    config(['payments.commission_bps' => 750]);

    foreach (['/hakkinda', '/sss', '/esnaf', '/bagisci', '/nasil-calisir'] as $path) {
        $html = (string) $this->get($path)->getContent();

        expect($html)->toContain('%7,5 (örnek oran)')
            ->and($html)->not->toContain('%5 (örnek oran)');
    }
});

it('follows the configured reservation window and caps in the copy', function (): void {
    config(['askida.hooks.reservation_minutes' => 15, 'askida.hooks.anon_daily_cap' => 3, 'askida.hooks.anon_shop_daily_cap' => 2]);

    $html = (string) $this->get('/nasil-calisir')->getContent();

    expect($html)->toContain('15 dakika')
        ->and($html)->toContain('3 ürün')
        ->and($html)->not->toContain('10 dakika');
});

it('uses one primary button at most and names no people', function (string $path): void {
    $html = (string) $this->get($path)->getContent();

    expect(substr_count($html, 'button-primary'))->toBeLessThanOrEqual(1)
        ->and($html)->not->toMatch('/muhtaç|fakir|yoksul|ihtiyaç sahibi/iu');
})->with('turkish pages');

it('serves the personas without an image of a person', function (): void {
    foreach (['/', '/esnaf', '/bagisci', '/askidan-al'] as $path) {
        expect((string) $this->get($path)->getContent())->not->toMatch('/<img\b|<picture\b|<video\b/i');
    }
});
