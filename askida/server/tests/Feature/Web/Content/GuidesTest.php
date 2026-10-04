<?php

use App\Domain\Web\Content\GuideRepository;
use App\Support\Web\Facts;
use App\Support\Web\Format;
use Tests\Feature\Web\Support\WebPage;

/*
| The five guides: render under the public page contract, are long and honest enough, carry
| an Article block with the dates of their front matter and quote only the shared facts.
*/

beforeEach(function (): void {
    WebPage::isolate();
});

dataset('guide slugs', GuideRepository::SLUGS);

it('serves exactly the five guides', function (): void {
    expect(GuideRepository::SLUGS)->toBe([
        'askida-ekmek-gelenegi-nedir',
        'esnaf-icin-askida-sistemi-nasil-isler',
        'bagisiniz-nereye-gidiyor',
        'askidan-almak-ayip-degil',
        'isletmenizi-nasil-dogrulariz',
    ])
        ->and(glob(resource_path('content/guides/*.md')))->toHaveCount(5);
});

it('renders a guide under the public page contract', function (string $slug): void {
    $html = WebPage::assertPublicPage($this->get('/rehber/'.$slug), 'tr', WebPage::BUDGET_LONG);

    expect($html)->toContain('<link rel="canonical" href="https://askida.app/rehber/'.$slug.'">')
        ->toContain('<link rel="alternate" hreflang="tr-TR" href="https://askida.app/rehber/'.$slug.'">')
        ->toContain('<link rel="alternate" hreflang="x-default" href="https://askida.app/rehber/'.$slug.'">')
        ->toContain('<meta property="og:type" content="article">')
        ->not->toContain('hreflang="en"');
})->with('guide slugs');

it('has at least 600 Turkish words in the body', function (string $slug): void {
    $guide = app(GuideRepository::class)->find($slug);

    expect($guide)->not->toBeNull()
        ->and($guide->wordCount())->toBeGreaterThanOrEqual(600);
})->with('guide slugs');

it('asks every H2 as a question and answers it with a paragraph right away', function (string $slug): void {
    $html = (string) $this->get('/rehber/'.$slug)->getContent();

    expect(preg_match('#<div class="prose">(.*?)</div>#s', $html, $prose))->toBe(1);

    preg_match_all('#<h2>(.*?)</h2>#s', $prose[1], $headings);

    expect(count($headings[1]))->toBeGreaterThanOrEqual(5)
        ->and(preg_match_all('#</h2>\s*<p>#', $prose[1]))->toBe(count($headings[1]));

    foreach ($headings[1] as $heading) {
        expect(html_entity_decode($heading))->toEndWith('?');
    }
})->with('guide slugs');

it('emits an Article block with honest dates from the front matter', function (string $slug): void {
    $guide = app(GuideRepository::class)->find($slug);
    $html = (string) $this->get('/rehber/'.$slug)->getContent();

    $article = collect(WebPage::jsonLd($html))->firstWhere('@type', 'Article');

    expect($article)->not->toBeNull()
        ->and($article['headline'])->toBe($guide->title)
        ->and($article['datePublished'])->toBe($guide->published->toDateString())
        ->and($article['dateModified'])->toBe($guide->updated->toDateString())
        ->and($article['inLanguage'])->toBe('tr-TR')
        ->and($article['wordCount'])->toBe($guide->wordCount())
        ->and($article['author']['name'])->toBe(Facts::LEGAL_NAME)
        ->and($article['publisher']['name'])->toBe(Facts::LEGAL_NAME)
        ->and($article['mainEntityOfPage'])->toBe('https://askida.app/rehber/'.$slug)
        // The dates are the front matter's, never the clock's.
        ->and($guide->updated->toDateString())->toBe('2026-10-04');
})->with('guide slugs');

it('shows the front matter dates on the page', function (): void {
    $html = (string) $this->get('/rehber/bagisiniz-nereye-gidiyor')->getContent();

    expect($html)->toContain('Yayın: 4 Ekim 2026')->toContain('Güncelleme: 4 Ekim 2026');
});

it('links the other four guides from every guide', function (string $slug): void {
    $html = (string) $this->get('/rehber/'.$slug)->getContent();

    foreach (GuideRepository::SLUGS as $other) {
        if ($other === $slug) {
            expect($html)->not->toContain('<li><a href="/rehber/'.$other.'">');

            continue;
        }

        expect($html)->toContain('<a href="/rehber/'.$other.'">');
    }
})->with('guide slugs');

it('answers 404 for an unknown guide slug and for path tricks', function (string $path): void {
    $this->get($path)->assertNotFound();
})->with([
    'unknown' => '/rehber/yok-boyle-bir-rehber',
    'upper case' => '/rehber/Askida-Ekmek-Gelenegi-Nedir',
    'dots' => '/rehber/..%2F..%2F.env',
    'markdown extension' => '/rehber/askida-ekmek-gelenegi-nedir.md',
    'index' => '/rehber',
]);

it('quotes the shared facts and never hard-codes them in the sources', function (): void {
    foreach (glob(resource_path('content/{guides,legal}/*.md'), GLOB_BRACE) ?: [] as $file) {
        $source = (string) file_get_contents($file);

        expect($source)->not->toMatch('/%\s?\d/u', basename($file))
            ->not->toMatch('/\b\d+\s*(karakter|dakika|km|adet)\b/iu', basename($file))
            ->not->toMatch('/₺\s?\d/u', basename($file));
    }
});

it('renders the configured commission, caps and validity from the facts', function (): void {
    config(['payments.commission_bps' => 750, 'askida.hooks.reservation_minutes' => 15]);

    $html = html_entity_decode((string) $this->get('/rehber/esnaf-icin-askida-sistemi-nasil-isler')->getContent());

    expect($html)->toContain('%7,5 (örnek oran)')
        ->toContain('Kod 15 dakika geçerlidir')
        ->toContain(Format::money(Facts::txCapMinor()))
        ->toContain(Format::money(Facts::dayCapMinor()))
        ->not->toContain('%5 (örnek oran)');
});

it('renders the default commission label on the guides that quote it', function (): void {
    foreach (['askida-ekmek-gelenegi-nedir', 'esnaf-icin-askida-sistemi-nasil-isler', 'bagisiniz-nereye-gidiyor'] as $slug) {
        $html = html_entity_decode((string) $this->get('/rehber/'.$slug)->getContent());

        expect($html)->toContain('%5 (örnek oran)')->toContain('yayın öncesi belirlenir');
    }
});

it('says honestly that the app is not published and the figures are samples', function (string $slug): void {
    $html = (string) $this->get('/rehber/'.$slug)->getContent();

    expect($html)->toContain('henüz mağazalarda yayımlanmamıştır');
})->with('guide slugs');

it('does not use pity words, people imagery cues or external links', function (string $slug): void {
    $html = (string) $this->get('/rehber/'.$slug)->getContent();

    expect($html)->not->toMatch('/muhtaç|fakir|yoksul|ihtiyaç sahibi/iu')
        ->not->toMatch('#href="https?://(?!askida\.app)#');
})->with('guide slugs');
