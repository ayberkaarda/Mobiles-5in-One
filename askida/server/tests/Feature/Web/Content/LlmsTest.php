<?php

use App\Domain\Web\Content\GuideRepository;
use App\Domain\Web\Content\LegalRepository;
use App\Domain\Web\Content\LlmsDocument;
use App\Support\Web\Facts;
use Tests\Feature\Web\Support\WebPage;

beforeEach(function (): void {
    WebPage::isolate();
});

it('serves llms.txt as UTF-8 plain text within 2 KB', function (): void {
    $response = $this->get('/llms.txt')->assertOk();

    expect($response->headers->get('Content-Type'))->toBe('text/plain; charset=utf-8');

    $body = (string) $response->getContent();

    expect(strlen($body))->toBeLessThanOrEqual(LlmsDocument::SHORT_MAX_BYTES)
        ->and($body)->toStartWith('# Askıda')
        ->and($body)->not->toMatch('/<[a-z][^>]*>/i');
});

it('covers the definition, the three personas, redemption, anonymity, commission and ten links', function (): void {
    $body = (string) $this->get('/llms.txt')->getContent();

    expect($body)->toContain('> Askıda, askıda ekmek geleneğini')
        ->toContain('- Bağışçı:')
        ->toContain('- Esnaf:')
        ->toContain('- Alan:')
        ->toContain('## Askıdan alma')
        ->toContain(Facts::codeLength().' karakterli kod '.Facts::codeValidMinutes().' dakika geçerlidir')
        ->toContain('## Gizlilik güvencesi')
        ->toContain('hesap, kimlik, puan ve geçmiş yoktur')
        ->toContain('Komisyon oranı '.Facts::commissionLabel().'; yayın öncesi belirlenir.')
        ->toContain(Facts::LEGAL_NAME);

    preg_match('/## Bağlantılar\n(.*?)\n\n/s', $body, $section);

    $urls = array_filter(explode("\n", $section[1]), static fn (string $line): bool => str_contains($line, 'https://askida.app/'));

    expect($urls)->toHaveCount(10);

    foreach ($urls as $line) {
        expect($line)->toMatch('#^- [^:]+: https://askida\.app/[a-z0-9/.-]*$#u');
    }
});

it('names the sample mailbox as plain text and as not active', function (): void {
    $body = (string) $this->get('/llms.txt')->getContent();

    expect($body)->toContain('İletişim adresi: '.Facts::contactEmail().' (örnek adres, aktif değil)')
        ->not->toContain('mailto:');
});

it('renders the commission from the configuration', function (): void {
    config(['payments.commission_bps' => 750]);

    $body = (string) $this->get('/llms.txt')->getContent();

    expect($body)->toContain('%7,5 (örnek oran)')->not->toContain('%5 (örnek oran)');
});

it('keeps llms.txt within 2 KB with a longer commission and contact configured', function (): void {
    config(['payments.commission_bps' => 1250, 'web.contact_email' => 'uzun.bir.ornek.adres@ornek.askida.app']);

    expect(strlen((string) $this->get('/llms.txt')->getContent()))->toBeLessThanOrEqual(LlmsDocument::SHORT_MAX_BYTES);
});

it('serves llms-full.txt with the guides, the legal texts and the facts', function (): void {
    $response = $this->get('/llms-full.txt')->assertOk();

    expect($response->headers->get('Content-Type'))->toBe('text/plain; charset=utf-8');

    $body = (string) $response->getContent();

    expect($body)->toStartWith('# Askıda (tam metin)')
        ->toContain('## Hakkında')
        ->toContain('## Rehberler')
        ->toContain('## Hukuki metinler (örnek taslaklar)')
        ->toContain(Facts::SAMPLE_NOTICE)
        ->toContain('Komisyon oranı '.Facts::commissionLabel().'; yayın öncesi belirlenir.')
        ->not->toContain(Facts::contactEmail())
        ->not->toContain('mailto:')
        ->not->toMatch('/<(?:p|h2|ul|div|script)\b/i');

    foreach (app(GuideRepository::class)->all() as $guide) {
        expect($body)->toContain('### '.$guide->title)
            ->toContain('https://askida.app/rehber/'.$guide->slug)
            ->toContain('Güncelleme: '.$guide->updated->toDateString());
    }

    foreach (app(LegalRepository::class)->all() as $page) {
        expect($body)->toContain('### '.$page->title);
    }
});

it('re-renders llms-full.txt with a changed commission and carries no unreplaced token', function (): void {
    config(['payments.commission_bps' => 750]);

    $body = (string) $this->get('/llms-full.txt')->getContent();

    expect($body)->toContain('%7,5 (örnek oran)')
        ->not->toContain('%5 (örnek oran)')
        ->not->toMatch('/\{\{[^}]*\}\}/');
});

it('includes the FAQ pairs when the pages area ships them', function (): void {
    $path = resource_path('content/faq.php');

    if (! is_file($path)) {
        $body = (string) $this->get('/llms-full.txt')->getContent();

        expect($body)->not->toContain('## Sıkça sorulan sorular');

        return;
    }

    $body = (string) $this->get('/llms-full.txt')->getContent();

    expect($body)->toContain('## Sıkça sorulan sorular')
        ->and(substr_count($body, "\n### ") - count(GuideRepository::SLUGS) - count(LegalRepository::SLUGS))->toBeGreaterThanOrEqual(15);
});

it('is served from the page cache with the plain text content type', function (): void {
    config(['responsecache.enabled' => true, 'responsecache.store' => 'array']);

    $first = $this->get('/llms.txt');
    $second = $this->get('/llms.txt');

    $first->assertOk()->assertHeader('X-Page-Cache', 'miss');
    $second->assertOk()->assertHeader('X-Page-Cache', 'hit');

    expect($second->headers->get('Content-Type'))->toBe('text/plain; charset=utf-8')
        ->and($second->getContent())->toBe($first->getContent());
});
